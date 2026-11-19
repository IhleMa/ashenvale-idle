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
console.log(`rogue-test: ${n} checks passed`);
