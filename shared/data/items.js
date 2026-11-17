// Item slots, bases, affixes and loot generation. The data lives in content/items.json.
// Item images are looked up by base id (assets/items/<baseId>.png) and optionally by rarity
// (assets/items/<baseId>_<rarity>.png) — see public/assets/README.md.
import { CONFIG, rarityIndex, rarityById } from '../config.js';
import { CONTENT, withIds } from '../content.js';

const I = CONTENT.items;
export const SLOTS = I.slots;
export const SLOT_IDS = Object.keys(SLOTS);

// stats: { stat: [base, perLevel] }  — final = (base + perLevel * itemLevel) * rarity multiplier
export const ITEM_BASES = withIds(I.bases);

// Random bonus stats ("affixes") — magnitude per item level
export const AFFIXES = I.affixes;

export const STAT_LABELS = {
  ...Object.fromEntries(Object.entries(AFFIXES).map(([k, v]) => [k, v.label])),
  ...I.extraStatLabels,
};
export const PCT_STATS = new Set(I.pctStats);

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

export function generateItem(rng, level, { boost = 0, minRarity = 'common', baseId = null, uid, rarity: forcedRarity = null } = {}) {
  const baseIds = Object.keys(ITEM_BASES);
  const base = ITEM_BASES[baseId] || ITEM_BASES[baseIds[Math.floor(rng() * baseIds.length)]];
  const rarity = forcedRarity ? rarityById(forcedRarity) : rollRarity(rng, boost, minRarity);
  const lvl = Math.max(1, Math.min(CONFIG.levelCap, Math.round(level)));
  const stats = {};
  const add = (k, v) => { stats[k] = (stats[k] || 0) + v; };
  for (const [k, [b, per]] of Object.entries(base.stats)) add(k, (b + per * lvl) * rarity.mult);
  const pool = Object.keys(AFFIXES).filter(k => !(k in base.stats));
  for (let i = 0; i < rarity.affixes && pool.length; i++) {
    const k = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    const a = AFFIXES[k];
    add(k, (a.base + a.perLevel * lvl) * (I.naming.affixRollMin + rng() * I.naming.affixRollRange) * rarity.mult);
  }
  for (const k of Object.keys(stats)) stats[k] = PCT_STATS.has(k) ? Math.round(stats[k] * 1000) / 1000 : Math.round(stats[k]);
  const N = I.naming;
  const prefix = N.levelPrefixes.filter(m => lvl >= m[0]).pop()[1];
  let name = `${prefix} ${base.name}`;
  if (rarityIndex(rarity.id) >= rarityIndex(N.suffixFromRarity)) name += ' ' + N.suffixes[Math.floor(rng() * N.suffixes.length)];
  const item = {
    uid: uid || `i${Math.floor(rng() * 1e9).toString(36)}${Date.now().toString(36)}`,
    baseId: base.id, name, slot: base.slot, rarity: rarity.id, level: lvl,
    requiredLevel: Math.max(1, lvl - I.naming.requiredLevelBelowItemLevel), stats, classes: base.classes,
  };
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
