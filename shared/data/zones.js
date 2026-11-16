// Zones (solo idle areas) and co-op encounters.
// Images: assets/zones/<zoneId>.png (used as combat background), assets/encounters/<encounterId>.png
export const ZONES = {
  whispering_woods: {
    name: 'Whispering Woods', levelRange: [1, 7], order: 1,
    description: 'Ancient forest on the edge of Ashenvale, home to wolves and goblin raiders.',
    enemies: ['wolf', 'goblin', 'forest_spider', 'goblin_shaman'], boss: 'goblin_chieftain', unlock: null,
    scale: { hp: 0.45, damage: 0.6 }, // starter zone is gentler
    bossScale: { hp: 0.75, damage: 0.75 },
  },
  ashen_barrows: {
    name: 'Ashen Barrows', levelRange: [6, 14], order: 2,
    description: 'Burial mounds where the dead refuse to rest.',
    enemies: ['skeleton_warrior', 'bone_archer', 'ghoul', 'barrow_wight'], boss: 'barrow_king', unlock: 'whispering_woods',
  },
  emberfall_caverns: {
    name: 'Emberfall Caverns', levelRange: [13, 23], order: 3,
    description: 'Volcanic tunnels swarming with imps, golems and fanatics.',
    enemies: ['fire_imp', 'magma_golem', 'ash_cultist'], boss: 'cinder_wyrm', unlock: 'ashen_barrows',
  },
  frostpeak: {
    name: 'Frostpeak', levelRange: [22, 34], order: 4,
    description: 'Frozen mountain passes ruled by trolls and the Frost Matriarch.',
    enemies: ['ice_wraith', 'frost_troll', 'yeti'], boss: 'frost_matriarch', unlock: 'emberfall_caverns',
  },
  voidscar: {
    name: 'The Voidscar', levelRange: [33, 60], order: 5,
    description: 'A wound in the world where reality frays.',
    enemies: ['void_stalker', 'abyssal_priest', 'void_horror'], boss: 'hollow_sovereign', unlock: 'frostpeak',
  },
};
for (const [id, z] of Object.entries(ZONES)) z.id = id;

// Boss challenge composition: the boss plus a couple of zone minions
export function bossWave(zone) {
  return [zone.boss, zone.enemies[0]].filter(Boolean);
}

// Co-op encounters. waves: arrays of enemy ids fought in sequence (HP carries over between waves).
export const COOP_ENCOUNTERS = {
  ashen_crypt: {
    name: 'Ashenvale Crypt', type: 'dungeon', minLevel: 6, rewardMult: 1.5,
    description: 'A group dungeon: three waves of undead, then Malgrath, Lord of the Crypt.',
    waves: [['skeleton_warrior', 'bone_archer', 'ghoul'], ['barrow_wight', 'skeleton_warrior', 'skeleton_warrior'], ['crypt_lord', 'bone_archer']],
  },
  dreadmaw_hunt: {
    name: 'Hunt: Dreadmaw', type: 'elite', minLevel: 10, rewardMult: 1.4,
    description: 'An elite beast that tears through unprepared parties.',
    waves: [['dreadmaw', 'wolf', 'wolf']],
  },
  void_incursion: {
    name: 'Void Incursion', type: 'challenge', minLevel: 25, rewardMult: 1.8,
    description: 'Multiplayer challenge: survive four escalating waves from the Voidscar.',
    waves: [['void_stalker', 'void_stalker', 'abyssal_priest'], ['void_horror', 'abyssal_priest'], ['void_horror', 'void_stalker', 'void_stalker'], ['hollow_sovereign']],
  },
  ashen_colossus: {
    name: 'World Boss: The Ashen Colossus', type: 'world_boss', minLevel: 15, rewardMult: 2.5,
    description: 'A titanic world boss. Bring friends — it scales with the group.',
    waves: [['ashen_colossus']],
  },
};
for (const [id, e] of Object.entries(COOP_ENCOUNTERS)) e.id = id;
