// Item bases and loot generation.
// Item images are looked up by base id (assets/items/<baseId>.png) and optionally by rarity
// (assets/items/<baseId>_<rarity>.png) — see public/assets/README.md.
import { CONFIG, rarityIndex, rarityById } from '../config.js';

export const SLOTS = {
  weapon:  { label: 'Weapon' },
  offhand: { label: 'Off-hand' },
  head:    { label: 'Helmet' },
  chest:   { label: 'Armor' },
  hands:   { label: 'Gloves' },
  feet:    { label: 'Boots' },
  ring:    { label: 'Ring' },
  amulet:  { label: 'Amulet' },
};
export const SLOT_IDS = Object.keys(SLOTS);

// stats: { stat: [base, perLevel] }  — final = (base + perLevel * itemLevel) * rarity multiplier
export const ITEM_BASES = {
  // Weapons
  sword:    { name: 'Sword',      slot: 'weapon', classes: ['warrior', 'rogue'], stats: { physPower: [4, 1.5] } },
  axe:      { name: 'Battleaxe',  slot: 'weapon', classes: ['warrior'], stats: { physPower: [5, 1.7], critDamage: [0.05, 0.002] } },
  mace:     { name: 'Mace',       slot: 'weapon', classes: ['warrior', 'cleric'], stats: { physPower: [3, 1.0], healPower: [2, 0.8], magPower: [2, 0.6] } },
  dagger:   { name: 'Dagger',     slot: 'weapon', classes: ['rogue'], stats: { physPower: [3, 1.3], critChance: [0.02, 0.0004] } },
  staff:    { name: 'Staff',      slot: 'weapon', classes: ['mage', 'cleric'], stats: { magPower: [5, 1.6], healPower: [3, 1.0] } },
  wand:     { name: 'Wand',       slot: 'weapon', classes: ['mage', 'cleric'], stats: { magPower: [4, 1.4], critChance: [0.01, 0.0003] } },
  bow:      { name: 'Longbow',    slot: 'weapon', classes: ['ranger'], stats: { physPower: [4, 1.5], attackSpeed: [0.02, 0.0005] } },
  crossbow: { name: 'Crossbow',   slot: 'weapon', classes: ['ranger'], stats: { physPower: [5, 1.7] } },
  // Off-hands
  shield:   { name: 'Shield',     slot: 'offhand', classes: ['warrior', 'cleric'], stats: { defense: [4, 1.4], hp: [10, 3] } },
  tome:     { name: 'Tome',       slot: 'offhand', classes: ['mage', 'cleric'], stats: { int: [2, 0.6], magPower: [1, 0.5] } },
  quiver:   { name: 'Quiver',     slot: 'offhand', classes: ['ranger'], stats: { dex: [2, 0.6], attackSpeed: [0.01, 0.0004] } },
  parrying_dagger: { name: 'Parrying Dagger', slot: 'offhand', classes: ['rogue'], stats: { dex: [2, 0.6], defense: [1, 0.4] } },
  // Armor – plate
  plate_helm:   { name: 'Plate Helm',      slot: 'head',  classes: ['warrior', 'cleric'], stats: { defense: [3, 0.9], vit: [1, 0.3] } },
  plate_chest:  { name: 'Plate Armor',     slot: 'chest', classes: ['warrior', 'cleric'], stats: { defense: [5, 1.6], vit: [2, 0.5] } },
  plate_gloves: { name: 'Gauntlets',       slot: 'hands', classes: ['warrior', 'cleric'], stats: { defense: [2, 0.6], str: [1, 0.3] } },
  plate_boots:  { name: 'Sabatons',        slot: 'feet',  classes: ['warrior', 'cleric'], stats: { defense: [2, 0.7], vit: [1, 0.3] } },
  // Armor – leather
  leather_hood:   { name: 'Leather Hood',   slot: 'head',  classes: ['rogue', 'ranger', 'warrior'], stats: { defense: [2, 0.6], dex: [1, 0.35] } },
  leather_chest:  { name: 'Leather Jerkin', slot: 'chest', classes: ['rogue', 'ranger', 'warrior'], stats: { defense: [3, 1.1], dex: [2, 0.5] } },
  leather_gloves: { name: 'Leather Gloves', slot: 'hands', classes: ['rogue', 'ranger', 'warrior'], stats: { defense: [1, 0.4], critChance: [0.01, 0.0002] } },
  leather_boots:  { name: 'Leather Boots',  slot: 'feet',  classes: ['rogue', 'ranger', 'warrior'], stats: { defense: [1, 0.5], attackSpeed: [0.01, 0.0003] } },
  // Armor – cloth (any class)
  cloth_hat:    { name: 'Cloth Hat',     slot: 'head',  classes: null, stats: { defense: [1, 0.3], int: [1, 0.4] } },
  robe:         { name: 'Robe',          slot: 'chest', classes: null, stats: { defense: [2, 0.6], int: [2, 0.6] } },
  cloth_gloves: { name: 'Silk Gloves',   slot: 'hands', classes: null, stats: { defense: [1, 0.2], magPower: [1, 0.4] } },
  cloth_boots:  { name: 'Sandals',       slot: 'feet',  classes: null, stats: { defense: [1, 0.25], healPower: [1, 0.4] } },
  // Accessories
  ring:   { name: 'Ring',   slot: 'ring',   classes: null, stats: { critChance: [0.01, 0.0003] } },
  amulet: { name: 'Amulet', slot: 'amulet', classes: null, stats: { hp: [12, 4] } },
};
for (const [id, b] of Object.entries(ITEM_BASES)) b.id = id;

// Random bonus stats ("affixes") — magnitude per item level
export const AFFIXES = {
  str:         { label: 'Strength', base: 1, perLevel: 0.55 },
  int:         { label: 'Intelligence', base: 1, perLevel: 0.55 },
  dex:         { label: 'Dexterity', base: 1, perLevel: 0.55 },
  vit:         { label: 'Vitality', base: 1, perLevel: 0.55 },
  hp:          { label: 'Health', base: 8, perLevel: 3.5 },
  defense:     { label: 'Defense', base: 1, perLevel: 0.5 },
  physPower:   { label: 'Physical Power', base: 1, perLevel: 0.6 },
  magPower:    { label: 'Magic Power', base: 1, perLevel: 0.6 },
  healPower:   { label: 'Healing Power', base: 1, perLevel: 0.6 },
  critChance:  { label: 'Critical Chance', base: 0.008, perLevel: 0.0003, pct: true },
  critDamage:  { label: 'Critical Damage', base: 0.04, perLevel: 0.002, pct: true },
  attackSpeed: { label: 'Attack Speed', base: 0.015, perLevel: 0.0005, pct: true },
};

export const STAT_LABELS = {
  ...Object.fromEntries(Object.entries(AFFIXES).map(([k, v]) => [k, v.label])),
  maxHp: 'Max Health',
};
export const PCT_STATS = new Set(['critChance', 'critDamage', 'attackSpeed']);

const MATERIALS = [
  [1, 'Worn'], [6, 'Iron'], [12, 'Steel'], [20, 'Runed'], [30, 'Ashen'], [40, 'Voidforged'], [52, 'Eternal'],
];
const SUFFIXES = ['of the Bear', 'of the Owl', 'of the Fox', 'of Embers', 'of Frost', 'of the Phoenix', 'of Shadows', 'of the Ancients', 'of Ashenvale', 'of the Void'];

export function itemSellValue(item) {
  return Math.floor((5 + item.level * 3) * Math.pow(2, rarityIndex(item.rarity)));
}

export function rollRarity(rng, boost = 0, minRarity = 'common') {
  const minIdx = rarityIndex(minRarity);
  const list = CONFIG.rarities.map((r, i) => ({ r, w: i < minIdx ? 0 : r.weight * Math.pow(1 + boost, i) }));
  const total = list.reduce((s, x) => s + x.w, 0);
  let roll = rng() * total;
  for (const x of list) { if ((roll -= x.w) <= 0) return x.r; }
  return list[list.length - 1].r;
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
    add(k, (a.base + a.perLevel * lvl) * (0.7 + rng() * 0.3) * rarity.mult);
  }
  for (const k of Object.keys(stats)) stats[k] = PCT_STATS.has(k) ? Math.round(stats[k] * 1000) / 1000 : Math.round(stats[k]);
  const material = MATERIALS.filter(m => lvl >= m[0]).pop()[1];
  let name = `${material} ${base.name}`;
  if (rarityIndex(rarity.id) >= 3) name += ' ' + SUFFIXES[Math.floor(rng() * SUFFIXES.length)];
  return {
    uid: uid || `i${Math.floor(rng() * 1e9).toString(36)}${Date.now().toString(36)}`,
    baseId: base.id, name, slot: base.slot, rarity: rarity.id, level: lvl,
    requiredLevel: Math.max(1, lvl - 2), stats, classes: base.classes,
  };
}

export function canEquip(item, character) {
  if (!item) return false;
  if (item.requiredLevel > character.level) return false;
  if (item.classes && !item.classes.includes(character.classId)) return false;
  return true;
}
