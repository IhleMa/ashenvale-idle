// Town calculations shared by server (authoritative) and client (previews).
import { rarityIndex, rarityById } from './config.js';
import { AFFIXES, ITEM_BASES } from './data/items.js';
import {
  BUILDINGS, BUILD_TIME, INN_ROSTER, INN_OFFERS, SALVAGE_BONUS, GATHER_RATE, GATHER_NO_WORKER, GATHER_HOURS,
  CRAFT_LEVEL_CAP, ITEM_MATERIAL, MATERIAL_OF_TYPE, QUALITIES, ELIXIRS, ELIXIR_BASE_MINUTES, enchantPower,
} from './data/town.js';

export function newTown() {
  const buildings = {};
  for (const [id, b] of Object.entries(BUILDINGS)) buildings[id] = { level: b.start, upgrade: null, worker: null, stored: {}, updatedAt: Date.now() };
  return { buildings, materials: {}, elixirs: {} };
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
const qty = (base, L, exp = 1.5) => Math.ceil(base * Math.pow(L, exp));

export function upgradeCost(id, toLevel) {
  const def = BUILDINGS[id];
  const mats = {};
  let gold = 0;
  for (const [k, v] of Object.entries(def.cost)) {
    if (k === 'gold') gold = Math.round(v * Math.pow(toLevel, 2.2));
    else if (v > 0) mats[k] = qty(v, toLevel);
  }
  for (const [k, [from, base]] of Object.entries(def.costFrom || {})) if (toLevel >= from) mats[k] = qty(base, toLevel - from + 1);
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
  if (id !== 'town_hall' && b.level + 1 > bLevel(p, 'town_hall')) return `Requires Town Hall level ${b.level + 1}`;
  const max = [0, 1, 1, 2, 2, 3][bLevel(p, 'town_hall')] || 1;
  if (activeBuilds(p) >= max) return `Only ${max} construction${max > 1 ? 's' : ''} at a time — upgrade the Town Hall for more`;
  if (!canAfford(p, upgradeCost(id, b.level + 1))) return 'Not enough gold or materials';
  return null;
}

// ---------------------------------------------------------------- gathering
export function gatherPerHour(p, id) {
  const def = BUILDINGS[id];
  const L = bLevel(p, id);
  if (def.kind !== 'gather' || L < 1) return {};
  const w = worker(p, id);
  const mult = (w ? 1 + w.profession.level * 0.02 : GATHER_NO_WORKER);
  return Object.fromEntries(Object.entries(def.produces).map(([m, f]) => [m, GATHER_RATE[L] * f * mult]));
}

// Stored amounts right now (production accumulates since updatedAt, capped)
export function gatherStored(p, id, now = Date.now()) {
  const b = p.town.buildings[id];
  const rate = gatherPerHour(p, id);
  const hours = Math.max(0, (now - (b.updatedAt || now)) / 3600000);
  const out = {};
  for (const [m, r] of Object.entries(rate)) out[m] = Math.min(r * GATHER_HOURS, (b.stored?.[m] || 0) + r * hours);
  return out;
}

// ---------------------------------------------------------------- salvage
export function salvageYield(item, salvageLevel = 1, enchanterBonus = false) {
  const type = ITEM_MATERIAL[item.baseId] || 'metal';
  const r = rarityIndex(item.rarity);
  const bonus = 1 + (SALVAGE_BONUS[salvageLevel] || 0);
  const arcane = bonus * (enchanterBonus ? 1.25 : 1);
  const out = {};
  const add = (k, v) => { const n = Math.floor(v); if (n > 0) out[k] = (out[k] || 0) + n; };
  add(MATERIAL_OF_TYPE[type], (1 + item.level / 7) * (1 + r * 0.25) * bonus);
  if (r >= 1) add('arcane_dust', (1 + item.level / 12) * (r >= 2 ? 1.5 : 1) * arcane);
  if (r >= 2) add('magic_essence', (1 + item.level / 25) * (r >= 3 ? 1.5 : 1) * arcane);
  if (r >= 3) add('prismatic_shard', (1 + item.level / 40) * (r >= 4 ? 1.5 : 1) * arcane);
  if (r >= 4) add('void_crystal', (r >= 5 ? 2 : 1) * Math.max(1, arcane * 0.9));
  return out;
}

// ---------------------------------------------------------------- crafting
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

export function reforgedStats(item, targetLevel) {
  const base = ITEM_BASES[item.baseId];
  const stats = {};
  for (const [k, v] of Object.entries(item.stats)) {
    let from, to;
    if (base?.stats[k]) { const [b, per] = base.stats[k]; from = b + per * item.level; to = b + per * targetLevel; }
    else if (AFFIXES[k]) { from = AFFIXES[k].base + AFFIXES[k].perLevel * item.level; to = AFFIXES[k].base + AFFIXES[k].perLevel * targetLevel; }
    else { from = 1; to = 1; }
    const nv = v * (to / Math.max(1e-9, from));
    stats[k] = AFFIXES[k]?.pct ? Math.round(nv * 1000) / 1000 : Math.round(nv);
  }
  return stats;
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
