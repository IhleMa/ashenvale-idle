// Live balance statistics: combat counters, recording of real fights (bots) and the dashboard query.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

let fake = Date.now();
Date.now = () => fake;
const { createCharacter } = await import('../shared/character.js');
const C = await import('../shared/combat.js');
const { Store } = await import('../server/store.js');
const { Settings } = await import('../server/settings.js');
const { AdminManager } = await import('../server/admin.js');
const { Game } = await import('../server/game.js');
const { BotManager } = await import('../server/bots.js');

let n = 0;
const ok = m => { n++; console.log(`  ✔ ${m}`); };

// ---- combat counters: damage/heal/taken/deaths/casts per character; minion damage counts for the summoner
{
  const s = createCharacter({ id: 's', name: 'Nyx', classId: 'summoner', level: 20 });
  const c = createCharacter({ id: 'c', name: 'Mira', classId: 'cleric', level: 20 });
  const b = C.createBattle({ seed: 4, allies: [C.makeCharacterUnit(c, { ownerId: 'p', ownerName: 'P', position: 0 }), C.makeCharacterUnit(s, { ownerId: 'p', ownerName: 'P', position: 1 })], waves: [[{ enemyId: 'wolf', level: 20 }, { enemyId: 'wolf', level: 20 }], [{ enemyId: 'wolf', level: 20 }]] });
  const su = b.units.find(u => u.charId === 's'), cu = b.units.find(u => u.charId === 'c');
  const byUnit = new Map(b.units.map(u => [u.uid, u]));
  let expect = 0, healed = 0, taken = 0;
  while (b.state === 'running' && b.ticks < 20000) {
    C.stepBattle(b);
    for (const u of b.units) byUnit.set(u.uid, u);
    for (const e of C.drainEvents(b)) {
      if (e.type === 'spawn') byUnit.set(e.unit.uid, b.units.find(u => u.uid === e.unit.uid));
      const src = byUnit.get(e.src), tgt = byUnit.get(e.tgt);
      if (e.type === 'damage' && src && tgt?.side === 'B' && (src === su || src.ownerUid === su.uid)) expect += e.amount;
      if (e.type === 'heal' && src === cu) healed += e.amount;
      if (e.type === 'damage' && tgt === cu) taken += e.amount + e.absorbed;
    }
  }
  assert.equal(su.stat.dmg, expect, 'summoner damage includes minions');
  assert.ok(su.stat.casts.raise_skeleton > 0 && !Object.keys(su.stat.casts).some(a => a.startsWith('m_')), 'casts of the summoner only');
  assert.equal(cu.stat.heal, healed);
  assert.equal(cu.stat.taken, taken);
  ok(`combat counters are exact (summoner ${su.stat.dmg} damage incl. minions, cleric ${cu.stat.heal} healing)`);
}

// ---- real fights are recorded (bots, 1 simulated hour) and the query aggregates them
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ashen-balance-'));
try {
  const store = new Store(DATA, { log: () => {} });
  const game = new Game({ store, assets: { get: () => ({}) }, log: () => {}, settings: new Settings(store), admins: new AdminManager(store), buildId: 'test' });
  const bots = new BotManager(game, { log: () => {} });
  game.bots = bots;
  bots.add(5);
  for (const b of bots.bots.values()) b.nextSwitch = fake;
  for (let i = 0; i < 3600 * 10; i++) {
    fake += 100;
    game.tick();
    if (i % 10 === 0) { for (const b of bots.bots.values()) if (b.online && b.nextSwitch < fake + 3600_000) b.nextSwitch = fake + 2 * 3600_000; bots.tick(); }
    if (i % 50_000 === 0) game.save();
  }
  game.save();
  const q = game.balance.query({ hours: 24, who: 'bot' });
  assert.ok(q.players === 5, `5 bot players (${q.players})`);
  assert.ok(q.characterFights > 100, `character fights recorded (${q.characterFights})`);
  const cls = Object.entries(q.classes);
  assert.ok(cls.length >= 3 && cls.every(([, v]) => v.n > 0 && v.sec > 0), 'per class and level band');
  assert.ok(cls.some(([, v]) => v.dmg > 0) && cls.some(([, v]) => v.wins > 0));
  assert.ok(Object.keys(q.casts).length > 3, 'ability casts');
  assert.ok(Object.keys(q.fights).some(k => k.startsWith('idle|')), 'zones');
  assert.ok(Object.values(q.econ).some(e => e.xp > 0 && e.gold > 0), 'XP and gold per hour');
  const lv = Object.entries(q.levels).filter(([k]) => k.startsWith('*|'));
  assert.ok(lv.length >= 3 && lv.every(([, v]) => v.median > 0 && v.median < 3600), `hero level times in seconds, within the simulated hour (${lv.map(([k, v]) => `${k.slice(2)}:${Math.round(v.median)}s`).join(' ')})`);
  ok(`bots' fights recorded: ${q.characterFights} character fights, ${Object.keys(q.casts).length} abilities, ${lv.length} level times`);
  const human = game.balance.query({ hours: 24, who: 'human' });
  assert.equal(human.characterFights, 0, 'bots are kept apart from real players');
  const all = game.balance.query({ hours: 24, who: 'all' });
  assert.equal(all.characterFights, q.characterFights);
  const zoneOnly = game.balance.query({ hours: 24, who: 'bot', activity: 'idle' });
  assert.ok(zoneOnly.characterFights > 0 && zoneOnly.characterFights <= q.characterFights);
  ok('filters: real players / bots / everyone, and by activity');
  // stored in hourly buckets that survive a restart
  const store2 = new Store(DATA, { log: () => {} });
  const game2 = new Game({ store: store2, assets: { get: () => ({}) }, log: () => {}, settings: new Settings(store2), admins: new AdminManager(store2), buildId: 'test' });
  assert.equal(game2.balance.query({ hours: 24, who: 'bot' }).characterFights, q.characterFights);
  ok('statistics are saved in the database (hourly buckets)');
} finally {
  fs.rmSync(DATA, { recursive: true, force: true });
}
console.log(`Balance statistics: all ${n} checks passed.`);
process.exit(0);
