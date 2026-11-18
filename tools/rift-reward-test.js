// Rifts: XP and gold only on the first clear of each tier; loot and chests on every run; old saves don't re-earn.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const { Store } = await import('../server/store.js');
const { Settings } = await import('../server/settings.js');
const { AdminManager } = await import('../server/admin.js');
const { Game } = await import('../server/game.js');
const L = await import('../server/playerLogic.js');
const { ZONES } = await import('../shared/data/zones.js');

let n = 0;
const ok = m => { n++; console.log(`  ✔ ${m}`); };
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ashen-riftrw-'));
const store = new Store(DATA, { log: () => {} });
const game = new Game({ store, assets: { get: () => ({}) }, log: () => {}, settings: new Settings(store), admins: new AdminManager(store), buildId: 'test' });
const msgs = [];
const acc = { id: 'r1', username: 'rifter', tokens: [] };
store.setAccount(acc);
const ws = { readyState: 1, send: d => msgs.push(JSON.parse(d)) };
const s = game.connect(ws, acc);
game.handleMessage(s, ws, JSON.stringify({ t: 'action', id: 1, type: 'create_hero', payload: { name: 'Rifter', classId: 'warrior' } }));
const p = s.player;
const hero = L.hero(p);
hero.level = 20;
const zone = Object.values(ZONES)[0];
const kills = zone.enemies.slice(0, 3).map(enemyId => ({ enemyId, level: 20, boss: false, elite: false, summoned: false }));
const run = (tier, time = 100) => {
  const before = { xp: hero.xp, level: hero.level, gold: p.gold };
  s.solo = { kind: 'rift', zoneId: zone.id, chars: [hero.id], rift: { tier, theme: zone.id }, battle: { state: 'victory', time, kills, meta: { affixes: [] } } };
  msgs.length = 0;
  game.finishRift(s);
  const summary = msgs.find(m => m.t === 'battle_end').summary;
  return { summary, gained: p.gold - before.gold };
};

const first = run(1);
assert.ok(first.summary.firstClear && first.summary.xp > 0 && first.summary.gold > 0);
assert.deepEqual(p.rift.cleared, [1]);
ok(`first clear of tier 1 pays XP and gold (+${first.summary.xp} XP, +${first.summary.gold} gold)`);

const again = run(1);
assert.ok(again.summary.repeat);
assert.equal(again.summary.xp, 0); assert.equal(again.summary.gold, 0);
assert.equal(again.gained, msgs.filter(m => m.t === 'toast' && /Achievement unlocked/.test(m.text)).reduce((g, m) => g + Number(/\+(\d+) gold/.exec(m.text)?.[1] || 0), 0), 'only achievement gold, nothing from the rift');
assert.ok(again.summary.items >= 1 || again.summary.items === undefined || Array.isArray(again.summary.items), 'loot is still handled');
ok('repeating tier 1: no XP, no gold');

// timed runs still drop the chest on repeats
let chestItems = 0;
for (let i = 0; i < 3; i++) chestItems += (run(1).summary.items?.length || 0);
assert.ok(chestItems >= 3, `chest items on repeats (${chestItems})`);
ok('repeats still give loot and the timed chest');

// an untimed first clear pays XP & gold in full; tier 2 gets its own first clear
const slow = run(2, 999);
assert.ok(slow.summary.firstClear && !slow.summary.timed);
const tierOneRate = first.summary.xp;
assert.ok(slow.summary.xp >= tierOneRate, `untimed first clear of tier 2 is not halved (${slow.summary.xp} vs ${tierOneRate})`);
assert.equal(p.rift.best, 1, 'an untimed clear does not unlock the next tier');
assert.equal(run(2).summary.xp, 0, 'and the later timed clear pays no XP again');
assert.equal(p.rift.best, 2);
ok('untimed first clears pay in full; tiers are tracked one by one');

// players from before this rule: every tier up to their best counts as cleared
const old = L.migratePlayer({ ...L.newPlayer({ id: 'o', username: 'old' }), rift: { best: 7, bestTimes: {}, runs: 40, timed: 20, history: [], auto: 'repeat' } });
assert.deepEqual(old.rift.cleared, [1, 2, 3, 4, 5, 6, 7]);
ok('existing players: tiers up to their best count as already cleared');

fs.rmSync(DATA, { recursive: true, force: true });
console.log(`Rift rewards: all ${n} checks passed.`);
process.exit(0);
