// Rogue keystones: Assassin's Mark (records damage, explodes on expiry) and Venom Rush (poison ticks twice as fast); Toxic Cloud spreads poison.
import assert from 'node:assert/strict';
const { createCharacter } = await import('../shared/character.js');
const C = await import('../shared/combat.js');
const { ABILITIES } = await import('../shared/data/abilities.js');
const { getTree, describeNodeStats } = await import('../shared/data/skilltree.js');

let n = 0;
const ok = m => { n++; console.log(`  ✔ ${m}`); };
const battle = (bonus = {}) => {
  const r = createCharacter({ id: 'r', name: 'Sly', classId: 'rogue', level: 30, isMain: true, autoTree: false });
  const wave = Array.from({ length: 3 }, () => ({ enemyId: 'swamp_troll', level: 30 }));
  const b = C.createBattle({ seed: 5, allies: [C.makeCharacterUnit(r, { ownerId: 'p', ownerName: 'P', position: 0 })], waves: [wave] });
  const foes = b.units.filter(u => u.side === 'B');
  for (const f of foes) { f.hp = f.maxHp = 1e7; f.statuses = []; }
  const me = b.units.find(u => u.charId === 'r');
  Object.assign(me.bonuses, bonus);
  me.undying = true;
  b.rng = () => 0.5;
  return { b, me, foes };
};
const cast = (b, u, id, t) => { for (const eff of ABILITIES[id].effects) C.__test.applyEffect(b, u, t, eff, id); };
const has = (u, id) => u.statuses.some(s => s.id === id);

// tree: Assassin's Mark is an ability node now, Venom Rush describes its mechanic
{
  const nodes = Object.values(getTree('rogue').nodes);
  assert.ok(nodes.some(x => x.type === 'ability' && x.ability === 'assassins_mark'));
  const pb = nodes.find(x => x.name === 'Venom Rush');
  assert.ok(describeNodeStats(pb.stats).some(t => /faster Poison ticks/.test(t)) && describeNodeStats(pb.stats).some(t => /10 Poison stacks/.test(t)));
  ok('tree: Assassin\'s Mark ability node, Venom Rush describes the faster poison');
}

// Assassin's Mark
{
  const { b, me, foes } = battle();
  cast(b, me, 'assassins_mark', foes[0]);
  assert.ok(has(foes[0], 'assassins_mark'));
  C.__test.applyEffect(b, me, foes[0], { kind: 'damage', stat: 'physPower', power: 3, school: 'physical' }, 'backstab');
  const lost = 1e7 - foes[0].hp;
  const mark = foes[0].statuses.find(s => s.id === 'assassins_mark');
  assert.equal(mark.recorded, lost);
  C.__test.applyEffect(b, foes[1], foes[0], { kind: 'damage', stat: 'physPower', power: 3, school: 'physical' }, null); // someone else's hit
  assert.equal(mark.recorded, lost, 'only the caster\'s damage is recorded');
  C.drainEvents(b);
  for (let i = 0; i < 80 && has(foes[0], "assassins_mark"); i++) C.stepBattle(b);
  assert.ok(!has(foes[0], 'assassins_mark'));
  const boom = C.drainEvents(b).find(e => e.type === 'damage' && e.proc === "Assassin's Mark");
  assert.ok(boom, 'explosion event');
  assert.ok(boom.amount >= lost, `explosion ${boom.amount} replays at least the recorded ${lost}`);
  ok(`mark records ${lost} damage and explodes for ${boom.amount} on expiry`);
}

// Venom Rush: poison ticks twice as fast (from this rogue's poison only); poison is magic damage scaling with Magic Power
{
  const ticks = bonus => {
    const { b, me, foes } = battle(bonus);
    me.loadout = []; me.actionTimer = 1e9;
    for (const f of foes) { f.loadout = []; f.actionTimer = 1e9; }
    cast(b, me, 'poison_blade', foes[0]);
    C.drainEvents(b);
    let n = 0;
    while (b.time < 4) { C.stepBattle(b); n += C.drainEvents(b).filter(e => e.type === 'damage' && e.dot === 'poison' && e.tgt === foes[0].uid).length; }
    return { n, b, foes };
  };
  const slow = ticks({}), few = ticks({ poisonSpeedPct: 1, poisonSpeedAt: 10 }), fast = ticks({ poisonSpeedPct: 1, poisonSpeedAt: 1 });
  assert.equal(few.n, slow.n, 'below 10 stacks: normal speed');
  assert.ok(fast.n >= slow.n * 2 - 1 && slow.n >= 3, `ticks ${slow.n} → ${fast.n}`);
  ok(`Venom Rush: poison ticks twice as fast (${slow.n} → ${fast.n} ticks in 4 s), from the 10th stack on, until the poison is gone`);
  {
    const { b, me, foes } = battle({ poisonSpeedPct: 1, poisonSpeedAt: 10 });
    me.loadout = []; me.actionTimer = 1e9;
    for (const f of foes) { f.loadout = []; f.actionTimer = 1e9; }
    for (let i = 0; i < 10; i++) cast(b, me, 'poison_blade', foes[0]);
    C.drainEvents(b);
    let n = 0;
    while (b.time < 4) { C.stepBattle(b); n += C.drainEvents(b).filter(e => e.type === 'damage' && e.dot === 'poison' && e.tgt === foes[0].uid).length; }
    assert.ok(n >= slow.n * 10 * 2 - 10, `10 stacks tick twice as fast (${n})`);
  }
  // it keeps going below 10 stacks, and stops once all poison is gone
  {
    const { b, me, foes } = battle({ poisonSpeedPct: 1, poisonSpeedAt: 10 });
    me.loadout = []; me.actionTimer = 1e9;
    for (const f of foes) { f.loadout = []; f.actionTimer = 1e9; }
    for (let i = 0; i < 10; i++) cast(b, me, 'poison_blade', foes[0]);
    C.stepBattle(b);
    assert.equal(foes[0].venomRush, true);
    foes[0].statuses = foes[0].statuses.filter(s => s.id !== 'poison').concat(foes[0].statuses.filter(s => s.id === 'poison').slice(0, 2));
    C.drainEvents(b);
    let n = 0; const t0 = b.time;
    while (b.time < t0 + 2) { C.stepBattle(b); n += C.drainEvents(b).filter(e => e.type === 'damage' && e.dot === 'poison' && e.tgt === foes[0].uid).length; }
    assert.ok(n >= 7, `2 stacks still tick twice as fast (${n} ticks in 2 s)`);
    while (foes[0].statuses.some(s => s.id === 'poison')) C.stepBattle(b);
    C.stepBattle(b);
    assert.equal(foes[0].venomRush, false, 'ends with the last poison');
    cast(b, me, 'poison_blade', foes[0]);
    C.stepBattle(b);
    assert.ok(!foes[0].venomRush, 'a fresh poison starts at normal speed');
  }
  assert.equal(ABILITIES.poison_blade.effects.find(e => e.status === 'poison').stat, 'magPower');
  ok('poison scales with Magic Power and deals magic damage');
}
// Toxic Flurry (Venomancer mutator): every hit of Shadow Flurry applies a poison stack
{
  const { applyMutators } = await import('../shared/mutators.js');
  const { SUBCLASSES } = await import('../shared/data/subclasses.js');
  const mut = SUBCLASSES.venomancer.branches[0].mutators['7'];
  const flurry = applyMutators(ABILITIES.shadow_flurry, [mut.changes]);
  const { b, me, foes } = battle();
  for (const f of foes) f.dodge = 0;
  me.stats.hitChance = 1;
  for (const eff of flurry.effects) C.__test.applyEffect(b, me, foes[0], eff, 'shadow_flurry');
  const n = foes[0].statuses.filter(s => s.id === 'poison').length;
  assert.equal(n, flurry.effects[0].hits, `${n} poison stacks from ${flurry.effects[0].hits} hits`);
  ok(`Toxic Flurry: each of the ${n} hits applies a poison stack`);
}
// Toxic Cloud: every poison stack on the chosen enemy is copied to all other enemies
{
  const { b, me, foes } = battle();
  for (let i = 0; i < 3; i++) cast(b, me, 'poison_blade', foes[0]);
  cast(b, me, 'toxic_cloud', foes[0]);
  for (const f of foes) assert.equal(f.statuses.filter(s => s.id === 'poison').length, 3, f.name);
  assert.equal(ABILITIES.toxic_cloud.cooldown, 40);
  const { resolveRule } = await import('../shared/rules.js');
  const t = resolveRule(ABILITIES.toxic_cloud.defaultRule, ABILITIES.toxic_cloud, b, me);
  assert.ok(t, 'fires when an enemy is poisoned');
  ok('Toxic Cloud copies all poison stacks of its target (default: the most poisoned enemy) to every other enemy');
}
// Expose Weakness rank 3: Opportunist — hits on exposed enemies restore energy
{
  const { mutatedAbilities } = await import('../shared/skilltree.js');
  const mk = rank => {
    const r = createCharacter({ id: 'r', name: 'Sly', classId: 'rogue', level: 30, isMain: true, autoTree: false });
    r.abilities = { ...r.abilities, expose_weakness: rank };
    assert.equal(!!mutatedAbilities(r).expose_weakness, rank >= 3);
    const b = C.createBattle({ seed: 2, allies: [C.makeCharacterUnit(r, { ownerId: 'p', ownerName: 'P', position: 0 })], waves: [[{ enemyId: 'swamp_troll', level: 30 }]] });
    const me = b.units[0], foe = b.units.find(u => u.side === 'B');
    foe.hp = foe.maxHp = 1e7; b.rng = () => 0.5;
    for (const eff of (me.abilityDefs.expose_weakness || ABILITIES.expose_weakness).effects) C.__test.applyEffect(b, me, foe, eff, 'expose_weakness');
    me.resource = 10;
    C.__test.applyEffect(b, me, foe, { kind: 'damage', stat: 'physPower', power: 1, school: 'physical' }, 'backstab');
    return { me, foe };
  };
  const r2 = mk(2), r3 = mk(3);
  assert.ok(has(r3.me, 'opportunist') && !has(r2.me, 'opportunist'));
  assert.equal(r2.me.resource, 10);
  assert.equal(r3.me.resource, 14);
  ok('Expose Weakness rank 3 grants Opportunist: hits on exposed enemies restore 4 energy');
}
// Shadow Flurry rank 2 and Backstab rank 3
{
  const { mutatedAbilities } = await import('../shared/skilltree.js');
  const mk = (ab, rank) => {
    const r = createCharacter({ id: 'r', name: 'Sly', classId: 'rogue', level: 30, isMain: true, autoTree: false });
    r.abilities = { ...r.abilities, [ab]: rank };
    const b = C.createBattle({ seed: 2, allies: [C.makeCharacterUnit(r, { ownerId: 'p', ownerName: 'P', position: 0 })], waves: [[{ enemyId: 'swamp_troll', level: 30 }]] });
    const me = b.units[0], foe = b.units.find(u => u.side === 'B');
    foe.hp = foe.maxHp = 1e7; b.rng = () => 0.5;
    const cast = id => { for (const eff of (me.abilityDefs[id] || ABILITIES[id]).effects) C.__test.applyEffect(b, me, foe, eff, id); };
    return { b, me, foe, cast };
  };
  const stacks = f => f.statuses.filter(s => s.id === 'bleed').length; // every application is its own stack
  const f1 = mk('shadow_flurry', 1); f1.cast('poison_blade'); f1.cast('shadow_flurry');
  const f2 = mk('shadow_flurry', 2); f2.cast('poison_blade'); f2.cast('shadow_flurry');
  const f3 = mk('shadow_flurry', 2); f3.cast('shadow_flurry');
  assert.equal(stacks(f1.foe), 0); assert.equal(stacks(f2.foe), 5); assert.equal(stacks(f3.foe), 0);
  ok('Shadow Flurry rank 2: every hit on a poisoned enemy makes it bleed (only if it is poisoned)');
  const crit = rank => { const x = mk('backstab', rank); x.b.rng = () => 0; x.me.resource = 0; x.cast('backstab'); return x.me.resource; };
  assert.equal(crit(3), 15); assert.equal(crit(2), 0);
  const nocrit = mk('backstab', 3); nocrit.b.rng = () => 0.99; nocrit.me.resource = 0; nocrit.cast('backstab');
  assert.equal(nocrit.me.resource, 0);
  ok('Backstab rank 3: a critical Backstab refunds 15 Energy');
}
// aggro conditions and threat info
{
  const { CONDITIONS, TARGET_CONDITIONS } = await import('../shared/rules.js');
  const t = createCharacter({ id: 't', name: 'Tank', classId: 'warrior', level: 20 }); t.role = 'tank';
  const r = createCharacter({ id: 'r', name: 'Rog', classId: 'rogue', level: 20 });
  const b = C.createBattle({ seed: 3, allies: [C.makeCharacterUnit(t, { ownerId: 'p', ownerName: 'P', position: 0 }), C.makeCharacterUnit(r, { ownerId: 'p', ownerName: 'P', position: 1 })], waves: [[{ enemyId: 'swamp_troll', level: 20 }]] });
  const [tu, ru] = b.units, foe = b.units.find(u => u.side === 'B');
  foe.threatTable[tu.uid] = 1000; foe.threatTable[ru.uid] = 400;
  assert.ok(CONDITIONS.has_aggro.test({}, b, tu) && !CONDITIONS.has_aggro.test({}, b, ru));
  assert.ok(TARGET_CONDITIONS.target_not_attacking_me.test({}, foe, b, ru) && TARGET_CONDITIONS.target_attacking_me.test({}, foe, b, tu));
  const d = C.dynamicUnit(ru, b);
  assert.equal(d.thr, 40); assert.equal(d.ag, 0); assert.equal(C.dynamicUnit(foe, b).tg, tu.uid);
  assert.ok(CONDITIONS.enemy_not_on_me.test({}, b, ru) && !CONDITIONS.enemy_not_on_me.test({}, b, tu));
  assert.ok(CONDITIONS.loose_count.test({ cmp: '>=', value: 1 }, b, ru) && CONDITIONS.loose_count.test({ cmp: '==', value: 0 }, b, tu));
  const { resolveRule, SELECTORS } = await import('../shared/rules.js');
  const { ABILITIES: AB } = await import('../shared/data/abilities.js');
  const pick = sel => SELECTORS[sel].pick(b.units.filter(x => x.side === 'A' && x.alive), b, ru).map(x => x.name);
  assert.deepEqual(pick('party_1'), ['Tank']); assert.deepEqual(pick('party_2'), ['Rog']); assert.deepEqual(pick('party_3'), []);
  assert.ok(Object.keys(SELECTORS).filter(k => k.startsWith('party_')).length === 4);
  ok('aggro: "an enemy is attacking me" and "target is attacking someone else" conditions; threat share for the display');
}
// Execute: below 15/30/45% health (by rank) +30% damage per Bleed stack
{
  const hit = (rank, hpFrac, bleeds, sub = null) => {
    const r = createCharacter({ id: 'r', name: 'Sly', classId: 'rogue', level: 30, isMain: true, autoTree: false });
    r.abilities = { ...r.abilities, execute: rank };
    const b = C.createBattle({ seed: 2, allies: [C.makeCharacterUnit(r, { ownerId: 'p', ownerName: 'P', position: 0 })], waves: [[{ enemyId: 'swamp_troll', level: 30 }]] });
    const me = b.units[0], foe = b.units.find(u => u.side === 'B');
    foe.hp = foe.maxHp = 1e7; foe.hp = foe.maxHp * hpFrac; b.rng = () => 0.5;
    for (let i = 0; i < bleeds; i++) foe.statuses.push({ id: 'bleed', remaining: 99, duration: 99, value: 0, stacks: 1, src: me.uid, tickTimer: 99 });
    const before = foe.hp;
    for (const eff of (sub || me.abilityDefs.execute || ABILITIES.execute).effects) C.__test.applyEffect(b, me, foe, eff, 'execute');
    return before - foe.hp;
  };
  const base = hit(1, 0.9, 4);
  assert.ok(Math.abs(hit(1, 0.1, 4) / base - 2.2) < 0.02, 'rank 1, 10% health, 4 bleeds: ×2.2');
  assert.ok(Math.abs(hit(1, 0.2, 4) - base) < 2, 'rank 1: 20% health is above the threshold');
  assert.ok(hit(2, 0.2, 4) / (base * 1.2) > 2.1, 'rank 2 works at 20%');
  assert.ok(Math.abs(hit(3, 0.44, 0) / (base * 1.4) - 1) < 0.02, 'no bleed: no bonus');
  ok('Execute: +30% per Bleed stack below 15% / 30% / 45% health (by rank)');
}
console.log(`rogue-test: ${n} checks passed`);
