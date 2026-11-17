// Stat shards, gems and sockets.
//
// Salvaging an item breaks every stat on it into "stat shards" (stored as materials, e.g. shard_str).
// A Jeweler cuts shards into gems; three gems of one tier fuse into one of the next tier.
// Gems go into sockets on gear and add their stat. Sockets drop on items or are drilled at the Jeweler.
import { AFFIXES, PCT_STATS, SLOTS, maxSockets, rollSockets } from './data/items.js';
import { rarityIndex } from './config.js';

import { CONTENT } from './content.js';

const G = CONTENT.gems;
export const GEM_STATS = Object.keys(AFFIXES);
export const GEM_KINDS = G.kinds;                 // one gem per stat
export const GEM_TIERS = [null, ...G.tiers];      // index = tier (1-based)
export const MAX_GEM_TIER = GEM_TIERS.length - 1;
export const GEM_VALUE_FACTOR = G.valueFactor;
export const GEM_CONFIG = G.config;

// { base, perLevel, perLevels, perItemLevel, perItemLevels } → number
const scaled = (v, level = 0) => (typeof v === 'number' ? v : (v.base || 0) + (v.perItemLevel || 0) * level + (v.perItemLevels ? Math.floor(level / v.perItemLevels) : 0));
const scaleMats = (mats, mult = 1, level = 0) => Object.fromEntries(Object.entries(mats || {}).map(([k, v]) => [k, scaled(v, level) * mult]));

export const shardId = stat => `shard_${stat}`;
export const isShard = id => typeof id === 'string' && id.startsWith('shard_') && GEM_STATS.includes(id.slice(6));
export const gemKey = (stat, tier) => `${stat}:${tier}`;
export function parseGemKey(key) {
  const [stat, t] = String(key).split(':');
  const tier = Number(t);
  return GEM_STATS.includes(stat) && tier >= 1 && tier <= MAX_GEM_TIER ? { stat, tier } : null;
}

export function gemName(stat, tier) { return `${GEM_TIERS[tier].name} ${GEM_KINDS[stat].name}`; }
export function gemValue(stat, tier) {
  const a = AFFIXES[stat];
  const v = (a.base + a.perLevel * GEM_TIERS[tier].refLevel) * GEM_VALUE_FACTOR * GEM_TIERS[tier].boost;
  return PCT_STATS.has(stat) ? Math.round(v * 1000) / 1000 : Math.max(1, Math.round(v));
}

// ---------------------------------------------------------------- shards from salvage
// Every stat on the item yields shards of that stat; more for higher level and rarity.
export function shardYield(item, salvageLevel = 1, bonusPct = 0) {
  const Y = G.shardYield;
  const r = rarityIndex(item.rarity);
  const per = (1 + r * Y.perRarity) * (Y.base + item.level / Y.levelDivisor) * (1 + bonusPct);
  const out = {};
  for (const stat of Object.keys(item.stats || {})) {
    if (!GEM_STATS.includes(stat)) continue;
    const n = Math.max(1, Math.floor(per * (1 + (salvageLevel - 1) * Y.perSalvageLevel)));
    out[shardId(stat)] = (out[shardId(stat)] || 0) + n;
  }
  if (item.enchant && GEM_STATS.includes(item.enchant.stat)) out[shardId(item.enchant.stat)] = (out[shardId(item.enchant.stat)] || 0) + Math.max(1, Math.floor(per));
  return out;
}

// ---------------------------------------------------------------- crafting costs
// costs use the town format { gold, mats }
export function cutCost(stat, count = 1) {
  const c = GEM_TIERS[1].cutCost;
  return { gold: c.gold * count, mats: { [shardId(stat)]: GEM_CONFIG.shardsPerGem * count, ...scaleMats(c.mats, count) } };
}
// fusing 3× tier T into T+1
export function fuseCost(tier, count = 1) {
  const c = GEM_TIERS[tier + 1].fuseCost;
  return { gold: c.gold * count, mats: scaleMats(c.mats, count) };
}
// chance that a cut/fuse yields one extra gem, from the jeweler's skill
export function doubleChance(professionLevel = 1) { return Math.min(G.bonusGemChance.max, professionLevel / G.bonusGemChance.levelDivisor); }

// ---------------------------------------------------------------- sockets
export { maxSockets, rollSockets }; // defined in data/items.js (used when items drop)
export function drillCost(item) {
  const n = (item.sockets || []).length; // the socket being added is #n+1
  const d = G.drill.sockets[n] || G.drill.sockets[G.drill.sockets.length - 1];
  return { gold: Math.round((G.drill.gold.base + item.level * G.drill.gold.perItemLevel) * d.goldMult), mats: scaleMats(d.mats, 1, item.level) };
}
export function drillJewelerLevel(item) { return G.drill.sockets[(item.sockets || []).length]?.jeweler ?? 99; }
// gold to pull a gem back out intact
export function unsocketCost(tier, itemLevel) { return G.unsocketCost.perTierSquared * tier * tier + itemLevel * G.unsocketCost.perItemLevel; }

// stats added by an item's gems
export function socketStats(item) {
  const out = {};
  for (const g of item.sockets || []) {
    const gem = g && parseGemKey(g);
    if (gem) out[gem.stat] = (out[gem.stat] || 0) + gemValue(gem.stat, gem.tier);
  }
  return out;
}

export function slotLabel(slot) { return SLOTS[slot]?.label || slot; }
