// Daily & weekly quests: templates, reset times and reward formulas (shared by server and client).
import { ZONES } from './data/zones.js';
import { ENEMIES } from './data/enemies.js';
import { createRng } from './rng.js';

export const QUEST_CONFIG = {
  dailyCount: 3,
  weeklyCount: 2,
  resetHourUtc: 3,          // 03:00 UTC = 04:00 CET / 05:00 CEST
  freeRerollsPerDay: 1,
  rerollCost: 2,            // Ashen Crystals after the free reroll
  dailyCrystals: 2,         // per daily quest
  allDailiesCrystals: 5,    // bonus for finishing all dailies
  weeklyCrystals: 12,       // per weekly quest
};

export const TAG_NAMES = {
  beast: 'Beasts', humanoid: 'Humanoids', undead: 'Undead', demon: 'Demons', elemental: 'Elementals',
  giant: 'Giants', void: 'Void creatures', caster: 'Spellcasters', dragon: 'Dragons',
};

// target(level, ctx) → number; available(p, ctx) → bool. {n} in the title is replaced by the target.
export const QUEST_TYPES = {
  kill_tag:   { title: q => `Slay {n} ${TAG_NAMES[q.tag]}`, icon: '🗡', daily: true, weekly: true, target: () => 45, weeklyTarget: () => 400, weight: 4 },
  kill_any:   { title: () => 'Defeat {n} enemies', icon: '⚔', daily: true, weekly: true, target: () => 150, weeklyTarget: () => 1500, weight: 3 },
  win_fights: { title: () => 'Win {n} fights', icon: '🏆', daily: true, target: () => 50, weight: 2 },
  boss:       { title: () => 'Defeat {n} bosses', icon: '☠', daily: true, weekly: true, target: () => 2, weeklyTarget: () => 15, weight: 3, hint: 'Zone bosses, rift guardians and co-op bosses all count.' },
  gold:       { title: () => 'Earn {n} gold from battles', icon: '💰', daily: true, target: lvl => 120 + lvl * 45, weight: 2 },
  rift:       { title: () => 'Complete {n} rifts', icon: '🌀', daily: true, weekly: true, target: () => 2, weeklyTarget: () => 12, weight: 3, requires: 'rift' },
  rift_timed: { title: () => 'Complete {n} rifts in time', icon: '⏱', weekly: true, weeklyTarget: () => 8, weight: 2, requires: 'rift' },
  expedition: { title: () => 'Complete {n} expeditions', icon: '🧭', daily: true, weekly: true, target: () => 2, weeklyTarget: () => 10, weight: 2, requires: 'expedition' },
  salvage:    { title: () => 'Salvage {n} items', icon: '🔨', daily: true, target: () => 10, weight: 2, requires: 'town' },
  craft:      { title: () => 'Craft, reforge, enchant or brew {n} times', icon: '⚒', daily: true, weekly: true, target: () => 2, weeklyTarget: () => 12, weight: 2, requires: 'workers' },
  coop:       { title: () => 'Win {n} co-op encounters', icon: '⚑', weekly: true, weeklyTarget: () => 3, weight: 2, hint: 'You can also start a group on your own.' },
  auction:    { title: () => 'List {n} items or materials on the Auction House', icon: '⚖', daily: true, target: () => 1, weight: 1 },
};

// ---------------------------------------------------------------- reset periods
const DAY = 86400000;
export function dayKey(now = Date.now()) {
  const d = new Date(now - QUEST_CONFIG.resetHourUtc * 3600000);
  return d.toISOString().slice(0, 10);
}
export function nextDailyReset(now = Date.now()) {
  const shifted = now - QUEST_CONFIG.resetHourUtc * 3600000;
  return Math.floor(shifted / DAY) * DAY + DAY + QUEST_CONFIG.resetHourUtc * 3600000;
}
// weeks start Monday at the reset hour
export function weekKey(now = Date.now()) {
  const shifted = now - QUEST_CONFIG.resetHourUtc * 3600000;
  const dayNum = Math.floor(shifted / DAY);          // days since 1970-01-01 (a Thursday)
  const monday = dayNum - ((dayNum + 3) % 7);        // 0 = Monday
  return new Date(monday * DAY).toISOString().slice(0, 10);
}
export function nextWeeklyReset(now = Date.now()) {
  const monday = Date.parse(weekKey(now) + 'T00:00:00Z');
  return monday + 7 * DAY + QUEST_CONFIG.resetHourUtc * 3600000;
}

// ---------------------------------------------------------------- generation
// What the player can currently do (so we never hand out impossible quests)
export function questContext(p, heroLevel) {
  const tags = new Set();
  for (const z of p.unlockedZones || []) for (const e of ZONES[z]?.enemies || []) for (const t of ENEMIES[e].tags) if (TAG_NAMES[t]) tags.add(t);
  const b = p.town?.buildings || {};
  const hasWorkers = Object.values(b).some(x => x.worker);
  return {
    level: heroLevel, tags: [...tags],
    rift: heroLevel >= 8, expedition: (b.expedition_camp?.level || 0) >= 1, town: !!p.town, workers: hasWorkers,
  };
}

export function rollQuest(rng, kind, ctx, exclude = []) {
  const pool = Object.entries(QUEST_TYPES).filter(([id, t]) => t[kind] && (!t.requires || ctx[t.requires]) && !(id === 'kill_tag' && !ctx.tags.length));
  const usedTypes = new Set(exclude.map(q => q.type));
  let candidates = pool.filter(([id]) => !usedTypes.has(id));
  if (!candidates.length) candidates = pool;
  const total = candidates.reduce((s, [, t]) => s + t.weight, 0);
  let r = rng() * total, pick = candidates[0];
  for (const c of candidates) { r -= c[1].weight; if (r <= 0) { pick = c; break; } }
  const [type, t] = pick;
  const q = { type, progress: 0, claimed: false };
  if (type === 'kill_tag') {
    const usedTags = exclude.filter(x => x.type === 'kill_tag').map(x => x.tag);
    const tags = ctx.tags.filter(x => !usedTags.includes(x));
    q.tag = rng.pick(tags.length ? tags : ctx.tags);
  }
  q.target = Math.max(1, Math.round(kind === 'weekly' ? t.weeklyTarget(ctx.level) : t.target(ctx.level)));
  q.reward = questReward(kind, ctx.level, rng);
  return q;
}

export function questReward(kind, level, rng) {
  const mats = ['ore', 'herb', 'metal_scrap', 'leather_scrap', 'cloth_scrap', 'gem_fragment', 'arcane_dust'];
  if (kind === 'weekly') return { gold: 400 + level * 160, xpKills: 120, crystals: QUEST_CONFIG.weeklyCrystals, materials: { [rng.pick(mats)]: 20 + level, magic_essence: 3 + Math.floor(level / 10) }, item: 'epic' };
  return { gold: 80 + level * 30, xpKills: 25, crystals: QUEST_CONFIG.dailyCrystals, materials: { [rng.pick(mats)]: 5 + Math.floor(level / 3) } };
}

export function questTitle(q) { return QUEST_TYPES[q.type].title(q).replace('{n}', q.target.toLocaleString('en')); }

export function seededRng(playerId, key, salt = 0) {
  let h = 2166136261 ^ salt;
  for (const c of `${playerId}:${key}`) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return createRng(h >>> 0);
}
