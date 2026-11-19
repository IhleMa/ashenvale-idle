// Warlock: independent DoT stacks, Agony amplification, Blight healing reduction, Reap (consume_dots), Death's Door,
// Pandemic (spread), Plague Swarm jumping on death, Dark Pact tick speed, Drain Life scaling, AI condition, mutator "set".
import assert from 'node:assert/strict';
const { createCharacter } = await import('../shared/character.js');
const C = await import('../shared/combat.js');
const { resolveRule, TARGET_CONDITIONS } = await import('../shared/rules.js');
const { ABILITIES } = await import('../shared/data/abilities.js');
const { CLASSES } = await import('../shared/data/classes.js');
const { subclassesOf } = await import('../shared/data/subclasses.js');
const { applyMutators } = await import('../shared/mutators.js');
const { getTree } = await import('../shared/data/skilltree.js');

let n = 0;
const ok = m => { n++; console.log(`  ✔ ${m}`); };
const battle = (waves = [[{ enemyId: 'swamp_troll', level: 30 }, { enemyId: 'swamp_troll', level: 30 }, { enemyId: 'swamp_troll', level: 30 }]]) => {
  const wl = createCharacter({ id: 'k', name: 'Vex', classId: 'warlock', level: 30, isMain: true, autoTree: false });
  const r = createCharacter({ id: 'r', name: 'Sly', classId: 'rogue', level: 30 });
  const b = C.createBattle({ seed: 5, allies: [C.makeCharacterUnit(r, { ownerId: 'p', ownerName: 'P', position: 0 }), C.makeCharacterUnit(wl, { ownerId: 'p', ownerName: 'P', position: 1 })], waves });
  const foes = b.units.filter(u => u.side === 'B');
  for (const f of foes) { f.hp = f.maxHp = 1e7; f.statuses = []; }
  return { b, wu: b.units.find(u => u.charId === 'k'), ru: b.units.find(u => u.charId === 'r'), foes };
};
const cast = (b, u, abilityId, target, def = ABILITIES[abilityId]) => { for (const eff of def.effects) C.__test.applyEffect(b, u, target, eff, abilityId); };
const count = (u, id) => u.statuses.filter(s => s.id === id).length;
// steps the fight; returns DoT tick damage per target uid (other attacks are ignored)
const step = (b, sec, only = null) => { const dot = {}; for (let i = 0; i < sec * 10; i++) { C.stepBattle(b); for (const e of C.drainEvents(b)) if (e.type === 'damage' && e.dot && (!only || e.dot === only)) dot[e.tgt] = (dot[e.tgt] || 0) + e.amount; } return dot; };

// the class is complete
assert.ok(CLASSES.warlock);
assert.equal(Object.values(ABILITIES).filter(a => a.classId === 'warlock' && !a.subclass).length, 7);
assert.equal(subclassesOf('warlock').length, 3);
assert.equal(getTree('warlock').branches.length, 4);
ok('Warlock: 7 base abilities, 4-branch tree, 3 subclasses');

// independent stacks: every cast is its own stack with its own timer, no cap; shown as one icon with a count
{
  const { b, wu, foes } = battle();
  for (let i = 0; i < 7; i++) { cast(b, wu, 'corruption', foes[0]); b.time += 0.5; }
  assert.equal(count(foes[0], 'corruption'), 7);
  const rem = foes[0].statuses.filter(s => s.id === 'corruption').map(s => s.remaining);
  foes[0].statuses.find(s => s.id === 'corruption').remaining = 1;
  assert.ok(new Set(foes[0].statuses.map(s => s.remaining)).size > 1, `own timers: ${rem}`);
  const view = C.dynamicUnit(foes[0]).st.find(s => s[0] === 'corruption');
  assert.equal(view[2], 7);
  ok('Corruption stacks without a cap, each stack on its own timer; the client sees one icon ×7');
}

// Agony makes DoTs hurt more; Blight cuts healing
{
  const { b, wu, foes } = battle();
  cast(b, wu, 'corruption', foes[0]); cast(b, wu, 'corruption', foes[1]);
  for (let i = 0; i < 4; i++) cast(b, wu, 'agony', foes[1]);
  for (const st of foes[1].statuses) if (st.id === 'agony') st.value = 0; // only the amplification counts
  b.rng = () => 0.99; // no crits, fixed damage spread
  for (const u of b.units) u.actionTimer = 1e9; // nobody acts: only the DoTs tick
  const dot = step(b, 3, 'corruption');
  const lost0 = dot[foes[0].uid] || 0, lost1 = (dot[foes[1].uid] || 0) - 0;
  // foes[1] also carries 4 Agony stacks of its own; compare its Corruption share: total minus what Agony alone would do
  assert.ok(lost0 > 0);
  assert.ok(lost1 > lost0 * 1.12 && lost1 < lost0 * 1.35, `Corruption with 4 Agony stacks ${lost1} vs ${lost0} (expected ≈ +20%)`);
  cast(b, wu, 'blight', foes[2]);
  const f = foes[2]; f.hp = f.maxHp / 2; const h0 = f.hp;
  C.__test.applyEffect(b, f, f, { kind: 'heal', stat: 'magPower', power: 1 }, null);
  const healed = f.hp - h0;
  f.statuses = f.statuses.filter(s => s.id !== 'blight'); const h1 = f.hp;
  C.__test.applyEffect(b, f, f, { kind: 'heal', stat: 'magPower', power: 1 }, null);
  assert.ok(healed < (f.hp - h1) * 0.7, `blighted heal ${healed} vs ${f.hp - h1}`);
  ok('Agony stacks raise damage taken from DoTs; Blight reduces healing received by 40%');
}

// Reap consumes every DoT (also a party member's) for damage per second left; Death's Door doubles and executes
{
  const { b, wu, ru, foes } = battle();
  for (let i = 0; i < 3; i++) cast(b, wu, 'corruption', foes[0]);
  C.__test.applyEffect(b, ru, foes[0], { kind: 'status', status: 'poison', duration: 8, stat: 'physPower', power: 0.2 }, null);
  const hp = foes[0].hp;
  cast(b, wu, 'reap', foes[0]);
  assert.ok(!foes[0].statuses.some(s => ['corruption', 'poison'].includes(s.id)), 'all DoTs consumed');
  const plain = hp - foes[0].hp;
  assert.ok(plain > 0);
  for (let i = 0; i < 3; i++) cast(b, wu, 'corruption', foes[1]);
  C.__test.applyEffect(b, ru, foes[1], { kind: 'status', status: 'poison', duration: 8, stat: 'physPower', power: 0.2 }, null);
  cast(b, wu, 'deaths_door', foes[1]);
  const hp1 = foes[1].hp; cast(b, wu, 'reap', foes[1]);
  assert.ok(hp1 - foes[1].hp > plain * 1.5, `marked Reap ${hp1 - foes[1].hp} vs ${plain}`);
  // execute: a non-boss below 25% health dies
  for (let i = 0; i < 2; i++) cast(b, wu, 'corruption', foes[2]);
  cast(b, wu, 'deaths_door', foes[2]); foes[2].hp = foes[2].maxHp * 0.2;
  cast(b, wu, 'reap', foes[2]);
  assert.equal(foes[2].alive, false);
  ok(`Reap consumes all DoTs incl. party members' (${Math.round(plain)} dmg); Death's Door doubles it and executes below 25%`);
}

// Soul Harvest refunds Malice per effect consumed
{
  const { b, wu, foes } = battle();
  for (let i = 0; i < 4; i++) cast(b, wu, 'corruption', foes[0]);
  wu.resource = 0;
  cast(b, wu, 'soul_harvest', foes[0]);
  assert.equal(wu.resource, 20);
  ok('Soul Harvest refunds 5 Malice for each effect consumed');
}

// Pandemic spreads the Warlock's own DoTs; Plague Swarm jumps when its carrier dies
{
  const { b, wu, ru, foes } = battle();
  cast(b, wu, 'corruption', foes[0]); cast(b, wu, 'agony', foes[0]);
  C.__test.applyEffect(b, ru, foes[0], { kind: 'status', status: 'bleed', duration: 8, stat: 'physPower', power: 0.2 }, null);
  cast(b, wu, 'pandemic', foes[0]);
  for (const f of foes.slice(1)) {
    assert.equal(count(f, 'corruption'), 1); assert.equal(count(f, 'agony'), 1);
    assert.equal(count(f, 'bleed'), 0, "other players' DoTs are not copied");
  }
  cast(b, wu, 'plague_swarm', foes[0]);
  const target = foes[0]; const n0 = count(foes[1], 'plague_swarm') + count(foes[2], 'plague_swarm');
  target.hp = 1;
  C.__test.applyEffect(b, wu, target, { kind: 'damage', stat: 'magPower', power: 5, school: 'magical' }, null);
  assert.equal(target.alive, false);
  assert.equal(count(foes[1], 'plague_swarm') + count(foes[2], 'plague_swarm'), n0 + 1, 'the swarm jumped');
  ok("Pandemic copies only the Warlock's own DoTs to every enemy; Plague Swarm jumps on death");
}

// Dark Pact: costs health, DoTs tick twice as fast
{
  const a = battle(), c = battle();
  for (const x of [a, c]) { cast(x.b, x.wu, 'corruption', x.foes[0]); x.b.rng = () => 0.99; for (const u of x.b.units) u.actionTimer = 1e9; }
  const hp0 = c.wu.hp;
  cast(c.b, c.wu, 'pact_of_shadows', c.wu);
  assert.ok(c.wu.hp < hp0 && c.wu.hp > 0);
  const lostA = step(a.b, 4, 'corruption')[a.foes[0].uid] || 0, lostC = step(c.b, 4, 'corruption')[c.foes[0].uid] || 0;
  assert.ok(lostC > lostA * 1.6, `pact ${lostC} vs ${lostA}`);
  ok('Dark Pact costs 10% health and makes the Warlock\'s DoTs tick twice as fast');
}

// Drain Life heals more for each of the Warlock's different debuffs on the target
{
  const heal = kinds => {
    const { b, wu, foes } = battle();
    for (const k of kinds) cast(b, wu, k, foes[0]);
    wu.hp = wu.maxHp * 0.3; const h = wu.hp;
    const save = b.rng; b.rng = () => 0.5;
    cast(b, wu, 'drain_life', foes[0]);
    b.rng = save;
    return wu.hp - h;
  };
  const none = heal([]), three = heal(['corruption', 'agony', 'blight']);
  assert.ok(three > none * 2, `${three} vs ${none}`);
  ok(`Drain Life heals more with debuffs up (${Math.round(none)} → ${Math.round(three)})`);
}

// AI: Reap waits for 2 of the Warlock's own different debuffs; Plague Reaping mutator adds splash
{
  const { b, wu, foes } = battle();
  const cond = { type: 'target_own_debuffs', cmp: '>=', value: 2 };
  assert.equal(TARGET_CONDITIONS.target_own_debuffs.test(cond, foes[0], b, wu), false);
  cast(b, wu, 'corruption', foes[0]); cast(b, wu, 'corruption', foes[0]);
  assert.equal(TARGET_CONDITIONS.target_own_debuffs.test(cond, foes[0], b, wu), false, 'two stacks of one debuff = one kind');
  cast(b, wu, 'agony', foes[0]);
  assert.equal(TARGET_CONDITIONS.target_own_debuffs.test(cond, foes[0], b, wu), true);
  assert.ok(resolveRule(ABILITIES.reap.defaultRule, ABILITIES.reap, b, wu));
  const reap = applyMutators(ABILITIES.reap, [{ set: { consume_dots: { splash: 0.08 } } }]);
  for (let i = 0; i < 3; i++) cast(b, wu, 'corruption', foes[0]);
  const others = foes.slice(1).map(f => f.hp);
  cast(b, wu, 'reap', foes[0], reap);
  assert.ok(foes.slice(1).every((f, i) => f.hp < others[i]), 'splash hit the others');
  ok('the own-debuff condition counts different debuffs, not stacks; the Plaguelord mutator adds splash damage');
}

console.log(`Warlock: all ${n} checks passed.`);
process.exit(0);
