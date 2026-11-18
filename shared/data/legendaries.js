// Unique items and item sets — defined in content/legendaries.json.
// Uniques: fixed name, base and bonus stats plus a special effect (proc or passive).
// Sets: epic pieces that grant bonuses when several pieces of the same set are equipped.
//
// Proc format: { trigger, chance, icd?, once?, filter?, target, effect, name }
//   trigger: 'hit' (you deal direct damage) | 'crit' | 'struck' (you take damage) | 'heal' (you heal with an ability)
//            'kill' | 'cast' (you use an ability) | 'lowHp' (your health drops below 30%)
//   target:  'self' | 'target' | 'source' | 'randomEnemy' | 'lowestAlly' | 'allAllies'
//   effect:  any ability effect (damage/heal/status/shield/resource) plus
//            { kind:'reflect', pct } · { kind:'healPct', pct } · { kind:'shieldPct', pct, duration } · { kind:'cooldowns', seconds }
// Passive format: { damageVsBossPct, damageVsHighHpPct, costPct }
// Images: assets/items/unique_<id>.png and assets/items/set_<setId>_<baseId>.png (fall back to the base item image)
import { generateItem, ITEM_BASES, AFFIXES } from './items.js';

import { CONTENT, withIds, onContentReload } from '../content.js';

const LG = CONTENT.legendaries;
export const UNIQUES = withIds(LG.uniques);
export const SETS = withIds(LG.sets);
export const DROP_CHANCE = LG.dropChance;
onContentReload(() => { withIds(UNIQUES); withIds(SETS); });

// ---------------------------------------------------------------- generation
// Zone-exclusive items ("zones": [...]) only drop in those zones; items without "zones" drop everywhere.
// zoneId null (e.g. co-op encounters) = any item.
export const dropsIn = (def, zoneId) => !zoneId || !def.zones?.length || def.zones.includes(zoneId);

export function generateUnique(rng, level, uniqueId = null, zoneId = null) {
  const pool = Object.values(UNIQUES).filter(u => u.minLevel <= Math.max(level, 1) && dropsIn(u, zoneId));
  const u = UNIQUES[uniqueId] || (pool.length ? pool[Math.floor(rng() * pool.length)] : null);
  if (!u) return null;
  const lvl = Math.max(u.minLevel, Math.round(level));
  const item = generateItem(rng, lvl, { baseId: u.baseId, rarity: 'legendary' });
  for (const [k, [b, per]] of Object.entries(u.stats)) {
    const v = b + per * lvl;
    item.stats[k] = (item.stats[k] || 0) + (AFFIXES[k]?.pct ? Math.round(v * 1000) / 1000 : Math.round(v));
  }
  item.name = u.name;
  item.unique = u.id;
  return item;
}

export function generateSetItem(rng, level, setId = null, baseId = null, zoneId = null) {
  const pool = Object.values(SETS).filter(s => s.minLevel <= Math.max(level, 1) && dropsIn(s, zoneId));
  const set = SETS[setId] || (pool.length ? pool[Math.floor(rng() * pool.length)] : null);
  if (!set) return null;
  const bases = Object.keys(set.pieces);
  const base = baseId && set.pieces[baseId] ? baseId : bases[Math.floor(rng() * bases.length)];
  const lvl = Math.max(set.minLevel, Math.round(level));
  const item = generateItem(rng, lvl, { baseId: base, rarity: 'epic' });
  item.name = set.pieces[base];
  item.set = set.id;
  return item;
}

// ---------------------------------------------------------------- equipped effects
export function equippedSetCounts(ch) {
  const counts = {};
  const seen = new Set();
  for (const it of Object.values(ch.equipment || {})) {
    if (!it?.set) continue;
    const k = `${it.set}:${it.baseId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    counts[it.set] = (counts[it.set] || 0) + 1;
  }
  return counts;
}

export function activeSetBonuses(ch) {
  const out = [];
  for (const [setId, n] of Object.entries(equippedSetCounts(ch))) {
    for (const [need, bonus] of Object.entries(SETS[setId]?.bonuses || {})) if (n >= Number(need)) out.push({ setId, need: Number(need), ...bonus });
  }
  return out;
}

// Stat bonuses from sets (merged into computeStats)
export function setStatBonuses(ch) {
  const out = {};
  for (const b of activeSetBonuses(ch)) for (const [k, v] of Object.entries(b.stats || {})) out[k] = (out[k] || 0) + v;
  return out;
}

// Procs and passives from uniques and set bonuses (used by the combat engine)
export function equipmentEffects(ch) {
  const procs = [];
  const passives = {};
  const addPassive = p => { for (const [k, v] of Object.entries(p || {})) passives[k] = (passives[k] || 0) + v; };
  for (const it of Object.values(ch.equipment || {})) {
    const u = it?.unique ? UNIQUES[it.unique] : null;
    if (!u) continue;
    for (const p of u.procs || []) procs.push({ ...p });
    addPassive(u.passive);
  }
  for (const b of activeSetBonuses(ch)) {
    for (const p of b.procs || []) procs.push({ ...p });
    addPassive(b.passive);
  }
  return { procs, passives };
}

export function specialItemImageKeys(item) {
  if (item.unique) return [`items/unique_${item.unique}`];
  if (item.set) return [`items/set_${item.set}_${item.baseId}`, `items/set_${item.set}`];
  return [];
}

export { ITEM_BASES };
