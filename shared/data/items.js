// Item slots, bases, affixes and loot generation. The data lives in content/items.json.
// Item images are looked up by base id (assets/items/<baseId>.png) and optionally by rarity
// (assets/items/<baseId>_<rarity>.png) — see public/assets/README.md.
import { CONFIG, rarityIndex, rarityById } from '../config.js';
import { CONTENT, withIds, onContentReload, refillArray, refillObject } from '../content.js';

const I = CONTENT.items;
export const SLOTS = I.slots;
export const SLOT_IDS = Object.keys(SLOTS);

// stats: { stat: [base, perLevel] }  — final = (base + perLevel * itemLevel) * rarity multiplier
export const ITEM_BASES = withIds(I.bases);

// Item stats ("affixes"). Every stat that can roll on an item is a prefix or a suffix with a weight (how common it
// is), optional slots and a value per item level. Each rolled affix has a tier: better tiers need a higher item
// level, are rarer (tier weight) and multiply the value more. An item stores its affixes as { stat, tier, roll }
// (roll 0–1 inside the tier's range), so its stats can be recomputed exactly at any item level (reforging).
export const AFFIXES = I.affixes;
export const AFFIX_TIERS = I.affixTiers;
export const AFFIX_LIMITS = I.affixLimits || { prefix: 3, suffix: 3 };

export const STAT_LABELS = {
  ...Object.fromEntries(Object.entries(AFFIXES).map(([k, v]) => [k, v.label])),
  ...I.extraStatLabels,
};
export const PCT_STATS = new Set(I.pctStats);
onContentReload(() => {
  withIds(ITEM_BASES);
  refillArray(SLOT_IDS, Object.keys(SLOTS));
  refillObject(STAT_LABELS, { ...Object.fromEntries(Object.entries(AFFIXES).map(([k, v]) => [k, v.label])), ...I.extraStatLabels });
  PCT_STATS.clear(); for (const s of I.pctStats) PCT_STATS.add(s);
});

export function itemSellValue(item) {
  const v = I.sellValue;
  return Math.floor((v.base + item.level * v.perLevel) * Math.pow(v.rarityFactor, rarityIndex(item.rarity)));
}

export function rollRarity(rng, boost = 0, minRarity = 'common') {
  const minIdx = rarityIndex(minRarity);
  const list = CONFIG.rarities.map((r, i) => ({ r, w: i < minIdx ? 0 : r.weight * Math.pow(1 + boost, i) }));
  const total = list.reduce((s, x) => s + x.w, 0);
  let roll = rng() * total;
  for (const x of list) { if ((roll -= x.w) <= 0) return x.r; }
  return list[list.length - 1].r;
}

// ---------------------------------------------------------------- sockets (gems: see shared/gems.js)
// most sockets an item can ever have (by slot and rarity)
export function maxSockets(item) {
  const S = I.sockets;
  const r = rarityIndex(item.rarity);
  const bySlot = S.maxBySlot[item.slot] ?? S.maxDefault;
  const byRarity = S.maxByRarity[r] ?? S.maxDefault;
  return Math.min(bySlot, byRarity);
}
// sockets on a fresh drop: rare-ish; legendary and better always have one
export function rollSockets(rng, item) {
  const S = I.sockets;
  const max = maxSockets(item);
  const r = rarityIndex(item.rarity);
  const chance = S.chanceByRarity[r] ?? 0.1;
  let n = 0;
  for (let i = 0; i < max; i++) if (rng() < chance * (i === 0 ? 1 : S.extraSocketChanceMult)) n++;
  if (r >= rarityIndex(S.guaranteedFromRarity) && n === 0) n = 1;
  return n;
}

// ---------------------------------------------------------------- affixes
const pick = (rng, list, weight) => {
  const total = list.reduce((s, x) => s + weight(x), 0);
  let r = rng() * total;
  for (const x of list) if ((r -= weight(x)) <= 0) return x;
  return list[list.length - 1];
};
export const tierDef = t => AFFIX_TIERS.find(x => x.tier === t) || AFFIX_TIERS[AFFIX_TIERS.length - 1];
export const tiersAt = level => AFFIX_TIERS.filter(t => t.minLevel <= level);
export const affixAllowed = (stat, slot) => !AFFIXES[stat].slots || AFFIXES[stat].slots.includes(slot);
const round = (stat, v) => (PCT_STATS.has(stat) ? Math.round(v * 1000) / 1000 : Math.max(1, Math.round(v)));
// the value of a rolled affix at an item level
export function affixValue(a, level) {
  const def = AFFIXES[a.stat], t = tierDef(a.tier);
  if (!def) return 0;
  return round(a.stat, (def.base + def.perLevel * level) * (t.min + (t.max - t.min) * a.roll));
}
// the value range of a tier at an item level → [min, max]
export function tierRange(stat, tier, level) {
  const def = AFFIXES[stat], t = tierDef(tier), v = def.base + def.perLevel * level;
  return [round(stat, v * t.min), round(stat, v * t.max)];
}
// one new affix for an item (respecting prefix/suffix limits, slots and stats already on it); null if none fits
export function rollAffix(rng, item, { type = null } = {}) {
  const have = item.affixes || [];
  const count = k => have.filter(a => AFFIXES[a.stat]?.type === k).length;
  const tiers = tiersAt(item.level);
  const pool = Object.keys(AFFIXES).filter(k => affixAllowed(k, item.slot) && !have.some(a => a.stat === k)
    && (!type || AFFIXES[k].type === type) && count(AFFIXES[k].type) < (I.affixLimits?.[AFFIXES[k].type] ?? 3));
  if (!pool.length || !tiers.length) return null;
  const stat = pick(rng, pool, k => AFFIXES[k].weight || 1);
  return { stat, tier: pick(rng, tiers, t => t.weight).tier, roll: Math.round(rng() * 1000) / 1000 };
}
export function rollAffixes(rng, item, count) {
  item.affixes = [];
  for (let i = 0; i < count; i++) { const a = rollAffix(rng, item); if (!a) break; item.affixes.push(a); }
  const rank = a => (AFFIXES[a.stat].type === 'prefix' ? 0 : 1);
  item.affixes.sort((a, b) => rank(a) - rank(b));
  return item.affixes;
}
// all stats of an item at its current level: base stats (× rarity), unique stats and affixes
export function itemStats(item) {
  const base = ITEM_BASES[item.baseId];
  const mult = rarityById(item.rarity)?.mult || 1, lvl = item.level;
  const stats = {};
  const add = (k, v) => { stats[k] = (stats[k] || 0) + v; };
  for (const [k, [b, per]] of Object.entries(base?.stats || {})) add(k, round(k, (b + per * lvl) * mult));
  for (const [k, [b, per]] of Object.entries(item.uniqueStats || {})) add(k, round(k, b + per * lvl));
  for (const a of item.affixes || []) add(a.stat, affixValue(a, lvl));
  for (const k of Object.keys(stats)) if (PCT_STATS.has(k)) stats[k] = Math.round(stats[k] * 1000) / 1000;
  return stats;
}
// "Brutal Steel Sword of the Fox": the best prefix and suffix name the item
export function itemName(item) {
  const base = ITEM_BASES[item.baseId];
  const lv = I.naming.levelPrefixes.filter(m => item.level >= m[0]).pop()?.[1] || '';
  const best = type => (item.affixes || []).filter(a => AFFIXES[a.stat]?.type === type).sort((a, b) => a.tier - b.tier)[0];
  const pre = best('prefix'), suf = best('suffix');
  return [pre && AFFIXES[pre.stat].name, lv, base?.name, suf && AFFIXES[suf.stat].name].filter(Boolean).join(' ');
}
// Ascension scales gear down; such items stay bound to their owner until reforged back to their original level
export const isSoulbound = item => !!item?.statRef;

export function generateItem(rng, level, { boost = 0, minRarity = 'common', baseId = null, uid, rarity: forcedRarity = null } = {}) {
  const baseIds = Object.keys(ITEM_BASES);
  const base = ITEM_BASES[baseId] || ITEM_BASES[baseIds[Math.floor(rng() * baseIds.length)]];
  const rarity = forcedRarity ? rarityById(forcedRarity) : rollRarity(rng, boost, minRarity);
  const lvl = Math.max(1, Math.min(CONFIG.levelCap, Math.round(level)));
  const item = {
    uid: uid || `i${Math.floor(rng() * 1e9).toString(36)}${Date.now().toString(36)}`,
    baseId: base.id, name: '', slot: base.slot, rarity: rarity.id, level: lvl,
    requiredLevel: Math.max(1, lvl - I.naming.requiredLevelBelowItemLevel), stats: {}, classes: base.classes, affixes: [],
  };
  rollAffixes(rng, item, rarity.affixes);
  item.stats = itemStats(item);
  item.name = itemName(item);
  const sockets = rollSockets(rng, item);
  if (sockets) item.sockets = Array(sockets).fill(null);
  return item;
}

export function canEquip(item, character) {
  if (!item) return false;
  if (item.requiredLevel > character.level) return false;
  if (item.classes && !item.classes.includes(character.classId)) return false;
  return true;
}
