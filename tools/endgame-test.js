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
import { ZONES } from '../shared/data/zones.js';
import { generateItem } from '../shared/data/items.js';
import { createRng } from '../shared/rng.js';
import { createBattle, runToEnd } from '../shared/combat.js';
import { buildPartyUnits } from '../shared/party.js';
import { AFFIXES, riftHooks, riftWaves, riftScale, weeklyAffixes, affixesFor } from '../shared/rifts.js';
import { masteryMap, describeEnemyAbility, enemyTips, enemyLocations } from '../shared/bestiary.js';
import { ENEMIES } from '../shared/data/enemies.js';
import { ABILITIES } from '../shared/data/abilities.js';
import { dayKey, weekKey, nextDailyReset } from '../shared/quests.js';
import { filterFromLegacy } from '../shared/lootfilter.js';

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
  L.hero(p).level = 30; // quests, rifts and gems unlock by hero level

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
  L.hero(p).level = 10;
  r = act('rift_start', { tier: 1 });
  ok(!r.ok && /level 15/.test(r.error), 'rifts locked below level 15');
  // level the party up and gear it
  const h = L.hero(p);
  const rng = createRng(3);
  const team = [h, ...['cleric', 'mage', 'rogue'].map((c, i) => { const ch = createCharacter({ id: 'r' + i, name: c, classId: c, level: 16 }); p.characters[ch.id] = ch; return ch; })];
  Object.assign(h, createCharacter({ id: h.id, name: h.name, classId: 'warrior', isMain: true, level: 16 }));
  for (const ch of team) for (const slot of Object.keys(ch.equipment)) for (let t = 0; t < 80; t++) { const it = generateItem(rng, 14, { minRarity: 'rare' }); if (it.slot === slot && (!it.classes || it.classes.includes(ch.classId))) { ch.equipment[slot] = it; break; } }
  p.parties[0].members = team.map(c => c.id);
  p.unlockedZones = ['whispering_woods', 'ashen_barrows'];
  r = act('rift_start', { tier: 2 });
  ok(!r.ok && /1–1/.test(r.error), 'only tier 1 available at first: ' + r.error);
  r = act('rift_start', { tier: 1, theme: 'ashen_barrows' });
  ok(r.ok && r.result.theme === 'whispering_woods', 'rift tier 1 started, always themed after the first zone');
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
  ok(Object.values(p.bestiary).some(e => e.kills > 0) && p.bestiary[ZONES.whispering_woods.boss], `bestiary filled: ${Object.keys(p.bestiary).length} entries`);
  r = act('rift_stop');
  ok(r.ok && !s.solo.next, 'rift stopped');
  const board = game.rankings.board({ category: 'rift' }, p.id);
  ok(board.mine && (p.rift.best ? /Tier 1/.test(board.mine.value) : true), `rift leaderboard: ${board.mine?.value}`);

  // ---------------------------------------------------------------- affixes don't break combat
  for (const id of Object.keys(AFFIXES)) {
    const b = createBattle({ seed: 5, allies: buildPartyUnits(team, { ownerId: 'p', ownerName: 'p' }), waves: riftWaves('ashen_barrows', 3, createRng(2), 4), scale: riftScale(3), hooks: riftHooks([id]) });
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

  // ---------------------------------------------------------------- loot filter
  const mk = (over) => ({ ...generateItem(createRng(Math.random() * 1e9 | 0), 3, { rarity: 'common', baseId: 'ring' }), affixes: undefined, ...over }); // hand-set stats
  r = act('loot_filter_save', { filter: { enabled: true, protectUpgrades: true, rules: [
    { name: 'Keep crit uncommons', action: 'keep', rarities: ['uncommon'], anyStats: ['critDamage'] },
    { name: 'Junk', action: 'salvage', rarities: ['common', 'uncommon'] },
    { name: 'Old rares', action: 'sell', rarities: ['rare'], levelsBelowHero: 5 },
    { name: 'bogus', action: 'explode', rarities: ['nope'], slots: ['tail'] },
  ] } });
  ok(r.ok && p.lootFilter.rules.length === 4 && p.lootFilter.rules[3].action === 'keep' && !p.lootFilter.rules[3].rarities.length, 'filter saved and sanitized');
  const inv0 = p.inventory.length, mats0 = JSON.stringify(p.town.materials), gold0 = p.gold;
  ok(L.receiveItem(p, mk({ name: 'Junk Ring', stats: { critChance: 0.001 } })) === 'salvaged' && p.inventory.length === inv0 && JSON.stringify(p.town.materials) !== mats0, 'common junk is salvaged into materials');
  ok(p.lootLog[0]?.name === 'Junk Ring' && p.lootLog[0].action === 'salvaged' && /Junk/.test(p.lootLog[0].reason), 'filtered drop is logged with its rule');
  ok(L.receiveItem(p, mk({ rarity: 'uncommon', stats: { critDamage: 0.01 } })) === 'kept', 'keep rule above wins (uncommon with crit damage kept)');
  ok(L.receiveItem(p, mk({ rarity: 'rare', level: 3, stats: {} })) === 'sold' && p.gold > gold0, 'old rare sold');
  ok(L.receiveItem(p, mk({ rarity: 'rare', level: 14, stats: { str: 1 } })) === 'kept', 'current-level rare kept (no rule matches)');
  ok(L.receiveItem(p, mk({ level: 14, requiredLevel: 1, stats: { critChance: 0.9 } })) === 'kept', 'upgrade protected even though "Junk" matches');
  ok(L.receiveItem(p, mk({ unique: 'test', stats: {} })) === 'kept', 'uniques never filtered');
  const locked = mk({ locked: true }); p.inventory.push(locked);
  const junk = mk({ name: 'Old junk' }); p.inventory.push(junk);
  r = act('loot_filter_apply', { dryRun: true });
  ok(r.ok && r.result.items.some(x => x.uid === junk.uid) && !r.result.items.some(x => x.uid === locked.uid) && p.inventory.includes(junk), `dry run lists ${r.result.salvage} to salvage, ${r.result.sell} to sell, changes nothing`);
  r = act('loot_filter_apply', {});
  ok(r.ok && !p.inventory.includes(junk) && p.inventory.includes(locked), 'apply removes matches, keeps locked items');
  act('loot_filter_save', { filter: { ...p.lootFilter, enabled: false } });
  ok(L.receiveItem(p, mk({})) === 'kept', 'disabled filter keeps everything');
  const legacy = filterFromLegacy({ autoSellBelow: 'uncommon', autoLootAction: 'salvage' });
  ok(legacy.enabled && legacy.rules[0].action === 'salvage' && legacy.rules[0].rarities.join() === 'common,uncommon', 'old auto-sell setting becomes a filter rule');

  // ---------------------------------------------------------------- gems & sockets
  {
    const TL = await import('../server/townLogic.js');
    const G = await import('../shared/gems.js');
    const { equipmentStats } = await import('../shared/stats.js');
    const { maxSockets } = await import('../shared/data/items.js');
    let socketed = 0, total = 0;
    const grng = createRng(77);
    for (let i = 0; i < 3000; i++) { const it = generateItem(grng, 30); total++; if (it.sockets) { socketed++; if (it.sockets.length > maxSockets(it)) failures++; } }
    ok(socketed > 0 && socketed < total * 0.4, `drops with sockets: ${(socketed / total * 100).toFixed(1)}%`);
    const sal = generateItem(createRng(9), 30, { rarity: 'rare' });
    p.inventory.push(sal);
    r = act('salvage_items', { itemUids: [sal.uid] });
    ok(r.ok && !Object.keys(r.result.materials).some(k => k.startsWith('shard_')), 'salvage gives no stat shards anymore');
    L.hero(p).level = Math.max(L.hero(p).level, 25); // gems unlock at hero level 20
    r = act('gem_cut', { kind: 'ladder' });
    ok(!r.ok && /Jeweler/.test(r.error), 'cutting needs a Jeweler: ' + r.error);
    const jw = createCharacter({ id: 'jw', name: 'Gemma', classId: 'rogue', level: 5 });
    jw.profession = { id: 'jewelcrafting', level: 10, xp: 0 };
    p.characters.jw = jw;
    p.town.buildings.jeweler = { level: 2, upgrade: null, worker: 'jw' };
    p.town.materials.gem_fragment = 0; p.town.materials.arcane_dust = 500; p.town.materials.magic_essence = 50; p.town.materials.prismatic_shard = 50; p.town.materials.void_crystal = 10;
    p.gold = 1e6;
    r = act('gem_cut', { kind: 'ladder' });
    ok(!r.ok && /Gem Fragment/.test(r.error), 'cutting needs Gem Fragments: ' + r.error);
    p.town.materials.gem_fragment = 5000;
    for (let i = 0; i < 7; i++) act('gem_cut', { kind: 'ladder' });
    ok(p.town.gems['ladder:1'] >= 7, `cut 7 Chipped Ladder Gems (have ${p.town.gems['ladder:1']})`);
    r = act('gem_fuse', { kind: 'ladder', tier: 1, count: 2 });
    ok(r.ok && p.town.gems['ladder:2'] >= 2, `fused 6 Chipped → ${r.result?.count} Flawed`);
    r = act('gem_fuse', { kind: 'ladder', tier: 2 });
    ok(!r.ok, 'Polished needs Jeweler 3 / enough gems: ' + r.error);
    // socket into the hero's weapon
    const w = h.equipment.weapon;
    w.sockets = [null];
    w.affixes = [{ stat: 'str', tier: 3, roll: 0.5 }];
    const strBefore = equipmentStats(h).str || 0;
    r = act('gem_socket', { itemUid: w.uid, charId: h.id, index: 0, gem: 'ladder:2' });
    const gained = (equipmentStats(h).str || 0) - strBefore;
    ok(r.ok && w.sockets[0] === 'ladder:2' && gained > 0, `Flawed Ladder Gem socketed into ${w.name}: its T3 Strength gains +${gained}`);
    const flawed = p.town.gems['ladder:2'] || 0, g0 = p.gold;
    r = act('gem_unsocket', { itemUid: w.uid, charId: h.id, index: 0 });
    ok(r.ok && !w.sockets[0] && p.town.gems['ladder:2'] === flawed + 1 && p.gold === g0 - G.unsocketCost(2, w.level), `unsocket returns the gem for ${G.unsocketCost(2, w.level)}g`);
    const maxW = maxSockets(w);
    r = act('gem_drill', { itemUid: w.uid, charId: h.id });
    ok(maxW < 2 || (!r.ok && /level 3/.test(r.error)), 'socket #2 needs Jeweler level 3');
    p.town.buildings.jeweler.level = 3;
    r = act('gem_drill', { itemUid: w.uid, charId: h.id });
    ok(maxW > 1 ? (r.ok && w.sockets.length === 2) : !r.ok, `drill 2nd socket (max ${maxW}): ${r.ok ? 'ok' : r.error}`);
    r = act('gem_drill', { itemUid: w.uid, charId: h.id });
    ok(!r.ok, 'third socket blocked: ' + r.error);
    // selling a socketed item returns its gem
    const sell = generateItem(createRng(3), 10, { rarity: 'rare' });
    sell.sockets = ['ladder:1'];
    p.inventory.push(sell);
    const chipped = p.town.gems['ladder:1'] || 0;
    r = act('sell_item', { itemUid: sell.uid });
    ok(r.ok && p.town.gems['ladder:1'] === chipped + 1, 'selling returns socketed gems');
  }

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
