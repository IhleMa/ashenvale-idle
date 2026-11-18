// Admin → player → Experience: add XP, add levels, set level (also lower), for hero / party / all / one character.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const { Store } = await import('../server/store.js');
const { Settings } = await import('../server/settings.js');
const { AdminManager } = await import('../server/admin.js');
const { Game } = await import('../server/game.js');
const L = await import('../server/playerLogic.js');
const { CONFIG, xpToNext } = await import('../shared/config.js');
const { spentPoints, totalSkillPoints } = await import('../shared/skilltree.js');

let n = 0;
const ok = m => { n++; console.log(`  ✔ ${m}`); };
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ashen-axp-'));
const store = new Store(DATA, { log: () => {} });
const admins = new AdminManager(store, 'boss');
const game = new Game({ store, assets: { get: () => ({}) }, log: () => {}, settings: new Settings(store), admins, buildId: 'test' });
const conn = (id, username) => {
  const acc = { id, username, tokens: [] };
  store.setAccount(acc);
  const msgs = [];
  const ws = { readyState: 1, send: d => msgs.push(JSON.parse(d)) };
  const s = game.connect(ws, acc);
  let rid = 0;
  const call = (type, payload) => { msgs.length = 0; const my = ++rid; game.handleMessage(s, ws, JSON.stringify({ t: 'action', id: my, type, payload })); return msgs.find(m => m.t === 'result' && m.id === my); };
  return { s, call, msgs };
};
const boss = conn('a1', 'boss');
boss.call('create_hero', { name: 'Boss', classId: 'warrior' });
const pl = conn('a2', 'player');
pl.call('create_hero', { name: 'Hero', classId: 'mage' });
const p = pl.s.player;
const h = L.hero(p);
p.settings.autoDevelopHero = false;

// non-admins can't
assert.equal(pl.call('admin_give_xp', { id: 'a2', mode: 'xp', amount: 100 }).ok, false);
ok('only admins can give XP');

// raw XP → level-ups, no hero bonus
const need = xpToNext(1) + xpToNext(2) + 5;
let r = boss.call('admin_give_xp', { id: 'a2', target: 'hero', mode: 'xp', amount: need });
assert.ok(r.ok, r.error);
assert.equal(h.level, 3); assert.equal(h.xp, 5);
assert.ok(pl.msgs.some(m => m.t === 'toast' || JSON.stringify(m).includes('server admins gave you')));
ok('add XP: exact raw amount, levels up, player notified');

// whole levels keep progress
h.xp = Math.floor(xpToNext(3) / 2);
r = boss.call('admin_give_xp', { id: 'a2', target: 'hero', mode: 'levels', amount: 10 });
assert.ok(r.ok);
assert.equal(h.level, 13);
assert.ok(Math.abs(h.xp / xpToNext(13) - 0.5) < 0.02);
assert.equal(totalSkillPoints(h) - spentPoints(h) > 0, true, 'new skill points are unspent');
ok('add levels: +10 levels, half-way progress kept, points to spend');

// set to cap, then lower: tree trimmed to the budget
r = boss.call('admin_give_xp', { id: 'a2', target: 'hero', mode: 'set', amount: CONFIG.levelCap });
assert.equal(h.level, CONFIG.levelCap); assert.equal(h.xp, 0);
p.settings.autoDevelopHero = true;
L.adminGrantXp(p, { target: 'hero', mode: 'set', amount: CONFIG.levelCap }); // no change
const { autoAllocate } = await import('../shared/skilltree.js');
const { syncTree } = await import('../shared/character.js');
autoAllocate(h); syncTree(h);
assert.equal(spentPoints(h), totalSkillPoints(h));
boss.call('admin_give_xp', { id: 'a2', target: 'hero', mode: 'set', amount: 5 });
assert.equal(h.level, 5);
assert.ok(spentPoints(h) <= totalSkillPoints(h), 'tree trimmed after lowering the level');
assert.equal(p.stats.heroLevel, 5);
ok('set level: to the cap and back down to 5, skill tree trimmed');

// targets: all characters / one character
const rec = Object.values(p.characters).find(c => !c.isMain) || null;
r = boss.call('admin_give_xp', { id: 'a2', target: 'all', mode: 'levels', amount: 2 });
assert.ok(r.result.results.length === Object.keys(p.characters).length);
if (rec) {
  const before = rec.level;
  boss.call('admin_give_xp', { id: 'a2', target: rec.id, mode: 'levels', amount: 1 });
  assert.equal(rec.level, before + 1);
}
assert.equal(boss.call('admin_give_xp', { id: 'a2', target: 'nope', mode: 'xp', amount: 5 }).ok, false);
assert.equal(boss.call('admin_give_xp', { id: 'a2', target: 'hero', mode: 'set', amount: 999 }).ok, false);
assert.equal(boss.call('admin_give_xp', { id: 'a2', target: 'hero', mode: 'xp', amount: 0 }).ok, false);
ok('targets (all / single character) and invalid input rejected');

assert.ok(admins.log.some(e => e.action === 'give_xp' && e.target === 'player'));
ok('audit log entry written');

fs.rmSync(DATA, { recursive: true, force: true });
console.log(`Admin XP: all ${n} checks passed.`);
process.exit(0);
