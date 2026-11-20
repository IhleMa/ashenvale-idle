// Rogue keystones: Assassin's Mark (records damage, explodes on expiry) and Plaguebringer (poison spreads from bleeding targets).
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

// tree: Assassin's Mark is an ability node now, Plaguebringer describes its mechanic
{
  const nodes = Object.values(getTree('rogue').nodes);
  assert.ok(nodes.some(x => x.type === 'ability' && x.ability === 'assassins_mark'));
  const pb = nodes.find(x => x.name === 'Plaguebringer');
  assert.ok(describeNodeStats(pb.stats).some(t => /spreads the Poison/.test(t)));
  ok('tree: Assassin\'s Mark ability node, Plaguebringer describes the spread');
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

// Plaguebringer
{
  const { b, me, foes } = battle();
  cast(b, me, 'rupture', foes[0]);
  cast(b, me, 'poison_blade', foes[0]);
  assert.ok(has(foes[0], 'poison') && !has(foes[1], 'poison'), 'no spread without the keystone');
  const p = battle({ poisonSpread: 1 });
  cast(p.b, p.me, 'poison_blade', p.foes[0]);
  assert.ok(!has(p.foes[1], 'poison'), 'no spread when the target is not bleeding');
  cast(p.b, p.me, 'rupture', p.foes[0]);
  cast(p.b, p.me, 'poison_blade', p.foes[0]);
  assert.ok(p.foes.every(f => has(f, 'poison')), 'poison on every enemy');
  ok('Plaguebringer spreads poison from a bleeding target to every enemy');
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
console.log(`rogue-test: ${n} checks passed`);
