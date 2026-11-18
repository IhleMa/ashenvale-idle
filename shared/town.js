// Town calculations shared by server (authoritative) and client (previews).
import { rarityIndex, rarityById } from './config.js';
import { AFFIXES, ITEM_BASES } from './data/items.js';
import { CONTENT } from './content.js';
import { ZONES } from './data/zones.js';
import { unlockHeroLevel } from './unlocks.js';
import {
  BUILDINGS, BUILD_TIME, INN_ROSTER, INN_OFFERS, SALVAGE_BONUS,
  CRAFT_LEVEL_CAP, ITEM_MATERIAL, MATERIAL_OF_TYPE, QUALITIES, ELIXIRS, ELIXIR_BASE_MINUTES, enchantPower,
} from './data/town.js';

export function newTown() {
  const buildings = {};
  for (const [id, b] of Object.entries(BUILDINGS)) buildings[id] = { level: b.start, upgrade: null, worker: null };
  return { buildings, materials: {}, elixirs: {}, gems: {} };
}

export const bLevel = (p, id) => p.town?.buildings?.[id]?.level || 0;
export const rosterLimit = p => INN_ROSTER[bLevel(p, 'inn')] || INN_ROSTER[1];
export const recruitOffers = p => INN_OFFERS[bLevel(p, 'inn')] || INN_OFFERS[1];

// Profession skill of the worker assigned to a building (0 if none / wrong profession)
export function worker(p, id) {
  const b = p.town?.buildings?.[id];
  const ch = b?.worker ? p.characters[b.worker] : null;
  const prof = BUILDINGS[id]?.profession;
  if (!ch || !prof || ch.profession?.id !== prof) return null;
  return ch;
}
export const workerSkill = (p, id) => worker(p, id)?.profession.level || 0;

// ---------------------------------------------------------------- construction
const F = CONTENT.town.costFormula;
const qty = (base, L, exp = F.materialExponent) => Math.ceil(base * Math.pow(L, exp));

export function upgradeCost(id, toLevel) {
  const def = BUILDINGS[id];
  const mats = {};
  let gold = 0;
  for (const [k, v] of Object.entries(def.cost)) {
    if (k === 'gold') gold = Math.round(v * Math.pow(toLevel, F.goldExponent));
    else if (v > 0) mats[k] = qty(v, toLevel);
  }
  for (const [k, [from, base]] of Object.entries(def.costFrom || {})) if (toLevel >= from) mats[k] = qty(base, toLevel - from + 1);
  // zone materials: every level from 2 on needs the material of a zone (see town/_settings.json → levelMaterials)
  for (const [k, n] of Object.entries(CONTENT.town.levelMaterials?.[toLevel] || {})) mats[k] = (mats[k] || 0) + Math.ceil(n * (def.zoneMaterialMult ?? 1));
  return { gold, mats };
}
export const buildSeconds = (id, toLevel) => Math.round((BUILD_TIME[toLevel] || 0) * (BUILDINGS[id].timeMult || 1));

export function activeBuilds(p) {
  return Object.values(p.town.buildings).filter(b => b.upgrade).length;
}

export function canAfford(p, { gold = 0, mats = {} }) {
  if ((p.gold || 0) < gold) return false;
  return Object.entries(mats).every(([k, v]) => (p.town.materials[k] || 0) >= v);
}

export function upgradeBlocker(p, id) {
  const def = BUILDINGS[id];
  const b = p.town.buildings[id];
  if (!def || !b) return 'Unknown building';
  if (b.upgrade) return 'Already under construction';
  if (b.level >= def.maxLevel) return 'Maximum level reached';
  const heroLevel = unlockHeroLevel(p) || 1;
  if (def.unlockLevel && heroLevel < def.unlockLevel) return `Unlocks at hero level ${def.unlockLevel}`;
  if (id !== 'town_hall' && b.level + 1 > bLevel(p, 'town_hall')) return `Requires Town Hall level ${b.level + 1}`;
  const max = CONTENT.town.concurrentBuilds[bLevel(p, 'town_hall')] || 1;
  if (activeBuilds(p) >= max) return `Only ${max} construction${max > 1 ? 's' : ''} at a time — upgrade the Town Hall for more`;
  if (!canAfford(p, upgradeCost(id, b.level + 1))) return 'Not enough gold or materials';
  return null;
}

// ---------------------------------------------------------------- salvage
export function salvageYield(item, salvageLevel = 1, enchanterBonus = false) {
  const S = CONTENT.town.salvage;
  const type = ITEM_MATERIAL[item.baseId] || 'metal';
  const r = rarityIndex(item.rarity);
  const bonus = 1 + (SALVAGE_BONUS[salvageLevel] || 0);
  const arcane = bonus * (enchanterBonus ? 1 + S.enchanterArcaneBonus : 1);
  const out = {};
  const add = (k, v) => { const n = Math.floor(v); if (n > 0) out[k] = (out[k] || 0) + n; };
  const bm = S.baseMaterial;
  add(MATERIAL_OF_TYPE[type], (bm.base + item.level / bm.levelDivisor) * (1 + r * bm.perRarity) * bonus);
  for (const a of S.arcane) {
    if (r >= rarityIndex(a.fromRarity)) add(a.material, (1 + item.level / a.levelDivisor) * (r >= rarityIndex(a.betterRarity) ? a.betterMult : 1) * arcane);
  }
  const vc = S.voidCrystal;
  if (r >= rarityIndex(vc.fromRarity)) add(vc.material, (r >= rarityIndex('mythic') ? vc.mythicAmount : vc.amount) * Math.max(1, arcane * vc.arcaneFactor));
  return out;
}

// ---------------------------------------------------------------- crafting
// The material of the zone whose level range an item level belongs to (highest zone starting at or below it)
export function zoneMaterialForLevel(level) {
  const z = Object.values(ZONES).filter(z => z.material && z.levelRange[0] <= level).sort((a, b) => b.levelRange[0] - a.levelRange[0])[0];
  return z?.material || null;
}
export function craftableBases(type) {
  return Object.values(ITEM_BASES).filter(b => ITEM_MATERIAL[b.id] === type);
}
export const craftLevelCap = (p, buildingId, heroLevel) => Math.min(heroLevel, CRAFT_LEVEL_CAP[bLevel(p, buildingId)] || 0);

export function craftCost(baseId, level, quality = 'standard') {
  const type = ITEM_MATERIAL[baseId];
  const mats = { [MATERIAL_OF_TYPE[type]]: Math.ceil(6 + level * 0.5) };
  if (type === 'metal' || type === 'gem') mats.ore = Math.ceil(3 + level * 0.3);
  mats.arcane_dust = Math.ceil(2 + level * 0.15);
  const q = QUALITIES[quality];
  if (q?.extra === 'magic_essence') mats.magic_essence = Math.ceil(2 + level / 15);
  if (q?.extra === 'prismatic_shard') mats.prismatic_shard = Math.ceil(1 + level / 25);
  if (q?.extra === 'void_crystal') mats.void_crystal = Math.ceil(1 + level / 30);
  if (q?.zoneMaterial) { const zm = zoneMaterialForLevel(level); if (zm) mats[zm] = Math.ceil(q.zoneMaterial + level / 20); } // the material of the zone for that item level
  const goldMult = { standard: 1, fine: 1.5, superior: 2.5, masterwork: 4 }[quality] || 1;
  return { gold: Math.round((25 + level * 6) * goldMult), mats };
}

export function craftRarityBoost(buildingLevel, skill) {
  return 0.15 + buildingLevel * 0.1 + skill * 0.01 + (buildingLevel >= 5 ? 0.3 : 0);
}

// Reforge: raise an item's level, rescaling its stats
export function reforgeCost(item, targetLevel) {
  const gain = Math.max(0, targetLevel - item.level);
  const type = ITEM_MATERIAL[item.baseId] || 'metal';
  const rm = 1 + rarityIndex(item.rarity) * 0.3;
  return { gold: Math.round(gain * 12 * rm), mats: { [MATERIAL_OF_TYPE[type]]: Math.ceil(gain * 1.5 * rm), arcane_dust: Math.ceil(gain * 0.5 * rm) } };
}

// Items scaled down by ascension remember their original stats (item.statRef), so reforging them back up is exact
// instead of compounding rounding errors from the small level-1 values.
export function reforgedStats(item, targetLevel) {
  const base = ITEM_BASES[item.baseId];
  const src = item.statRef || { level: item.level, stats: item.stats };
  const stats = {};
  for (const [k, v] of Object.entries(src.stats)) {
    let from, to;
    if (base?.stats[k]) { const [b, per] = base.stats[k]; from = b + per * src.level; to = b + per * targetLevel; }
    else if (AFFIXES[k]) { from = AFFIXES[k].base + AFFIXES[k].perLevel * src.level; to = AFFIXES[k].base + AFFIXES[k].perLevel * targetLevel; }
    else { from = 1; to = 1; }
    const nv = v * (to / Math.max(1e-9, from));
    stats[k] = AFFIXES[k]?.pct ? Math.round(nv * 1000) / 1000 : Math.round(nv);
  }
  return stats;
}

// Rescales an item to another level in place (used by ascension: the hero's gear drops to level 1 and can be
// reforged back up). Keeps rarity, affixes, unique/set identity and sockets; enchantments scale with it.
export function rescaleItem(item, level) {
  if (!item || item.level === level) return item;
  if (!item.statRef) item.statRef = { level: item.level, stats: { ...item.stats }, enchant: item.enchant ? { ...item.enchant } : null };
  if (item.enchant) item.enchant = { ...reforgedEnchant(item, level), scaled: true };
  item.stats = reforgedStats(item, level);
  item.level = level;
  item.requiredLevel = Math.max(1, level - 2);
  if (level >= item.statRef.level) delete item.statRef; // back at (or above) its original level
  return item;
}

// The item's enchantment at another level (from the remembered original while it's still the same enchantment).
export function reforgedEnchant(item, targetLevel) {
  const e = item.enchant;
  if (!e) return null;
  const a = AFFIXES[e.stat];
  if (!a) return e;
  const src = e.scaled && item.statRef?.enchant?.stat === e.stat ? { ...item.statRef.enchant, level: item.statRef.level } : { ...e, level: item.level };
  const v = src.value * (a.base + a.perLevel * targetLevel) / Math.max(1e-9, a.base + a.perLevel * src.level);
  return { ...e, value: a.pct ? Math.round(v * 1000) / 1000 : Math.max(1, Math.round(v)) };
}

// ---------------------------------------------------------------- enchanting
export function enchantValue(stat, itemLevel, buildingLevel, skill) {
  const a = AFFIXES[stat];
  const v = (a.base + a.perLevel * itemLevel) * enchantPower(buildingLevel, skill);
  return a.pct ? Math.round(v * 1000) / 1000 : Math.max(1, Math.round(v));
}
export function enchantCost(itemLevel, rarity) {
  const r = rarityIndex(rarity);
  return { gold: Math.round(20 + itemLevel * 5), mats: { arcane_dust: Math.ceil(4 + itemLevel * 0.3), ...(itemLevel >= 15 || r >= 3 ? { magic_essence: Math.ceil(1 + itemLevel / 20) } : {}) } };
}

// ---------------------------------------------------------------- alchemy
export function elixirCost(id, heroLevel) {
  const e = ELIXIRS[id];
  const s = 1 + heroLevel / 20;
  const mats = { herb: Math.ceil(e.herbs * s), arcane_dust: Math.ceil(e.dust * s) };
  if (e.essence) mats.magic_essence = Math.ceil(e.essence * s);
  return { gold: Math.round(e.gold * s), mats };
}
export const elixirMinutes = (buildingLevel, skill) => Math.round(ELIXIR_BASE_MINUTES * (1 + (buildingLevel - 1) * 0.1 + skill * 0.01));

// Combined bonuses of all elixirs active at time `at`
export function elixirBonuses(p, at = Date.now()) {
  const out = { damagePct: 0, damageTakenPct: 0, xpPct: 0, goldPct: 0, allStatsPct: 0 };
  for (const [id, exp] of Object.entries(p.town?.elixirs || {})) {
    if (exp <= at || !ELIXIRS[id]) continue;
    for (const [k, v] of Object.entries(ELIXIRS[id].bonus)) out[k] += v;
  }
  return out;
}

export { rarityById };
