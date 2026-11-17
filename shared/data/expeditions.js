// Expedition destinations. Recruits sent here are away (no fighting, no town work) until they return.
// yields: materials per hour for a single recruit (more recruits = more, see shared/expeditions.js)
// rare:   { material: chance per hour } — extra lucky finds
// bonus:  profession that improves results; campLevel: Expedition Camp level required
// Images: assets/expeditions/<id>.png
export const EXPEDITIONS = {
  copper_hills: {
    name: 'Copper Hills', campLevel: 1, level: 1, bonus: 'mining',
    description: 'Rolling hills riddled with shallow ore veins. A safe first trip for any recruit.',
    yields: { ore: 9, gem_fragment: 1.5 }, rare: { magic_essence: 0.05 },
  },
  whispering_glade: {
    name: 'Whispering Glade', campLevel: 1, level: 1, bonus: 'herbalism',
    description: 'A quiet glade deep in the Whispering Woods, thick with medicinal plants.',
    yields: { herb: 10, leather_scrap: 1 }, rare: { arcane_dust: 0.4 },
  },
  old_battlefield: {
    name: 'Old Battlefield', campLevel: 1, level: 5, bonus: null,
    description: 'Scavenge abandoned arms and armor. Any profession can pick through the wreckage.',
    yields: { metal_scrap: 5, leather_scrap: 4, cloth_scrap: 4 }, rare: { arcane_dust: 0.6 },
  },
  crystal_caverns: {
    name: 'Crystal Caverns', campLevel: 2, level: 12, bonus: 'jewelcrafting',
    description: 'Glittering caves where gems grow from the walls — a jeweler knows where to look.',
    yields: { gem_fragment: 6, ore: 5 }, rare: { magic_essence: 0.2, prismatic_shard: 0.03 },
  },
  ley_line_nexus: {
    name: 'Ley Line Nexus', campLevel: 3, level: 20, bonus: 'enchanting',
    description: 'Where ley lines cross, raw magic crystallizes. Enchanters harvest it best.',
    yields: { arcane_dust: 6, magic_essence: 1.2 }, rare: { prismatic_shard: 0.15 },
  },
  emberfall_depths: {
    name: 'Emberfall Depths', campLevel: 4, level: 28, bonus: 'mining',
    description: 'Rich, dangerous volcanic seams. Strong recruits come back with much more.',
    yields: { ore: 14, gem_fragment: 4, metal_scrap: 3 }, rare: { prismatic_shard: 0.15, void_crystal: 0.02 },
  },
  voidscar_rift: {
    name: 'Voidscar Rift', campLevel: 5, level: 38, bonus: 'alchemy',
    description: 'A tear in the world leaking strange reagents. Only veterans should go.',
    yields: { herb: 8, arcane_dust: 8, magic_essence: 2 }, rare: { prismatic_shard: 0.3, void_crystal: 0.06 },
  },
};
for (const [id, e] of Object.entries(EXPEDITIONS)) e.id = id;

export const EXPEDITION_DURATIONS = [
  { hours: 0.25, label: '15 min' },
  { hours: 1, label: '1 hour' },
  { hours: 4, label: '4 hours' },
  { hours: 8, label: '8 hours' },
];
export const CAMP_SLOTS = [0, 1, 2, 3, 4, 5];     // simultaneous expeditions by Expedition Camp level
export const CAMP_MEMBERS = [0, 1, 2, 2, 3, 3];   // recruits per expedition by camp level
