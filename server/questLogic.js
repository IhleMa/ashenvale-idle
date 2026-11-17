// Daily & weekly quests: generation, progress tracking, rewards.
import { QUEST_CONFIG, QUEST_TYPES, dayKey, weekKey, questContext, rollQuest, seededRng, questTitle } from '../shared/quests.js';
import { ENEMIES } from '../shared/data/enemies.js';
import { generateItem } from '../shared/data/items.js';
import { createRng } from '../shared/rng.js';
import { CONFIG } from '../shared/config.js';
import { GameError } from './playerLogic.js';
import * as L from './playerLogic.js';

const fail = m => { throw new GameError(m); };

// Makes sure the player has this day's / week's quests. Returns which sets are new.
export function ensureQuests(p, now = Date.now()) {
  const h = L.hero(p);
  if (!h) return { daily: false, weekly: false };
  const q = p.quests || (p.quests = {});
  const ctx = questContext(p, h.level);
  const day = dayKey(now), week = weekKey(now);
  const out = { daily: false, weekly: false };
  if (q.day !== day) {
    const rng = seededRng(p.id, day);
    q.day = day; q.daily = []; q.bonusClaimed = false; q.rerolls = 0;
    for (let i = 0; i < QUEST_CONFIG.dailyCount; i++) q.daily.push(rollQuest(rng, 'daily', ctx, q.daily));
    out.daily = true;
  }
  if (q.week !== week) {
    const rng = seededRng(p.id, week, 7);
    q.week = week; q.weekly = [];
    for (let i = 0; i < QUEST_CONFIG.weeklyCount; i++) q.weekly.push(rollQuest(rng, 'weekly', ctx, q.weekly));
    out.weekly = true;
  }
  return out;
}

function allQuests(p) { return [...(p.quests?.daily || []), ...(p.quests?.weekly || [])]; }

// Adds progress to every open quest of `type`. Returns titles of quests that just got completed.
export function track(p, type, amount = 1, filter = null) {
  if (!p.quests || !(amount > 0)) return [];
  const done = [];
  for (const q of allQuests(p)) {
    if (q.type !== type || q.claimed || q.progress >= q.target) continue;
    if (filter && !filter(q)) continue;
    q.progress = Math.min(q.target, q.progress + amount);
    if (q.progress >= q.target) done.push(questTitle(q));
  }
  return done;
}

// All quest progress from one finished battle
export function onBattle(p, { won, kills = [], gold = 0 }) {
  if (!p.quests) return [];
  const done = [];
  if (won) done.push(...track(p, 'win_fights', 1), ...track(p, 'gold', gold));
  done.push(...track(p, 'kill_any', kills.length));
  done.push(...track(p, 'boss', kills.filter(k => k.boss && !k.summoned).length));
  const byTag = {};
  for (const k of kills) for (const t of ENEMIES[k.enemyId]?.tags || []) byTag[t] = (byTag[t] || 0) + 1;
  for (const [tag, n] of Object.entries(byTag)) done.push(...track(p, 'kill_tag', n, q => q.tag === tag));
  return done;
}

function findQuest(p, id) {
  const [kind, idx] = String(id).split('-');
  const list = kind === 'daily' ? p.quests?.daily : kind === 'weekly' ? p.quests?.weekly : null;
  const q = list?.[Number(idx)];
  return q ? { q, kind } : null;
}

function giveReward(p, reward, kind) {
  const h = L.hero(p);
  const level = h.level;
  const xp = Math.round((reward.xpKills || 0) * 15 * (1 + 0.22 * (level - 1)));
  const items = [];
  if (reward.item) items.push(generateItem(createRng(Date.now() ^ (Math.random() * 1e9)), Math.min(CONFIG.levelCap, level), { minRarity: reward.item, boost: 1 }));
  const chars = L.activePartyChars(p);
  const res = L.applyRewards(p, chars.length ? chars : [h], { xp, gold: reward.gold || 0, items, kills: 0 });
  p.premium = (p.premium || 0) + (reward.crystals || 0);
  if (reward.materials && p.town) for (const [m, n] of Object.entries(reward.materials)) p.town.materials[m] = (p.town.materials[m] || 0) + n;
  p.stats.questsDone = (p.stats.questsDone || 0) + (kind === 'bonus' ? 0 : 1);
  return { xp, gold: reward.gold || 0, crystals: reward.crystals || 0, materials: reward.materials || {}, items: items.map(i => ({ name: i.name, rarity: i.rarity })), levelUps: res.levelUps };
}

export function claim(p, { id }) {
  ensureQuests(p);
  if (id === 'bonus') {
    if (p.quests.bonusClaimed) fail('Already claimed today');
    if (!p.quests.daily.every(q => q.claimed)) fail('Finish and claim all daily quests first');
    p.quests.bonusClaimed = true;
    return giveReward(p, { crystals: QUEST_CONFIG.allDailiesCrystals, item: 'rare', gold: 0 }, 'bonus');
  }
  const f = findQuest(p, id) || fail('Quest not found');
  if (f.q.claimed) fail('Already claimed');
  if (f.q.progress < f.q.target) fail('Not finished yet');
  f.q.claimed = true;
  return giveReward(p, f.q.reward, f.kind);
}

export function claimAll(p) {
  ensureQuests(p);
  const out = [];
  for (const kind of ['daily', 'weekly']) p.quests[kind].forEach((q, i) => { if (!q.claimed && q.progress >= q.target) out.push(claim(p, { id: `${kind}-${i}` })); });
  if (!p.quests.bonusClaimed && p.quests.daily.every(q => q.claimed)) out.push(claim(p, { id: 'bonus' }));
  if (!out.length) fail('Nothing to claim');
  return {
    count: out.length,
    gold: out.reduce((s, r) => s + r.gold, 0), xp: out.reduce((s, r) => s + r.xp, 0), crystals: out.reduce((s, r) => s + r.crystals, 0),
    items: out.flatMap(r => r.items), levelUps: out.flatMap(r => r.levelUps),
  };
}

// Swap a daily quest for a different one: once a day for free, then for crystals
export function reroll(p, { id, maxCost }) {
  ensureQuests(p);
  const f = findQuest(p, id) || fail('Quest not found');
  if (f.kind !== 'daily') fail('Only daily quests can be swapped');
  if (f.q.claimed || f.q.progress >= f.q.target) fail('This quest is already done');
  const cost = (p.quests.rerolls || 0) < QUEST_CONFIG.freeRerollsPerDay ? 0 : QUEST_CONFIG.rerollCost;
  if (cost) L.spendPremium(p, cost, maxCost);
  const idx = Number(String(id).split('-')[1]);
  const others = p.quests.daily.filter((_, i) => i !== idx);
  const rng = seededRng(p.id, `${p.quests.day}:reroll:${p.quests.rerolls || 0}`, 3);
  const h = L.hero(p);
  let q;
  for (let t = 0; t < 10; t++) { q = rollQuest(rng, 'daily', questContext(p, h.level), [...others, f.q]); if (q.type !== f.q.type || q.tag !== f.q.tag) break; }
  p.quests.daily[idx] = q;
  p.quests.rerolls = (p.quests.rerolls || 0) + 1;
  return { cost, quest: q };
}

export function readyCount(p) {
  const q = p.quests;
  if (!q) return 0;
  const n = allQuests(p).filter(x => !x.claimed && x.progress >= x.target).length;
  return n + (!q.bonusClaimed && q.daily?.length && q.daily.every(x => x.claimed) ? 1 : 0);
}

export { QUEST_TYPES };
