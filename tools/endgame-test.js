// Quests, rifts & bestiary test: node tools/endgame-test.js
// Runs the real Game class against a temporary database with fake sockets.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/store.js';
import { Settings } from '../server/settings.js';
import { AdminManager } from '../server/admin.js';
import { Game } from '../server/game.js';
import * as L from '../server/playerLogic.js';
import * as Q from '../server/questLogic.js';
import { createCharacter } from '../shared/character.js';
import { generateItem } from '../shared/data/items.js';
import { createRng } from '../shared/rng.js';
import { createBattle, runToEnd } from '../shared/combat.js';
import { buildPartyUnits } from '../shared/party.js';
import { AFFIXES, riftHooks, riftWaves, riftScale, weeklyAffixes, affixesFor } from '../shared/rifts.js';
import { masteryMap, describeEnemyAbility, enemyTips, enemyLocations } from '../shared/bestiary.js';
import { ENEMIES } from '../shared/data/enemies.js';
import { ABILITIES } from '../shared/data/abilities.js';
import { dayKey, weekKey, nextDailyReset } from '../shared/quests.js';

let failures = 0;
const ok = (c, m) => { console.log(c ? '✔' : '✘', m); if (!c) failures++; };
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ashen-endgame-'));
const store = new Store(DATA, { log: () => {} });
const game = new Game({ store, assets: { get: () => ({}) }, log: () => {}, settings: new Settings(store), admins: new AdminManager(store), buildId: 'test' });
const msgs = [];
const ws = { readyState: 1, send: d => msgs.push(JSON.parse(d)) };
let n = 0;
const act = (type, payload = {}) => {
  const id = ++n;
  game.handleMessage(s, ws, JSON.stringify({ t: 'action', id, type, payload }));
  return msgs.find(m => m.t === 'result' && m.id === id);
};

try {
  const account = { id: 'p1', username: 'tester', tokens: [] };
  store.setAccount(account);
  var s = game.connect(ws, account);
  ok(act('create_hero', { name: 'Hero', classId: 'warrior' }).ok, 'hero created');
  const p = s.player;

  // ---------------------------------------------------------------- quests
  game.tick();
  ok(p.quests?.daily?.length === 3 && p.quests.weekly.length === 2, `quests generated: ${p.quests.daily.map(q => q.type + (q.tag ? ':' + q.tag : '')).join(', ')} | weekly ${p.quests.weekly.map(q => q.type).join(', ')}`);
  ok(p.quests.day === dayKey() && p.quests.week === weekKey() && nextDailyReset() > Date.now(), `reset keys ${p.quests.day} / week of ${p.quests.week}`);
  const killQ = p.quests.daily.find(q => q.type === 'kill_any' || q.type === 'kill_tag');
  const before = killQ ? killQ.progress : 0;
  Q.onBattle(p, { won: true, kills: [{ enemyId: 'wolf' }, { enemyId: 'goblin' }, { enemyId: 'goblin_chieftain', boss: true }], gold: 50 });
  ok(!killQ || killQ.progress > before, 'battle kills count toward kill quests');
  let r = act('quest_claim', { id: 'daily-0' });
  ok(!r.ok && /Not finished/.test(r.error), 'unfinished quest cannot be claimed');
  const q0 = p.quests.daily[0];
  q0.progress = q0.target;
  const goldBefore = p.gold, crystalsBefore = p.premium;
  r = act('quest_claim', { id: 'daily-0' });
  ok(r.ok && p.gold > goldBefore && p.premium === crystalsBefore + 2 && q0.claimed, `claimed daily: +${r.result.gold}g +${r.result.xp}xp +${r.result.crystals}💠`);
  r = act('quest_claim', { id: 'daily-0' });
  ok(!r.ok, 'cannot claim twice');
  const oldType = p.quests.daily[1].type + p.quests.daily[1].tag;
  r = act('quest_reroll', { id: 'daily-1' });
  ok(r.ok && r.result.cost === 0 && (p.quests.daily[1].type + p.quests.daily[1].tag) !== oldType, `free reroll: ${oldType} → ${p.quests.daily[1].type}`);
  p.premium = 0;
  r = act('quest_reroll', { id: 'daily-1', maxCost: 2 });
  ok(!r.ok && /Crystals/.test(r.error), 'second reroll costs crystals: ' + r.error);
  p.premium = 5;
  r = act('quest_reroll', { id: 'daily-1', maxCost: 2 });
  ok(r.ok && r.result.cost === 2 && p.premium === 3, 'paid reroll with crystals');
  r = act('quest_claim', { id: 'bonus' });
  ok(!r.ok, 'bonus needs all dailies');
  for (const q of p.quests.daily) q.progress = q.target;
  r = act('quest_claim', { id: 'all' });
  ok(r.ok && p.quests.bonusClaimed && p.quests.daily.every(q => q.claimed), `claim all incl. daily bonus: ${r.result.count} rewards, +${r.result.crystals}💠, items ${r.result.items.map(i => i.rarity).join(',')}`);
  // day rollover
  p.quests.day = '2000-01-01';
  game.lastTownCheck = 0; game.tick();
  ok(p.quests.day === dayKey() && p.quests.daily.every(q => !q.claimed) && !p.quests.bonusClaimed, 'new day → fresh dailies');

  // ---------------------------------------------------------------- rifts
  r = act('rift_start', { tier: 1 });
  ok(!r.ok && /level 8/.test(r.error), 'rifts locked below level 8');
  // level the party up and gear it
  const h = L.hero(p);
  const rng = createRng(3);
  const team = [h, ...['cleric', 'mage', 'rogue'].map((c, i) => { const ch = createCharacter({ id: 'r' + i, name: c, classId: c, level: 14 }); p.characters[ch.id] = ch; return ch; })];
  Object.assign(h, createCharacter({ id: h.id, name: h.name, classId: 'warrior', isMain: true, level: 14 }));
  for (const ch of team) for (const slot of Object.keys(ch.equipment)) for (let t = 0; t < 80; t++) { const it = generateItem(rng, 14, { minRarity: 'rare' }); if (it.slot === slot && (!it.classes || it.classes.includes(ch.classId))) { ch.equipment[slot] = it; break; } }
  p.parties[0].members = team.map(c => c.id);
  p.unlockedZones = ['whispering_woods', 'ashen_barrows'];
  r = act('rift_start', { tier: 2 });
  ok(!r.ok && /1–1/.test(r.error), 'only tier 1 available at first: ' + r.error);
  r = act('rift_start', { tier: 1, theme: 'ashen_barrows' });
  ok(r.ok && r.result.theme === 'ashen_barrows', 'rift tier 1 started');
  act('rift_settings', { auto: 'push' });
  let end = null;
  for (let i = 0; i < 6000 && !end; i++) { game.tick(); end = msgs.find(m => m.t === 'battle_end' && m.summary.kind === 'rift'); }
  const start = msgs.find(m => m.t === 'battle_start' && m.battle.meta.kind === 'rift');
  ok(start && start.battle.waves === 4 && start.battle.meta.timeLimit > 0, `rift battle: ${start?.battle.meta.title}, ${start?.battle.waves} waves, ${start?.battle.meta.timeLimit}s limit`);
  ok(end && end.summary.result === 'victory', `rift finished: ${end?.summary.result} in ${end?.summary.time}s (timed: ${end?.summary.timed})`);
  if (end?.summary.timed) {
    ok(p.rift.best === 1 && end.summary.crystals > 0 && end.summary.items.length >= 1, `tier 1 timed → best 1, +${end.summary.crystals}💠, chest ${end.summary.items.map(i => i.rarity).join(',')}`);
    ok(s.solo.next?.kind === 'rift' && s.solo.next.tier === 2, 'auto "push" queues tier 2');
  }
  ok(p.rift.history.length === 1 && p.rift.runs === 1, 'run recorded in history');
  ok(Object.values(p.bestiary).some(e => e.kills > 0) && p.bestiary.barrow_king, `bestiary filled: ${Object.keys(p.bestiary).length} entries`);
  r = act('rift_stop');
  ok(r.ok && !s.solo.next, 'rift stopped');
  const board = game.rankings.board({ category: 'rift' }, p.id);
  ok(board.mine && (p.rift.best ? /Tier 1/.test(board.mine.value) : true), `rift leaderboard: ${board.mine?.value}`);

  // ---------------------------------------------------------------- affixes don't break combat
  for (const id of Object.keys(AFFIXES)) {
    const b = createBattle({ seed: 5, allies: buildPartyUnits(team, { ownerId: 'p', ownerName: 'p' }), waves: riftWaves('ashen_barrows', 14, createRng(2), 4), scale: riftScale(3), hooks: riftHooks([id]) });
    runToEnd(b);
    ok(b.state !== 'running', `affix ${id}: ${b.state} in ${Math.round(b.time)}s`);
  }
  const wk = weeklyAffixes();
  ok(wk.length === 3 && new Set(wk).size === 3 && affixesFor(1).length === 0 && affixesFor(10).length === 3, `weekly affixes: ${wk.join(', ')}`);

  // ---------------------------------------------------------------- bestiary
  p.bestiary.wolf = { kills: 24, seen: 1 };
  const ups = L.recordBestiary(p, { kills: [{ enemyId: 'wolf' }] });
  ok(ups.length === 1 && masteryMap(p).wolf === 0.02, 'mastery ★ at 25 kills → +2% damage vs wolves');
  const b1 = createBattle({ seed: 1, allies: buildPartyUnits([h], { ownerId: 'p', ownerName: 'p', vsEnemy: masteryMap(p) }), waves: [[{ enemyId: 'wolf', level: 1 }]] });
  ok(b1.units[0].vsEnemy?.wolf === 0.02, 'mastery bonus reaches the battle');
  let missing = [];
  for (const [id, e] of Object.entries(ENEMIES)) {
    for (const a of e.abilities) if (!describeEnemyAbility(a)?.text) missing.push(a);
    if (!enemyTips(id).length || !enemyLocations(id).length) missing.push(id);
  }
  ok(!missing.length, `every enemy has descriptions, tips and locations${missing.length ? ': missing ' + missing.join(',') : ''}`);
  ok(Object.keys(ABILITIES).filter(a => a.startsWith('e_') || a.startsWith('b_')).every(a => describeEnemyAbility(a).text.length > 20), 'all enemy abilities describable');

  // public state carries the new data
  game.flushState(s);
  const st = msgs.filter(m => m.t === 'state').pop().player;
  ok(st.quests && st.rift && st.bestiary, 'client state includes quests, rift and bestiary');
} catch (e) {
  console.error(e); failures++;
} finally {
  store.close();
  fs.rmSync(DATA, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
