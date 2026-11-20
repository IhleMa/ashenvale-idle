// Town data — materials, professions, buildings, crafting, enchanting and alchemy.
// Everything is defined in content/town.json; this module only adds derived values.
import { CONTENT, withIds, onContentReload, refillArray, refillObject } from '../content.js';
import { ITEM_BASES } from './items.js';

const T = CONTENT.town;

export const MATERIALS = T.materials;
export const MATERIAL_IDS = Object.keys(MATERIALS);

export const PROFESSIONS = withIds(T.professions);
export const PROFESSION_IDS = Object.keys(PROFESSIONS);
export const PROFESSION_MAX = T.professionMax;
export const professionXpToNext = lvl => T.professionXp.base + lvl * T.professionXp.perLevel;

// Which material an item base is made of (salvage output + which crafting building handles it): "material" on each base
const itemMaterials = () => Object.fromEntries(Object.entries(ITEM_BASES).map(([id, b]) => [id, b.material || 'metal']));
export const ITEM_MATERIAL = itemMaterials();
export const MATERIAL_OF_TYPE = T.materialOfType;
export const CRAFT_BUILDING_OF_TYPE = T.craftBuildingOfType;

// Construction time (seconds) to reach level N (index = target level)
export const BUILD_TIME = T.buildTime;

// kind: 'core' | 'craft' | 'gather' | 'special' — see shared/town.js for cost formulas
export const BUILDINGS = withIds(T.buildings);
export const BUILDING_IDS = Object.keys(BUILDINGS);
onContentReload(() => {
  refillArray(MATERIAL_IDS, Object.keys(MATERIALS));
  withIds(PROFESSIONS); refillArray(PROFESSION_IDS, Object.keys(PROFESSIONS));
  refillObject(ITEM_MATERIAL, itemMaterials());
  withIds(BUILDINGS); refillArray(BUILDING_IDS, Object.keys(BUILDINGS));
});

export const INN_ROSTER = T.innRoster;
export const INN_OFFERS = T.innOffers;
export const SALVAGE_BONUS = T.salvageBonus;
export const CRAFT_LEVEL_CAP = T.craftLevelCap;
export const concurrentBuilds = L => T.concurrentBuilds[L] || 1;

export const QUALITIES = T.qualities;

// ---- Enchanting
export function ENCHANT_STATS_BY_LEVEL(L) {
  const levels = Object.keys(T.enchanting.statsByLevel).map(Number).sort((a, b) => a - b);
  const lvl = levels.filter(x => x <= Math.max(L, levels[0])).pop();
  return T.enchanting.statsByLevel[lvl];
}
export const enchantPower = (L, skill) => T.enchanting.power.base + T.enchanting.power.perLevel * L + skill * T.enchanting.power.perSkill;

// ---- Alchemy (timed party buffs). bonus keys: damagePct, damageTakenPct, xpPct, goldPct, allStatsPct
export const ELIXIRS = T.elixirs;
export const ELIXIR_BASE_MINUTES = T.elixirBaseMinutes;
export const ELIXIR_MAX_HOURS = T.elixirMaxHours;

// ---- Building effect text: templates in content/town.json, filled per level.
// {var} inserts a value, {var:s} adds "s" when the value isn't 1. Entries can be { text, minLevel, maxLevel }.
function effectVars(id, L) {
  const q = Object.values(QUALITIES).filter(x => x.building <= L).pop();
  const camp = CONTENT.expeditions;
  return {
    level: L,
    concurrentBuilds: concurrentBuilds(L),
    innRoster: INN_ROSTER[L], innOffers: INN_OFFERS[L],
    salvageBonusPct: Math.round((SALVAGE_BONUS[L] || 0) * 100),
    campSlots: camp.campSlots[L], campMembers: camp.campMembers[L],
    craftLevelCap: CRAFT_LEVEL_CAP[L], bestQuality: q?.label || '—', bestQualityRarity: q?.minRarity || '—',
    enchantPowerPct: Math.round(enchantPower(L, 0) * 100), enchantStatCount: ENCHANT_STATS_BY_LEVEL(L).length,
    elixirs: Object.values(ELIXIRS).filter(e => e.level <= L).map(e => e.name).join(', ') || '—',
    elixirDurationPct: Math.round((L - 1) * 10),
  };
}
export function fillTemplate(text, vars) {
  return String(text)
    .replace(/\{(\w+):(\w*)\}/g, (m, k, suffix) => (vars[k] === 1 ? '' : suffix))
    .replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}
export function buildingEffects(id, L) {
  const vars = effectVars(id, L);
  return (BUILDINGS[id]?.effects || [])
    .filter(e => typeof e === 'string' || ((e.minLevel == null || L >= e.minLevel) && (e.maxLevel == null || L <= e.maxLevel)))
    .map(e => fillTemplate(typeof e === 'string' ? e : e.text, vars));
}
