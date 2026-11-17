// Town (garrison) definitions: materials, professions, buildings, elixirs.
// Images: assets/buildings/<id>.png, assets/materials/<id>.png, assets/professions/<id>.png, assets/elixirs/<id>.png

export const MATERIALS = {
  metal_scrap:     { name: 'Metal Scrap',     glyph: '⛓', color: '#8a9099', description: 'Salvaged from weapons, plate armor and shields.' },
  leather_scrap:   { name: 'Leather Scrap',   glyph: '🟫', color: '#9a6a3a', description: 'Salvaged from leather armor, bows and quivers.' },
  cloth_scrap:     { name: 'Cloth Scrap',     glyph: '🧵', color: '#a88ac2', description: 'Salvaged from cloth armor, staves, wands and tomes.' },
  gem_fragment:    { name: 'Gem Fragment',    glyph: '💎', color: '#5ac8d8', description: 'Salvaged from jewelry; also brought back from expeditions.' },
  ore:             { name: 'Ore',             glyph: '⛏', color: '#b07a4a', description: 'Brought back by recruits on mining expeditions.' },
  herb:            { name: 'Herb',            glyph: '🌿', color: '#5fbf5a', description: 'Gathered by recruits on herb expeditions.' },
  arcane_dust:     { name: 'Arcane Dust',     glyph: '✨', color: '#c9b8ff', description: 'Disenchanted from Uncommon or better items.' },
  magic_essence:   { name: 'Magic Essence',   glyph: '🔮', color: '#6ea4ff', description: 'Disenchanted from Rare or better items.' },
  prismatic_shard: { name: 'Prismatic Shard', glyph: '🔷', color: '#c98aff', description: 'Disenchanted from Epic or better items.' },
  void_crystal:    { name: 'Void Crystal',    glyph: '🌑', color: '#ff6f88', description: 'Disenchanted from Legendary or Mythic items.' },
};
export const MATERIAL_IDS = Object.keys(MATERIALS);

export const PROFESSIONS = {
  blacksmithing:  { name: 'Blacksmithing',  glyph: '⚒', building: 'blacksmith' },
  leatherworking: { name: 'Leatherworking', glyph: '🪡', building: 'leatherworker' },
  tailoring:      { name: 'Tailoring',      glyph: '🧶', building: 'tailor' },
  jewelcrafting:  { name: 'Jewelcrafting',  glyph: '💍', building: 'jeweler' },
  enchanting:     { name: 'Enchanting',     glyph: '✨', building: 'enchanter' },
  alchemy:        { name: 'Alchemy',        glyph: '⚗', building: 'alchemy_lab' },
  mining:         { name: 'Mining',         glyph: '⛏', building: null, expedition: true },
  herbalism:      { name: 'Herbalism',      glyph: '🌿', building: null, expedition: true },
};
export const PROFESSION_IDS = Object.keys(PROFESSIONS);
export const PROFESSION_MAX = 50;
export const professionXpToNext = lvl => 40 + lvl * 20;

// Which material an item base is made of (salvage output + which crafting building handles it)
export const ITEM_MATERIAL = {
  sword: 'metal', axe: 'metal', mace: 'metal', dagger: 'metal', crossbow: 'metal', shield: 'metal',
  plate_helm: 'metal', plate_chest: 'metal', plate_gloves: 'metal', plate_boots: 'metal',
  bow: 'leather', quiver: 'leather', parrying_dagger: 'leather', leather_hood: 'leather', leather_chest: 'leather', leather_gloves: 'leather', leather_boots: 'leather',
  staff: 'cloth', wand: 'cloth', tome: 'cloth', cloth_hat: 'cloth', robe: 'cloth', cloth_gloves: 'cloth', cloth_boots: 'cloth',
  ring: 'gem', amulet: 'gem',
};
export const MATERIAL_OF_TYPE = { metal: 'metal_scrap', leather: 'leather_scrap', cloth: 'cloth_scrap', gem: 'gem_fragment' };
export const CRAFT_BUILDING_OF_TYPE = { metal: 'blacksmith', leather: 'leatherworker', cloth: 'tailor', gem: 'jeweler' };

// Construction time (seconds) to reach level N (index = target level)
export const BUILD_TIME = [0, 30, 240, 900, 2700, 7200];

// kind: 'core' | 'craft' | 'gather' | 'special'
// cost: gold base and material bases; actual cost for level L = base * L^exp (see shared/town.js)
export const BUILDINGS = {
  town_hall: {
    name: 'Town Hall', kind: 'core', maxLevel: 5, start: 1, timeMult: 1.5,
    description: 'The heart of your town. Its level is the maximum level of every other building, and it allows more simultaneous constructions.',
    cost: { gold: 400, metal_scrap: 10, leather_scrap: 6, cloth_scrap: 6, ore: 0, gem_fragment: 0 },
    costFrom: { ore: [2, 10], gem_fragment: [3, 4] }, // [from level, base qty]
    effects: L => [`Other buildings up to level ${L}`, `${concurrentBuilds(L)} construction${concurrentBuilds(L) > 1 ? 's' : ''} at a time`],
  },
  inn: {
    name: 'Inn', kind: 'core', maxLevel: 5, start: 1,
    description: 'Houses your companions. More rooms mean a bigger roster and more recruits to choose from.',
    cost: { gold: 250, leather_scrap: 8, cloth_scrap: 8, metal_scrap: 4 },
    effects: L => [`Roster: ${INN_ROSTER[L]} companions`, `${INN_OFFERS[L]} recruits offered`, L >= 3 ? 'Recruits arrive with higher profession skill' : 'Higher levels attract skilled professionals'],
  },
  salvage_yard: {
    name: 'Salvage Yard', kind: 'core', maxLevel: 5, start: 1,
    description: 'Break down unwanted equipment into crafting materials. Uncommon and better items also yield arcane materials.',
    cost: { gold: 150, metal_scrap: 6, leather_scrap: 4 },
    effects: L => [`+${Math.round(SALVAGE_BONUS[L] * 100)}% salvage yield`, 'Enchanter worker: +25% arcane materials'],
  },
  expedition_camp: {
    name: 'Expedition Camp', kind: 'core', maxLevel: 5, start: 1,
    description: 'Send recruits out to gather ore, herbs, gems and arcane materials. Recruits on an expedition cannot fight or work.',
    cost: { gold: 200, leather_scrap: 8, metal_scrap: 6 },
    effects: L => [`${[0, 1, 2, 3, 4, 5][L]} expedition${L > 1 ? 's' : ''} at a time`, `Up to ${[0, 1, 2, 2, 3, 3][L]} recruit${[0, 1, 2, 2, 3, 3][L] > 1 ? 's' : ''} per expedition`, 'Unlocks farther destinations'],
  },
  blacksmith: {
    name: 'Blacksmith', kind: 'craft', profession: 'blacksmithing', type: 'metal', maxLevel: 5, start: 0,
    description: 'Forge weapons, plate armor and shields, and reforge old metal gear to a higher item level.',
    cost: { gold: 250, metal_scrap: 15, ore: 8 },
    effects: craftEffects,
  },
  leatherworker: {
    name: 'Leatherworker', kind: 'craft', profession: 'leatherworking', type: 'leather', maxLevel: 5, start: 0,
    description: 'Craft leather armor, bows and quivers, and reforge leather gear.',
    cost: { gold: 250, leather_scrap: 15, metal_scrap: 5 },
    effects: craftEffects,
  },
  tailor: {
    name: 'Tailor', kind: 'craft', profession: 'tailoring', type: 'cloth', maxLevel: 5, start: 0,
    description: 'Sew cloth armor, staves, wands and tomes, and reforge cloth gear.',
    cost: { gold: 250, cloth_scrap: 15, leather_scrap: 5 },
    effects: craftEffects,
  },
  jeweler: {
    name: 'Jeweler', kind: 'craft', profession: 'jewelcrafting', type: 'gem', maxLevel: 5, start: 0,
    description: 'Cut rings and amulets, and reforge jewelry.',
    cost: { gold: 300, gem_fragment: 8, metal_scrap: 8 },
    effects: craftEffects,
  },
  enchanter: {
    name: "Enchanter's Study", kind: 'special', profession: 'enchanting', maxLevel: 5, start: 0,
    description: 'Imbue any item with a permanent bonus stat. A worker here also improves disenchanting at the Salvage Yard.',
    cost: { gold: 300, cloth_scrap: 10, arcane_dust: 10 },
    effects: L => [`Enchantment strength ${Math.round(enchantPower(L, 0) * 100)}%`, L >= 3 ? 'Can enchant with any stat' : `Stats: ${ENCHANT_STATS_BY_LEVEL(L).length} options`],
  },
  alchemy_lab: {
    name: 'Alchemy Lab', kind: 'special', profession: 'alchemy', maxLevel: 5, start: 0,
    description: 'Brew elixirs that empower your whole party for a while — online and offline.',
    cost: { gold: 250, cloth_scrap: 8, herb: 10 },
    effects: L => [`Elixirs: ${Object.values(ELIXIRS).filter(e => e.level <= L).map(e => e.name).join(', ') || '—'}`, `Duration +${Math.round((L - 1) * 10)}%`],
  },
};
export const BUILDING_IDS = Object.keys(BUILDINGS);

export const INN_ROSTER = [0, 3, 5, 7, 9, 12];
export const INN_OFFERS = [0, 3, 4, 4, 5, 6];
export const SALVAGE_BONUS = [0, 0, 0.1, 0.2, 0.35, 0.5];
export const CRAFT_LEVEL_CAP = [0, 12, 24, 36, 48, 60];
export const concurrentBuilds = L => [0, 1, 1, 2, 2, 3][L] || 1;

export const QUALITIES = {
  standard:   { label: 'Standard',   minRarity: 'uncommon',  building: 1, extra: null },
  fine:       { label: 'Fine',       minRarity: 'rare',      building: 2, extra: 'magic_essence' },
  superior:   { label: 'Superior',   minRarity: 'epic',      building: 3, extra: 'prismatic_shard' },
  masterwork: { label: 'Masterwork', minRarity: 'legendary', building: 4, extra: 'void_crystal' },
};

function craftEffects(L) {
  const q = Object.values(QUALITIES).filter(x => x.building <= L).pop();
  return [`Craft up to item level ${CRAFT_LEVEL_CAP[L]}`, `Best quality: ${q.label} (${q.minRarity}+)`, L >= 5 ? 'Greatly increased mythic chance' : 'Reforge old gear to a higher level'];
}

// ---- Enchanting
export const ENCHANT_STATS_BY_LEVEL = L => (L >= 3
  ? ['str', 'int', 'dex', 'vit', 'hp', 'defense', 'physPower', 'magPower', 'healPower', 'critChance', 'critDamage', 'attackSpeed']
  : L >= 2 ? ['str', 'int', 'dex', 'vit', 'hp', 'defense', 'physPower', 'magPower', 'healPower']
    : ['str', 'int', 'dex', 'vit', 'hp']);
export const enchantPower = (L, skill) => 0.5 + 0.1 * L + skill * 0.006;

// ---- Alchemy (timed party buffs). bonus keys: damagePct, damageTakenPct, xpPct, goldPct, allStatsPct
export const ELIXIRS = {
  might:     { name: 'Elixir of Might',     level: 1, glyph: '🗡', description: 'Party deals +10% damage.', bonus: { damagePct: 0.10 }, herbs: 6, dust: 2, gold: 60 },
  fortitude: { name: 'Elixir of Fortitude', level: 1, glyph: '🛡', description: 'Party takes 8% less damage.', bonus: { damageTakenPct: -0.08 }, herbs: 6, dust: 2, gold: 60 },
  wisdom:    { name: 'Elixir of Wisdom',    level: 2, glyph: '📖', description: '+15% experience from fights.', bonus: { xpPct: 0.15 }, herbs: 9, dust: 4, gold: 120 },
  fortune:   { name: 'Elixir of Fortune',   level: 3, glyph: '🪙', description: '+20% gold from fights.', bonus: { goldPct: 0.20 }, herbs: 9, dust: 4, gold: 120 },
  titans:    { name: "Titan's Draught",     level: 4, glyph: '⛰', description: 'Party gains +8% to all stats.', bonus: { allStatsPct: 0.08 }, herbs: 14, dust: 6, essence: 1, gold: 250 },
};
export const ELIXIR_BASE_MINUTES = 60;
export const ELIXIR_MAX_HOURS = 8;
