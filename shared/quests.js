// Daily & weekly quests: templates, reset times and reward formulas (shared by server and client).
import { ZONES } from './data/zones.js';
import { ENEMIES } from './data/enemies.js';
import { createRng } from './rng.js';

import { CONTENT } from './content.js';

const Q = CONTENT.quests;
export const QUEST_CONFIG = Q.config;
export const TAG_NAMES = Q.tagNames;
// Quest types (content/quests.json): title template, icon, daily/weekly target, weight, requires, hint
export const QUEST_TYPES = Q.types;

// number or { base, perLevel, perLevels } (perLevels: +1 every N levels)
export function scaled(v, level) {
  if (typeof v === 'number') return v;
  if (!v) return 0;
  return (v.base || 0) + (v.perLevel || 0) * level + (v.perLevels ? Math.floor(level / v.perLevels) : 0);
}

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
  q.target = Math.max(1, Math.round(scaled(kind === 'weekly' ? t.weeklyTarget : t.target, ctx.level)));
  q.reward = questReward(kind, ctx.level, rng);
  return q;
}

export function questReward(kind, level, rng) {
  const R = Q.rewards[kind];
  const out = { gold: scaled(R.gold, level), xpKills: R.xpKills, crystals: typeof R.crystals === 'string' ? QUEST_CONFIG[R.crystals] : R.crystals || 0, materials: {} };
  for (const m of R.materials || []) {
    const id = m.pool ? rng.pick(m.pool) : m.id;
    out.materials[id] = (out.materials[id] || 0) + scaled(m.amount, level);
  }
  if (R.item) out.item = R.item;
  return out;
}

// reward for finishing all daily quests
export function dailyChestReward() {
  const C = Q.rewards.dailyChest;
  return { crystals: typeof C.crystals === 'string' ? QUEST_CONFIG[C.crystals] : C.crystals || 0, item: C.item, gold: C.gold || 0 };
}

export function questTitle(q) { return QUEST_TYPES[q.type].title.replace('{tag}', TAG_NAMES[q.tag] || q.tag || '').replace('{n}', q.target.toLocaleString('en')); }

export function seededRng(playerId, key, salt = 0) {
  let h = 2166136261 ^ salt;
  for (const c of `${playerId}:${key}`) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return createRng(h >>> 0);
}
