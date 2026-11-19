// Co-op line-up: max 4 characters; heroes always fight, free places go to missing roles first, then in turn.
import assert from 'node:assert/strict';
const { coopLineup } = await import('../shared/coop.js');
const { createCharacter } = await import('../shared/character.js');

let n = 0;
const ok = m => { n++; console.log(`  ✔ ${m}`); };
let id = 0;
const ch = (classId, isMain = false) => createCharacter({ id: `c${++id}`, name: `${classId}${id}`, classId, level: 20, isMain });
const player = (pid, heroClass, ...picks) => ({ id: pid, hero: ch(heroClass, true), picks: picks.map(c => ch(c)) });
const sizes = l => Object.values(l.byPlayer).map(x => x.length);
const recruits = (l, pid) => l.byPlayer[pid].slice(1).map(c => c.classId);

{
  const l = coopLineup([player('a', 'summoner', 'warrior', 'cleric', 'mage', 'rogue')]);
  assert.deepEqual(recruits(l, 'a'), ['warrior', 'cleric', 'mage']);
  ok('alone: the hero and the first 3 recruits');
}
{
  const l = coopLineup([player('a', 'warrior', 'mage', 'rogue'), player('b', 'cleric', 'ranger', 'mage')]);
  assert.deepEqual(sizes(l), [2, 2]);
  ok('2 players: one recruit each (4 characters)');
}
{
  const l = coopLineup([player('a', 'mage', 'rogue', 'warrior'), player('b', 'cleric', 'ranger')]);
  assert.deepEqual(recruits(l, 'a'), ['warrior'], 'no tank among the heroes: A brings its tank instead of its first pick');
  ok('2 players: a missing tank is filled from the picks before the order');
}
{
  const l = coopLineup([player('a', 'warrior', 'mage'), player('b', 'mage', 'rogue', 'druid'), player('c', 'rogue', 'ranger')]);
  assert.deepEqual(sizes(l), [1, 2, 1]);
  assert.deepEqual(recruits(l, 'b'), ['druid']);
  assert.equal(l.reasons[l.byPlayer.b[1].id], 'role:healer');
  ok('3 players without a healer: whoever has a healer among their picks brings it');
}
{
  const ps = [player('a', 'warrior', 'mage'), player('b', 'cleric', 'rogue'), player('c', 'mage', 'ranger')];
  const who = turn => Object.entries(coopLineup(ps, turn).byPlayer).find(([, c]) => c.length === 2)[0];
  assert.deepEqual([0, 1, 2, 3].map(who), ['a', 'b', 'c', 'a']);
  ok('3 players with healer and tank: the recruit place goes round in turn');
}
{
  const l = coopLineup([player('a', 'warrior', 'mage'), player('b', 'cleric', 'rogue'), player('c', 'mage', 'ranger'), player('d', 'rogue', 'bard')]);
  assert.deepEqual(sizes(l), [1, 1, 1, 1]);
  ok('4 players: heroes only');
}
console.log(`Co-op: all ${n} checks passed.`);
