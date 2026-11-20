// Cosmetics: buying costs gold, you own it and wear it; earned titles need the achievement; others see what you wear.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const { Store } = await import('../server/store.js');
const { Settings } = await import('../server/settings.js');
const { AdminManager } = await import('../server/admin.js');
const { Game } = await import('../server/game.js');
const { COSMETICS, publicCosmetics, ownsCosmetic } = await import('../shared/data/cosmetics.js');

let n = 0;
const ok = m => { n++; console.log(`  ✔ ${m}`); };
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ashen-cos-'));
const store = new Store(DATA, { log: () => {} });
const game = new Game({ store, assets: { get: () => ({}) }, log: () => {}, settings: new Settings(store), admins: new AdminManager(store, ''), buildId: 'test' });
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
const a = conn('c1', 'Alice'), b = conn('c2', 'Bob');
assert.ok(a.call('create_hero', { name: 'Ali', classId: 'warrior' }).ok);
const p = a.s.player;

assert.ok(Object.keys(COSMETICS.color).length && Object.keys(COSMETICS.title).length && Object.keys(COSMETICS.frame).length);
p.gold = 4000;
assert.match(a.call('cosmetic_buy', { kind: 'color', id: 'ember' }).error, /5,000 gold/);
p.gold = 60000;
b.msgs.length = 0;
assert.ok(a.call('cosmetic_buy', { kind: 'color', id: 'ember' }).ok);
assert.equal(p.gold, 55000);
assert.ok(ownsCosmetic(p, 'color', 'ember'));
assert.deepEqual(publicCosmetics(p), { color: 'ember' });
assert.deepEqual(b.msgs.find(m => m.t === 'cosmetic'), { t: 'cosmetic', name: 'Alice', cosmetics: { color: 'ember' } });
assert.match(a.call('cosmetic_buy', { kind: 'color', id: 'ember' }).error, /already own/);
ok('buying takes the gold, you own and wear it at once, and other players are told');

assert.match(a.call('cosmetic_equip', { kind: 'frame', id: 'gold' }).error, /don't own/);
assert.match(a.call('cosmetic_buy', { kind: 'title', id: 'the_bloodied' }).error, /earned/);
assert.match(a.call('cosmetic_equip', { kind: 'title', id: 'the_bloodied' }).error, /don't own/);
p.achievements.first_blood = Date.now();
assert.ok(a.call('cosmetic_equip', { kind: 'title', id: 'the_bloodied' }).ok);
assert.ok(a.call('cosmetic_equip', { kind: 'color', id: null }).ok);
assert.deepEqual(game.cosmeticMap(), { Alice: { title: 'the_bloodied' } });
const c = conn('c3', 'Cara');
assert.deepEqual(c.msgs.find(m => m.t === 'cosmetics').map, { Alice: { title: 'the_bloodied' } });
ok("can't wear what you don't own; earned titles come with the achievement; newcomers get the map of worn cosmetics");
console.log(`Cosmetics: all ${n} checks passed.`);
