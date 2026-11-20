// Builds: save the skill tree, loadout and rules, switch between them for free.
import assert from 'node:assert/strict';
const L = await import('../server/playerLogic.js');
const { createCharacter, syncTree } = await import('../shared/character.js');
const { autoAllocate, totalSkillPoints } = await import('../shared/skilltree.js');

let n = 0;
const ok = m => { n++; console.log(`  ✔ ${m}`); };
const ch = createCharacter({ id: 'r', name: 'R', classId: 'rogue', level: 30, isMain: true });
const p = { gold: 0, characters: { r: ch } };

const treeA = [...ch.tree.allocated], loadA = [...ch.loadout];
ch.rules.backstab = { ...ch.rules.backstab, enabled: false };
L.saveBuild(p, { charId: 'r', slot: 0, name: 'Bossing' });
// a different build: reset and spend the points another way
ch.tree.allocated = ['start']; ch.loadout = []; ch.rules.backstab.enabled = true;
syncTree(ch); autoAllocate(ch); syncTree(ch);
ch.loadout = ch.loadout.slice(0, 2);
L.saveBuild(p, { charId: 'r', slot: 1, name: 'Arena' });
const treeB = [...ch.tree.allocated];
assert.equal(p.gold, 0);
const r = L.loadBuild(p, { charId: 'r', slot: 0 });
assert.deepEqual(ch.tree.allocated, treeA);
assert.deepEqual(ch.loadout, loadA);
assert.equal(ch.rules.backstab.enabled, false);
assert.equal(r.missing, 0);
assert.equal(ch.activeBuild, 0);
L.loadBuild(p, { charId: 'r', slot: 1 });
assert.deepEqual(ch.tree.allocated, treeB);
assert.equal(p.gold, 0, 'switching is free');
ok('save two builds and switch between them for free (tree, loadout and rules)');

// fewer points than the build needs (e.g. after ascension): the build is trimmed to what fits
ch.level = 10;
const r2 = L.loadBuild(p, { charId: 'r', slot: 0 });
assert.ok(r2.missing > 0 && ch.tree.allocated.length - 1 <= totalSkillPoints(ch), `${r2.missing} ${ch.tree.allocated.length}`);
assert.ok(ch.loadout.every(a => ch.abilities[a]));
ok(`a build bigger than the available points is trimmed (${r2.missing} nodes left out)`);

L.renameBuild(p, { charId: 'r', slot: 1, name: '  PvP  ' });
assert.equal(ch.builds[1].name, 'PvP');
L.deleteBuild(p, { charId: 'r', slot: 1 });
assert.equal(ch.builds[1], null);
assert.throws(() => L.loadBuild(p, { charId: 'r', slot: 1 }));
assert.throws(() => L.saveBuild(p, { charId: 'r', slot: 3 }));
ok('rename, delete, empty and invalid slots');
// planned build: the plan gets the points as the character levels up
{
  const { planPathTo } = await import('../shared/skilltree.js');
  const c = createCharacter({ id: 'm', name: 'M', classId: 'mage', level: 5, isMain: true, autoTree: false });
  const q = { gold: 0, characters: { m: c }, settings: {}, stats: {} };
  c.tree.allocated = ['start']; syncTree(c);
  // plan a path far out (more nodes than points)
  const tree = (await import('../shared/data/skilltree.js')).getTree('mage');
  const far = Object.values(tree.nodes).filter(x => x.type === 'keystone')[0].id;
  const path = planPathTo(c, far);
  assert.ok(path.length > totalSkillPoints(c));
  const r = L.setTreePlan(q, { charId: 'm', plan: path });
  assert.equal(r.allocated, totalSkillPoints(c), 'free points spent right away');
  assert.deepEqual(c.tree.allocated.slice(1), path.slice(0, r.allocated), 'in plan order');
  assert.throws(() => L.setTreePlan(q, { charId: 'm', plan: [far] }), /connect/);
  // level up: the new points follow the plan
  const before = c.tree.allocated.length;
  L.applyRewards(q, [c], { xp: 1e6, gold: 0, items: [], killList: [] });
  assert.ok(c.level > 5 && c.tree.allocated.length > before);
  assert.deepEqual(c.tree.allocated.slice(1), path.slice(0, c.tree.allocated.length - 1));
  // builds keep the plan; nodes that don't fit go back to the plan
  L.saveBuild(q, { charId: 'm', slot: 0, name: 'Plan' });
  c.level = 5;
  L.loadBuild(q, { charId: 'm', slot: 0 });
  assert.equal(c.tree.plan[0], path[c.tree.allocated.length - 1], 'trimmed nodes come first in the plan again');
  ok('planned build: points follow the plan in order on level up; builds keep the plan');
}
console.log(`build-test: ${n} checks passed`);
