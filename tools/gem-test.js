// Resonance gems: every gem's effect on its item's affixes, the combat gems in a fight, drops and the refund
// of the old stat gems.
import assert from 'node:assert/strict';
const { affixPlan, gearItemStats, gemValue, rollGemDrop, parseGemKey, GEM_IDS } = await import('../shared/gems.js');
const { affixValue, itemStats } = await import('../shared/data/items.js');
const { createCharacter } = await import('../shared/character.js');
const C = await import('../shared/combat.js');
const { migrateTown } = await import('../server/townLogic.js');

let n = 0;
const ok = m => { n++; console.log(`  ✔ ${m}`); };
const near = (a, b, msg) => assert.ok(Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.01), `${msg}: ${a} vs ${b}`);

// a level-50 ring with 2 prefixes and 2 suffixes of known tiers
const ring = (gems, affixes = null) => ({
  uid: 'r', baseId: 'ring', slot: 'ring', rarity: 'legendary', level: 50, requiredLevel: 48, stats: {},
  affixes: affixes || [{ stat: 'hp', tier: 2, roll: 0.5 }, { stat: 'physPower', tier: 6, roll: 0.5 }, { stat: 'str', tier: 4, roll: 0.5 }, { stat: 'dodge', tier: 7, roll: 0.2 }],
  sockets: gems,
});
const plain = it => Object.fromEntries((it.affixes).map(a => [a.stat, affixValue(a, it.level)]));
const planOf = it => Object.fromEntries(affixPlan(it).filter(a => !a.mirror).map(a => [a.stat, a]));

{
  const it = ring(['ladder:5']), base = plain(it), p = planOf(it), v = gemValue('ladder', 5);
  near(p.hp.value, base.hp * (1 + v * 5), 'Ladder T2');
  near(p.physPower.value, base.physPower * (1 + v * 1), 'Ladder T6');
  assert.equal(p.dodge.value, base.dodge, 'Ladder T7 unchanged');
  ok('Ladder: +X% per tier above T7');
}
{
  const p = planOf(ring(['keystone:1']));
  assert.equal(p.dodge.eff, 6, 'Chipped Keystone: weakest climbs 1 tier');
  const p5 = planOf(ring(['keystone:5']));
  assert.equal(p5.dodge.eff, 2, 'Perfect Keystone: up to the best tier, never past it');
  ok('Keystone: the weakest affix climbs tiers, capped at the best');
}
{
  const it = ring(['underdog:3']), base = plain(it), p = planOf(it), v = gemValue('underdog', 3);
  near(p.physPower.value, base.physPower * (1 + v), 'T6');
  assert.equal(p.str.value, base.str, 'T4 unchanged');
  ok('Underdog: only T5–T7 affixes');
}
{
  const it = ring(['harmony:1'], [{ stat: 'hp', tier: 5, roll: 0.5 }, { stat: 'defense', tier: 5, roll: 0.5 }, { stat: 'physPower', tier: 5, roll: 0.5 }, { stat: 'str', tier: 5, roll: 0.5 }]);
  const p = planOf(it), base = plain(it);
  near(p.hp.value, base.hp * (1 + gemValue('harmony', 1)), 'full prefix side');
  assert.equal(p.str.value, base.str, 'suffix side not full');
  const bal = planOf(ring(['balance:2'])), b0 = plain(ring([]));
  near(bal.str.value, b0.str * (1 + gemValue('balance', 2)), 'Balance 2/2');
  const unbal = planOf({ ...it, sockets: ['balance:2'] });
  assert.equal(unbal.hp.value, base.hp, 'Balance 3/1 does nothing');
  ok('Harmony: a full side gets the bonus; Balance: equal prefixes and suffixes');
}
{
  const same = ring(['purity:1'], [{ stat: 'hp', tier: 4, roll: 0.1 }, { stat: 'str', tier: 4, roll: 0.9 }]);
  near(planOf(same).hp.value, plain(same).hp * (1 + gemValue('purity', 1)), 'pure');
  assert.equal(planOf(ring(['purity:1'])).hp.value, plain(ring([])).hp, 'mixed tiers: nothing');
  // Keystone can make an item pure
  const two = ring(['purity:1', 'keystone:5'], [{ stat: 'hp', tier: 2, roll: 0.5 }, { stat: 'str', tier: 6, roll: 0.5 }]);
  assert.ok(planOf(two).str.mult > 1, 'Keystone + Purity');
  ok('Purity: all affixes on one tier (Keystone can get you there)');
}
{
  const it = ring(['sacrifice:2']), p = planOf(it), base = plain(it);
  assert.ok(p.dodge.off && p.dodge.value === 0, 'the weakest is switched off');
  near(p.hp.value, base.hp * (1 + gemValue('sacrifice', 2) * 3), 'others +X% per remaining affix');
  ok('Sacrifice: weakest off, the rest stronger');
}
{
  const it = ring(['mirror:5']), list = affixPlan(it), m = list.find(a => a.mirror);
  assert.equal(m.stat, 'hp');
  near(m.value, plain(it).hp * gemValue('mirror', 5), 'Mirror value');
  const st = gearItemStats(it);
  near(st.hp, plain(it).hp * (1 + gemValue('mirror', 5)) + (itemStats({ ...it, affixes: [] }).hp || 0), 'item stats include the copy');
  ok('Mirror: the best affix once more at a share of its value');
}

// combat gems in a fight
{
  const mk = gems => {
    const ch = createCharacter({ id: 'w', name: 'W', classId: 'warrior', level: 50, isMain: true });
    ch.equipment = { ...ch.equipment, ring: ring(gems, [{ stat: 'hp', tier: 3, roll: 0.5 }, { stat: 'physPower', tier: 3, roll: 0.5 }, { stat: 'str', tier: 3, roll: 0.5 }]) };
    const b = C.createBattle({ seed: 1, allies: [C.makeCharacterUnit(ch, { ownerId: 'p', ownerName: 'P', position: 0 })], waves: [[{ enemyId: 'swamp_troll', level: 50 }, { enemyId: 'swamp_troll', level: 50 }]] });
    const u = b.units[0];
    for (const e of b.units.filter(x => x.side === 'B')) { e.actionTimer = 1e9; e.hp = e.maxHp = 1e8; }
    u.actionTimer = 1e9; u.undying = true;
    return { b, u };
  };
  const plainU = mk([]).u;
  // Tide: prefixes first, then suffixes
  const t = mk(['tide:5']);
  C.stepBattle(t.b);
  assert.ok(t.u.stats.physPower > plainU.stats.physPower && t.u.maxHp > plainU.maxHp, 'prefix phase');
  const prefixPhase = { pp: t.u.stats.physPower, hp: t.u.maxHp };
  for (let i = 0; i < 85; i++) C.stepBattle(t.b);
  assert.ok(t.u.maxHp < prefixPhase.hp && t.u.stats.physPower !== prefixPhase.pp, 'suffix phase: the prefix bonus is gone, the suffix one is on');
  for (let i = 0; i < 80; i++) C.stepBattle(t.b);
  assert.equal(t.u.maxHp, prefixPhase.hp, 'and back');
  ok('Tide: prefixes, then suffixes, every 8 s');
  // Last Stand: defensive affixes below 50% health
  const l = mk(['last_stand:5']);
  C.stepBattle(l.b);
  const hp0 = l.u.maxHp;
  l.u.hp = l.u.maxHp * 0.3;
  C.stepBattle(l.b);
  assert.ok(l.u.maxHp > hp0, 'more health below 50%');
  l.u.hp = l.u.maxHp;
  C.stepBattle(l.b);
  assert.equal(Math.round(l.u.maxHp), Math.round(hp0), 'back to normal when healed');
  ok('Last Stand: defensive affixes boosted below 50% health');
  // Momentum: stacks on kills, fades after its duration
  const m = mk(['momentum:5']);
  C.stepBattle(m.b);
  const p0 = m.u.stats.physPower;
  const foes = m.b.units.filter(x => x.side === 'B');
  C.__test.applyEffect(m.b, m.u, foes[0], { kind: 'damage', stat: 'physPower', power: 1e7, school: 'physical' }, null);
  assert.ok(m.u.stats.physPower > p0, 'stack after a kill');
  for (let i = 0; i < 110; i++) C.stepBattle(m.b);
  assert.ok(Math.abs(m.u.stats.physPower - p0) < 1e-6, 'stacks fade');
  ok('Momentum: kills stack offensive affixes, then they fade');
}

// drops and the refund of old stat gems
{
  let seed = 3; const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  let got = 0, best = 0;
  for (let i = 0; i < 20000; i++) { const g = rollGemDrop(rng, 60, 'boss'); if (g) { got++; best = Math.max(best, parseGemKey(g).tier); } }
  assert.ok(got > 2000 && got < 6000 && best >= 4, `${got} drops, best quality ${best}`);
  assert.equal(rollGemDrop(() => 0, 20, 'normal').split(':')[1], '1', 'low level: Chipped only');
  assert.equal(rollGemDrop(() => 0, 10, 'boss'), null, 'no gems from enemies below level 18');
  const p = { inventory: [{ uid: 'x', sockets: ['str:2', 'ladder:1'] }], characters: {}, mailbox: [], gold: 0,
    town: { gems: { 'str:1': 2, 'ladder:3': 1 }, materials: { shard_str: 95 }, buildings: {} } };
  migrateTown(p);
  assert.deepEqual(p.inventory[0].sockets, [null, 'ladder:1']);
  assert.deepEqual(p.town.gems, { 'ladder:3': 1 });
  assert.ok(!('shard_str' in p.town.materials) && p.town.materials.gem_fragment === 2 * 10 + 30 + 9);
  assert.equal(GEM_IDS.length, 11);
  ok('gem drops scale with enemy level; old stat gems and shards become Gem Fragments');
}
console.log(`gem-test: ${n} checks passed`);
