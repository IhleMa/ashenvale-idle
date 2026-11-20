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
  const l = coopLineup([player('a', 'summoner', 'warrior', 'cleric', 'mage')]);
  assert.deepEqual(recruits(l, 'a'), ['warrior']);
  ok('alone: only the hero and one recruit (co-op is made for groups)');
}
{
  const l = coopLineup([player('a', 'warrior', 'mage', 'rogue'), player('b', 'cleric', 'ranger', 'mage')]);
  assert.deepEqual(sizes(l), [2, 2]);
  ok('2 players: one recruit each (4 characters)');
}
{
  const l = coopLineup([player('a', 'warrior', 'mage'), player('b', 'mage', 'druid'), player('c', 'rogue', 'ranger')]);
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
{
  const ps = [player('a', 'warrior', 'mage'), player('b', 'cleric', 'rogue'), player('c', 'mage', 'ranger')];
  const l = coopLineup(ps, 0, ['c']);
  assert.deepEqual(sizes(l), [1, 1, 2]);
  assert.equal(l.reasons[l.byPlayer.c[1].id], 'leader');
  assert.deepEqual(sizes(coopLineup(ps, 0, ['b', 'c'])), [1, 2, 1], 'never more than the free places');
  assert.deepEqual(sizes(coopLineup(ps.slice(0, 2), 0, [])), [1, 1], 'the leader can leave every recruit out');
  assert.deepEqual(sizes(coopLineup(ps.slice(0, 2), 0, ['b'])), [1, 2]);
  ok('the leader chooses which offered recruits fight (still at most one each, never more than the free places)');
}
console.log(`Co-op: all ${n} checks passed.`);
