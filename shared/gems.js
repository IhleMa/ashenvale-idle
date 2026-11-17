// Stat shards, gems and sockets.
//
// Salvaging an item breaks every stat on it into "stat shards" (stored as materials, e.g. shard_str).
// A Jeweler cuts shards into gems; three gems of one tier fuse into one of the next tier.
// Gems go into sockets on gear and add their stat. Sockets drop on items or are drilled at the Jeweler.
import { AFFIXES, PCT_STATS, SLOTS, maxSockets, rollSockets } from './data/items.js';
import { rarityIndex } from './config.js';

export const GEM_STATS = Object.keys(AFFIXES);

export const GEM_KINDS = {
  str:         { name: 'Ruby',        color: '#e0464e' },
  int:         { name: 'Sapphire',    color: '#4f7cff' },
  dex:         { name: 'Emerald',     color: '#3fbf6a' },
  vit:         { name: 'Amber',       color: '#e8a33a' },
  hp:          { name: 'Bloodstone',  color: '#b0303a' },
  defense:     { name: 'Onyx',        color: '#8e8e9a' },
  physPower:   { name: 'Garnet',      color: '#c2413c' },
  magPower:    { name: 'Amethyst',    color: '#a160e8' },
  healPower:   { name: 'Pearl',       color: '#f0ecdc' },
  critChance:  { name: 'Topaz',       color: '#f2c14e' },
  critDamage:  { name: 'Diamond',     color: '#c8f2ff' },
  attackSpeed: { name: 'Citrine',     color: '#ffd84a' },
};

// tier → name, value (fraction of an affix at refLevel), jeweler level needed
export const GEM_TIERS = [
  null,
  { name: 'Chipped',  refLevel: 8,  jeweler: 1, boost: 1 },
  { name: 'Flawed',   refLevel: 18, jeweler: 2, boost: 1.1 },
  { name: 'Polished', refLevel: 30, jeweler: 3, boost: 1.2 },
  { name: 'Flawless', refLevel: 44, jeweler: 4, boost: 1.35 },
  { name: 'Perfect',  refLevel: 60, jeweler: 5, boost: 1.5 },
];
export const MAX_GEM_TIER = GEM_TIERS.length - 1;
export const GEM_VALUE_FACTOR = 0.6;

export const GEM_CONFIG = {
  shardsPerGem: 50,     // shards of one stat for a Chipped gem — high on purpose, gear drops a lot
  fuseCount: 3,         // gems of tier T → 1 gem of tier T+1
};

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
  const r = rarityIndex(item.rarity);
  const per = (1 + r * 0.6) * (0.6 + item.level / 25) * (1 + bonusPct);
  const out = {};
  for (const stat of Object.keys(item.stats || {})) {
    if (!GEM_STATS.includes(stat)) continue;
    const n = Math.max(1, Math.floor(per * (1 + (salvageLevel - 1) * 0.05)));
    out[shardId(stat)] = (out[shardId(stat)] || 0) + n;
  }
  if (item.enchant && GEM_STATS.includes(item.enchant.stat)) out[shardId(item.enchant.stat)] = (out[shardId(item.enchant.stat)] || 0) + Math.max(1, Math.floor(per));
  return out;
}

// ---------------------------------------------------------------- crafting costs
// costs use the town format { gold, mats }
export function cutCost(stat, count = 1) {
  return { gold: 150 * count, mats: { [shardId(stat)]: GEM_CONFIG.shardsPerGem * count, gem_fragment: 4 * count } };
}
// fusing 3× tier T into T+1
export function fuseCost(tier, count = 1) {
  const next = tier + 1;
  const extra = next >= 5 ? { void_crystal: 1, prismatic_shard: 3 } : next >= 4 ? { prismatic_shard: 2 } : next >= 3 ? { magic_essence: 4 } : { arcane_dust: 6 };
  const mats = { gem_fragment: 4 * next, ...extra };
  for (const k of Object.keys(mats)) mats[k] *= count;
  return { gold: [0, 0, 600, 2000, 6000, 15000][next] * count, mats };
}
// chance that a cut/fuse yields one extra gem, from the jeweler's skill
export function doubleChance(professionLevel = 1) { return Math.min(0.2, professionLevel / 250); }

// ---------------------------------------------------------------- sockets
export { maxSockets, rollSockets }; // defined in data/items.js (used when items drop)
export function drillCost(item) {
  const n = (item.sockets || []).length; // the socket being added is #n+1
  const lvl = item.level;
  const mats = { gem_fragment: 6 + n * 6, arcane_dust: 4 + Math.floor(lvl / 5) };
  if (n >= 1) mats.prismatic_shard = n * 2;
  if (n >= 2) mats.void_crystal = 1;
  return { gold: Math.round((200 + lvl * 25) * (1 + n * 1.5)), mats };
}
export function drillJewelerLevel(item) { return [2, 3, 5][(item.sockets || []).length] ?? 99; }
// gold to pull a gem back out intact
export function unsocketCost(tier, itemLevel) { return 30 * tier * tier + itemLevel * 4; }

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
