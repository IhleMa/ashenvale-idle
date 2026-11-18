// Ascension: hero-only, at the level cap, gear mailed, back to level 1 with the subclass branch, switch only at cap again.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const { Store } = await import('../server/store.js');
const { Settings } = await import('../server/settings.js');
const { AdminManager } = await import('../server/admin.js');
const { Game } = await import('../server/game.js');
const L = await import('../server/playerLogic.js');
const { CONFIG } = await import('../shared/config.js');
const { SUBCLASSES, subclassesOf } = await import('../shared/data/subclasses.js');
const { CLASSES } = await import('../shared/data/classes.js');
const { getTree } = await import('../shared/data/skilltree.js');
const { classAbilities } = await import('../shared/data/abilities.js');
const { totalSkillPoints, treeStats, allocateNode, pathTo } = await import('../shared/skilltree.js');
const { abilityNodeId, syncTree } = await import('../shared/character.js');
const { makeCharacterUnit, publicUnit } = await import('../shared/combat.js');

let n = 0;
const ok = m => { n++; console.log(`  ✔ ${m}`); };
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ashen-asc-'));
const store = new Store(DATA, { log: () => {} });
const game = new Game({ store, assets: { get: () => ({}) }, log: () => {}, settings: new Settings(store), admins: new AdminManager(store), buildId: 'test' });
const msgs = [];
const acc = { id: 'a1', username: 'ascender', tokens: [] };
store.setAccount(acc);
const ws = { readyState: 1, send: d => msgs.push(JSON.parse(d)) };
const s = game.connect(ws, acc);
let reqId = 1;
const action = (type, payload) => {
  msgs.length = 0;
  game.handleMessage(s, ws, JSON.stringify({ t: 'action', id: ++reqId, type, payload }));
  return msgs.find(m => m.t === 'result' && m.id === reqId) || msgs.find(m => m.id === reqId);
};
action('create_hero', { name: 'Ascender', classId: 'warrior' });
const p = s.player;
const h = L.hero(p);

// every class has 2-3 subclasses, each with its own abilities
for (const c of Object.keys(CLASSES)) {
  const subs = subclassesOf(c);
  assert.ok(subs.length >= 2 && subs.length <= 3, `${c} has ${subs.length} subclasses`);
  for (const sub of subs) assert.ok(classAbilities(c, sub.id).some(a => a.subclass === sub.id));
  assert.ok(!classAbilities(c).some(a => a.subclass), 'base class list has no subclass abilities');
}
ok('every class has 2-3 subclasses with their own abilities');

// not before the cap
const [first, second] = subclassesOf('warrior');
assert.throws(() => L.ascendHero(p, { subclassId: first.id }), /level/);
ok('cannot ascend below the level cap');

h.level = CONFIG.levelCap;
h.xp = 0;
assert.throws(() => L.ascendHero(p, { subclassId: subclassesOf('mage')[0].id }), /not a Warrior subclass/);
ok('subclass must belong to the hero class');

const equipped = Object.values(h.equipment).filter(Boolean).length;
assert.ok(equipped > 0, 'hero starts with some gear');
const mailBefore = (p.mailbox || []).length;
const res = action('ascend', { subclassId: first.id });
assert.ok(!res?.error, res?.error);
assert.equal(h.subclass, first.id);
assert.equal(h.level, 1);
assert.equal(h.xp, 0);
assert.equal(h.ascensions, 1);
assert.equal(Object.values(h.equipment).filter(Boolean).length, 0);
assert.equal(p.mailbox.length - mailBefore, equipped);
assert.ok(p.mailbox.slice(-equipped).every(m => m.item && m.from === 'Ascension'));
assert.equal(p.stats.ascensions, 1);
ok(`ascended as ${first.name}: level 1, ${equipped} items mailed, subclass set`);

// tree: base branches kept, subclass branch added, subclass ability reachable
const base = getTree('warrior');
const tree = getTree('warrior', first.id);
assert.equal(tree.branches.length, base.branches.length + first.branches.length);
assert.ok(Object.keys(base.nodes).every(id => tree.nodes[id]), 'all base nodes kept');
assert.ok(Object.values(tree.nodes).some(nd => nd.subclass === first.id));
const subAb = classAbilities('warrior', first.id).find(a => a.subclass === first.id);
const nodeId = abilityNodeId('warrior', subAb.id, first.id);
assert.ok(tree.nodes[nodeId], 'subclass ability node exists');
const plain = { ...h, subclass: null };
assert.equal(totalSkillPoints(h) - totalSkillPoints(plain), CONFIG.ascension.bonusSkillPoints);
const ts = treeStats(h);
for (const [k, v] of Object.entries(first.bonus)) assert.ok((ts[k] || 0) >= v - 1e-9, `passive ${k}`);
const need = pathTo(h, nodeId);
assert.ok(need.length <= totalSkillPoints(h), 'subclass ability reachable with the bonus points');
for (const id of need) allocateNode(h, id);
syncTree(h);
assert.ok(h.abilities[subAb.id], 'subclass ability learned');
ok(`tree has ${tree.branches.length} branches; +${CONFIG.ascension.bonusSkillPoints} points; passive applied; ${subAb.name} learnable`);

// combat unit carries the subclass for display
const u = publicUnit(makeCharacterUnit(h, { ownerId: p.id, ownerName: p.name, position: 0 }));
assert.equal(u.subclass, first.id);
ok('combat units carry the subclass');

// same subclass rejected, switch only at the cap again
h.level = CONFIG.levelCap;
assert.throws(() => L.ascendHero(p, { subclassId: first.id }), /already/);
h.level = CONFIG.levelCap - 1;
assert.throws(() => L.ascendHero(p, { subclassId: second.id }), /level/);
h.level = CONFIG.levelCap;
L.ascendHero(p, { subclassId: second.id });
assert.equal(h.subclass, second.id);
assert.equal(h.level, 1);
assert.equal(h.ascensions, 2);
assert.equal(h.ascensionHistory.length, 2);
assert.ok(!h.abilities[subAb.id], 'old subclass ability gone after switching');
ok(`switched to ${second.name} at the cap again; same subclass rejected`);

// XP from much higher enemies is capped for ascended heroes only
const kills = [{ enemyId: Object.keys((await import('../shared/data/enemies.js')).ENEMIES)[0], level: 60, boss: false, elite: false }];
h.level = 5;
const f = L.ascendedXpFactor(h, kills);
assert.ok(f > 0 && f < 1, `factor ${f}`);
assert.equal(L.ascendedXpFactor({ ...h, subclass: null }, kills), 1);
assert.equal(L.ascendedXpFactor(h, [{ ...kills[0], level: 7 }]), 1);
ok(`kill XP capped at level+${CONFIG.ascension.xpLevelGap} while re-levelling (factor ${f.toFixed(2)})`);

// recruits can't ascend (hero only) and the setting can turn it off
CONFIG.ascension.enabled = false;
h.level = CONFIG.levelCap;
assert.throws(() => L.ascendHero(p, { subclassId: first.id }), /turned off/);
CONFIG.ascension.enabled = true;
ok('ascension can be turned off in config');

assert.ok(Object.keys(SUBCLASSES).length >= 12);
fs.rmSync(DATA, { recursive: true, force: true });
console.log(`Ascension: all ${n} checks passed.`);
process.exit(0);
