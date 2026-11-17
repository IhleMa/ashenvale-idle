// Bot players test: node tools/bot-test.js [simulated hours]
// Runs the real Game + BotManager on a temporary database with a fast-forwarded clock and reports
// what the bots got done.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOURS = Number(process.argv[2] || 3);
let fake = Date.now();
const realNow = Date.now;
Date.now = () => fake;

const { Store } = await import('../server/store.js');
const { Settings } = await import('../server/settings.js');
const { AdminManager } = await import('../server/admin.js');
const { Game } = await import('../server/game.js');
const { BotManager } = await import('../server/bots.js');
const L = await import('../server/playerLogic.js');

let failures = 0;
const ok = (c, m) => { console.log(c ? '✔' : '✘', m); if (!c) failures++; };
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ashen-bots-'));
const store = new Store(DATA, { log: () => {} });
const game = new Game({ store, assets: { get: () => ({}) }, log: () => {}, settings: new Settings(store), admins: new AdminManager(store), buildId: 'test' });
const logs = [];
const bots = new BotManager(game, { log: m => logs.push(m) });
game.bots = bots;

try {
  const made = bots.add(8);
  ok(made.length === 8 && store.getAccount(made[0].name)?.bot, `8 bots created: ${made.map(b => `${b.name} (${b.archetype})`).join(', ')}`);
  // keep everyone online for the test, a few log out midway
  for (const b of bots.bots.values()) { b.nextSwitch = fake; }
  const start = realNow();
  const ticks = HOURS * 3600 * 10;
  let wentOffline = 0;
  for (let i = 0; i < ticks; i++) {
    fake += 100;
    game.tick();
    if (i % 10 === 0) {
      for (const b of bots.bots.values()) if (b.online && b.nextSwitch < fake + 3600_000) b.nextSwitch = fake + 2 * 3600_000; // stay on
      if (i === Math.floor(ticks / 2)) for (const b of [...bots.bots.values()].slice(0, 2)) { bots.goOffline(b); b.nextSwitch = fake + 20 * 60_000; wentOffline++; }
      bots.tick();
    }
    if (i % 3000 === 0) game.auction.sweep?.();
  }
  console.log(`(simulated ${HOURS}h in ${((realNow() - start) / 1000).toFixed(1)}s)`);
  const list = bots.list();
  for (const x of list) console.log(`   ${x.online ? '●' : '○'} ${x.name.padEnd(14)} ${String(x.label).padEnd(8)} ${x.hero ? `Lv ${String(x.hero.level).padStart(2)} ${x.hero.classId.padEnd(7)}` : 'no hero'}  gold ${String(Math.floor(x.gold)).padStart(6)}  rift ${x.rift}  | ${x.doing}`);
  const players = [...bots.bots.keys()].map(id => store.loadPlayer(id));
  const heroes = players.map(p => L.hero(p)).filter(Boolean);
  ok(heroes.length === 8, 'every bot created a hero');
  const levels = heroes.map(h => h.level);
  ok(Math.max(...levels) >= 6 && new Set(levels).size > 1, `heroes levelled at different speeds: ${levels.sort((a, b) => a - b).join(', ')}`);
  ok(players.every(p => Object.keys(p.characters).length >= 3), `bots recruited companions: ${players.map(p => Object.keys(p.characters).length - 1).join(', ')}`);
  ok(players.some(p => p.unlockedZones.length > 1), `zone bosses beaten: ${players.map(p => p.unlockedZones.length).join(', ')}`);
  ok(players.some(p => Object.values(p.town.buildings).some(b => b.level > 1 || (b.upgrade && b.upgrade.to > 1))), 'town buildings upgraded');
  ok(players.some(p => p.stats.questsDone > 0 || p.quests?.daily?.some(q => q.claimed)), 'quests claimed');
  const eq = players.reduce((n, p) => n + Object.values(p.characters).reduce((m, c) => m + Object.values(c.equipment).filter(Boolean).length, 0), 0);
  ok(eq > 30, `bots equip gear (${eq} items worn)`);
  const ah = game.auction.data;
  ok(ah.listings.length + ah.history.length > 0, `auction house: ${ah.listings.length} listings, ${ah.history.length} sales`);
  console.log('   coop results:', [...bots.bots.values()].map(b => (b.recent || []).filter(x => x.kind === 'coop').map(x => x.won ? 'W' : 'L').join('')).join(' | '));
  if (process.env.DEBUG) { const { upgradeBlocker } = await import('../shared/town.js'); for (const p of players) console.log('   town', p.name, p.gold|0, upgradeBlocker(p, 'town_hall'), JSON.stringify(p.town.materials).slice(0, 160), (p.expeditions||[]).length); }
  const coop = players.reduce((n, p) => n + (p.stats.coopWins || 0), 0);
  ok(coop > 0 || [...bots.bots.values()].some(b => b.coopRuns), `co-op runs by bot groups: ${coop} wins`);
  ok(players.some(p => (p.expeditions || []).length || p.stats.expeditions), 'expeditions sent');
  ok(wentOffline === 2, 'bots log out and back in (offline progress)');
  ok(logs.length < 10, `few bot errors (${logs.length})${logs.length ? ': ' + logs.slice(0, 3).join(' | ') : ''}`);
  // invites from a "human"
  const human = { id: 'h1', username: 'human', tokens: [] };
  store.setAccount(human);
  const msgs = [];
  const ws = { readyState: 1, send: d => msgs.push(JSON.parse(d)) };
  const s = game.connect(ws, human);
  game.handleMessage(s, ws, JSON.stringify({ t: 'action', id: 1, type: 'create_hero', payload: { name: 'Tester', classId: 'cleric' } }));
  game.handleMessage(s, ws, JSON.stringify({ t: 'action', id: 2, type: 'group_create', payload: {} }));
  const target = [...bots.bots.values()].find(b => b.online && !game.groupOf(b.accountId));
  if (target) {
    game.handleMessage(s, ws, JSON.stringify({ t: 'action', id: 3, type: 'group_invite', payload: { name: target.name } }));
    for (let i = 0; i < 400; i++) { fake += 100; if (i % 10 === 0) bots.tick(); }
    const g = game.groupOf(s.player.id);
    ok(g && (g.members.includes(target.accountId) || !g.invites.has(target.accountId)), `bot ${target.name} answered the human's invite (${g?.members.includes(target.accountId) ? 'joined' : 'declined'})`);
  }
  const r = game.actions.get_rankings.call(game, s, { category: 'level' });
  ok(r.rows.some(x => x.bot), 'bots are tagged in rankings');
  ok(bots.remove(made[0].name) === 1 && !store.getAccount(made[0].name), 'bot removed with its account');
} catch (e) {
  console.error(e); failures++;
} finally {
  bots.stop();
  store.close();
  fs.rmSync(DATA, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
