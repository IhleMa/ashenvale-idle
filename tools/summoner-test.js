// Summoner & minions: summoning, limits, renewing, expiry, sacrifice, extend, targeting and battle end rules.
import assert from 'node:assert/strict';
const { createCharacter } = await import('../shared/character.js');
const C = await import('../shared/combat.js');
const { alliesOf, ownMinions, resolveRule } = await import('../shared/rules.js');
const { ABILITIES } = await import('../shared/data/abilities.js');
const { MINIONS } = await import('../shared/data/minions.js');

let n = 0;
const ok = m => { n++; console.log(`  ✔ ${m}`); };
const battle = (lvl = 20, waves = [[{ enemyId: 'wolf', level: 20 }, { enemyId: 'wolf', level: 20 }]], autoTree = false) => {
  const s = createCharacter({ id: 's', name: 'Nyx', classId: 'summoner', level: lvl, isMain: true, autoTree });
  const w = createCharacter({ id: 'w', name: 'Brom', classId: 'warrior', level: lvl });
  const b = C.createBattle({ seed: 3, allies: [C.makeCharacterUnit(w, { ownerId: 'p', ownerName: 'P', position: 0 }), C.makeCharacterUnit(s, { ownerId: 'p', ownerName: 'P', position: 1 })], waves });
  return { b, su: b.units.find(u => u.charId === 's'), wu: b.units.find(u => u.charId === 'w') };
};
const cast = (b, u, abilityId, target = u) => { for (const eff of ABILITIES[abilityId].effects) C.__test.applyEffect(b, u, target, eff, abilityId); };

// summon + limit + renew
{
  const { b, su } = battle();
  cast(b, su, 'raise_skeleton'); cast(b, su, 'raise_skeleton'); cast(b, su, 'raise_skeleton');
  assert.equal(ownMinions(b, su, 'skeleton').length, 3);
  const m = ownMinions(b, su)[0];
  assert.equal(m.maxHp, Math.round(su.maxHp * MINIONS.skeleton.hp));
  assert.ok(m.stats.physPower > 0 && m.side === 'A' && m.kind === 'minion');
  b.time = 10; m.hp = 1;
  cast(b, su, 'raise_skeleton');
  assert.equal(ownMinions(b, su, 'skeleton').length, 3, 'the limit holds');
  assert.equal(m.hp, m.maxHp, 'at the limit the oldest is renewed');
  assert.ok(m.expiresAt > 30);
  ok('summoning respects the limit and renews the oldest minion');
  // allies vs minions
  assert.ok(!alliesOf(b, su).some(u => u.kind === 'minion'), 'healers and "ally" conditions ignore minions');
  const wolf = b.units.find(u => u.side === 'B');
  assert.ok(C.enemiesOf(b, wolf).some(u => u.kind === 'minion'), 'enemies can attack minions');
  assert.ok(wolf.threatTable[m.uid] >= 0);
  ok('minions are not "allies" for healing, but enemies see and attack them');
  // rules
  const r = resolveRule(ABILITIES.raise_skeleton.defaultRule, ABILITIES.raise_skeleton, b, su);
  assert.equal(r, null, 'default rule stops at 3 skeletons');
  const pact = resolveRule(ABILITIES.dark_pact.defaultRule, ABILITIES.dark_pact, b, su);
  assert.equal(pact.length, 3);
  assert.ok(pact.every(t => t.kind === 'minion'));
  ok('rules: "number of my minions" and "all my minions" target the summoner\'s minions');
}

// ranks on summon abilities make the minion stronger: +20% health and power per rank
{
  const r1 = battle(), r3 = battle();
  r3.su.ranks.bone_golem = 3;
  cast(r1.b, r1.su, 'bone_golem'); cast(r3.b, r3.su, 'bone_golem');
  const g1 = ownMinions(r1.b, r1.su, 'bone_golem')[0], g3 = ownMinions(r3.b, r3.su, 'bone_golem')[0];
  assert.ok(Math.abs(g3.maxHp / g1.maxHp - 1.4) < 0.01, `${g3.maxHp} vs ${g1.maxHp}`);
  assert.ok(Math.abs(g3.stats.physPower / g1.stats.physPower - 1.4) < 0.02);
  ok('a rank 3 Bone Golem has 40% more health and power than rank 1');
}
// expiry, owner death
{
  const { b, su } = battle();
  cast(b, su, 'raise_skeleton');
  const m = ownMinions(b, su)[0];
  m.expiresAt = b.time + 0.05;
  for (let i = 0; i < 3; i++) C.stepBattle(b);
  assert.ok(!b.units.includes(m), 'faded minions leave the battle');
  cast(b, su, 'raise_skeleton'); cast(b, su, 'summon_imp');
  assert.equal(ownMinions(b, su).length, 3);
  su.alive = false; su.hp = 0;
  C.stepBattle(b);
  assert.equal(b.units.filter(u => u.kind === 'minion').length, 0, 'minions vanish with their summoner');
  ok('minions fade after their duration and when their summoner falls');
}
// sacrifice + extend
{
  const { b, su } = battle();
  cast(b, su, 'raise_skeleton'); cast(b, su, 'raise_skeleton');
  const [a, c] = ownMinions(b, su);
  c.expiresAt = 5;
  const hpBefore = b.units.filter(u => u.side === 'B').map(u => u.hp);
  cast(b, su, 'corpse_explosion');
  assert.ok(!c.alive && a.alive, 'the minion closest to fading explodes');
  assert.ok(b.units.filter(u => u.side === 'B').every((u, i) => u.hp < hpBefore[i]), 'every enemy is hit');
  const exp = a.expiresAt;
  for (const eff of ABILITIES.soul_link.effects) C.__test.applyEffect(b, su, a, eff, 'soul_link');
  assert.equal(a.expiresAt, exp + 10);
  assert.ok(a.statuses.some(s => s.id === 'soul_link'));
  ok('Corpse Explosion detonates a minion for area damage; Soul Link extends and protects');
}

// Lich "Grave Detonation": every minion explodes
{
  const { applyMutators } = await import('../shared/mutators.js');
  const { b, su } = battle(20, [[{ enemyId: 'wolf', level: 60 }]]);
  cast(b, su, 'raise_skeleton'); cast(b, su, 'raise_skeleton');
  const wolf = b.units.find(u => u.side === 'B');
  const ab = applyMutators(ABILITIES.corpse_explosion, [{ set: { sacrifice: { all: true } } }]);
  const before = wolf.hp;
  for (const eff of ab.effects) C.__test.applyEffect(b, su, su, eff, 'corpse_explosion');
  assert.equal(ownMinions(b, su).length, 0, 'every minion detonated');
  assert.ok(before - wolf.hp > 0);
  ok('Lich Grave Detonation: Corpse Explosion detonates every minion at once');
}
// battle end: minions alone can't keep a fight going
{
  const { b, su, wu } = battle();
  cast(b, su, 'raise_skeleton');
  su.alive = false; wu.alive = false;
  C.stepBattle(b);
  assert.equal(b.state, 'defeat');
  ok('a party with only minions left loses');
}
// skill-tree minion bonuses: more health, more of each kind
{
  const { b, su } = battle();
  su.minionBonus = { damagePct: 0.2, hpPct: 0.4, durationPct: 0.5, extraMax: 1 };
  for (let i = 0; i < 5; i++) cast(b, su, 'raise_skeleton');
  const mine = ownMinions(b, su, 'skeleton');
  assert.equal(mine.length, 4, 'Ossuary: one more of each kind');
  assert.equal(mine[0].maxHp, Math.round(su.maxHp * MINIONS.skeleton.hp * 1.4));
  assert.equal(mine[0].expiresAt, MINIONS.skeleton.duration * 1.5);
  assert.ok(mine[0].bonuses.damagePct >= 0.2);
  ok('tree bonuses: minion health, damage, duration and +1 of each kind');
}
// full fights end normally and stay deterministic
{
  const run = () => { const { b } = battle(15, [[{ enemyId: 'wolf', level: 15 }], [{ enemyId: 'wolf', level: 15 }, { enemyId: 'wolf', level: 15 }]], true); C.runToEnd(b); return `${b.state}:${b.time.toFixed(1)}`; };
  const a = run();
  assert.equal(a, run());
  assert.match(a, /^victory/);
  ok(`complete fights are deterministic (${a})`);
}
console.log(`Summoner: all ${n} checks passed.`);
