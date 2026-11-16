// Central game balance settings. Tweak numbers here — both server and client read this file.
export const CONFIG = {
  version: '0.1.0',

  levelCap: 60,
  xp: {
    // XP needed to go from level L to L+1 = base * L^exponent
    base: 80,
    exponent: 1.85,
  },

  party: {
    size: 4,              // max characters in a solo party (main character included)
    presets: 3,           // number of saved party configurations
    rosterLimit: 12,      // max recruited characters (main excluded)
  },

  mainCharacter: {
    attributeBonus: 0.08, // +8% to all base attributes
    extraAbilitySlots: 1, // main has one more ability slot than recruits
    extraAttributePointsPerLevel: 1,
    bonusAbilityPointEvery: 5, // +1 ability point every N levels
    xpBonus: 0.10,
    leadershipAura: { unlockLevel: 10, damagePct: 0.04 }, // party-wide damage aura
  },

  attributePointsPerLevel: 2,
  abilityPointsPerLevel: 1,
  baseAbilitySlots: 4,
  maxAbilityRank: 5,
  abilityRankBonus: 0.15, // +15% effect per rank above 1

  roles: {
    tank:    { label: 'Tank',          threatMult: 3.0, damageTakenPct: -0.05 },
    healer:  { label: 'Healer',        healingPct: 0.10 },
    damage:  { label: 'Damage Dealer', damagePct: 0.06 },
    support: { label: 'Support',       buffDurationPct: 0.25, damagePct: 0.02, healingPct: 0.04 },
  },

  synergy: {
    balancedBonusPct: 0.10,        // tank + healer + damage present
    perDistinctClassPct: 0.02,     // per distinct class beyond the first
  },

  combat: {
    tickMs: 100,
    globalCooldown: 1.2,           // seconds between ability uses (reduced by attack speed)
    baseAttackInterval: 2.0,       // seconds between basic attacks at 100% attack speed
    critCap: 0.75,
    attackSpeedCap: 2.5,
    armorK: 60,                    // damage reduction = def / (def + armorK + 12*attackerLevel)
    armorCap: 0.75,
    magicArmorFactor: 0.5,         // magic damage uses half of defense
    statusTickInterval: 1.0,
    restBetweenFights: 2.0,        // seconds of pause in idle loop
    reviveDelay: 8.0,              // seconds after a wipe before idle combat resumes
    maxBattleSeconds: 300,         // safety limit
    positionThreat: [40, 25, 10, 5, 3, 2, 1, 0], // initial threat by party position (front = higher)
  },

  idle: {
    enemiesPerFight: [1, 3],
  },

  offline: {
    maxHours: 8,
    minSeconds: 60,
    maxSimulatedFights: 250,       // beyond this, rewards are extrapolated from the simulated average
    efficiency: 1.0,
  },

  recruitment: {
    offers: 4,
    refreshSeconds: 600,
    refreshCostPerLevel: 15,
    costBase: 100,
    costPerLevel: 40,
  },

  inventory: {
    limit: 80,
  },

  coop: {
    maxPlayers: 4,
    charactersPerPlayer: 2,        // main + N-1 recruits per player in group encounters
    hpScalePerExtraPlayer: 0.75,
    damageScalePerExtraPlayer: 0.12,
    inviteTimeoutSeconds: 300,
  },

  rarities: [
    { id: 'common',    label: 'Common',    color: '#b8b8b8', mult: 1.00, affixes: 0, weight: 600 },
    { id: 'uncommon',  label: 'Uncommon',  color: '#4fd16b', mult: 1.12, affixes: 1, weight: 260 },
    { id: 'rare',      label: 'Rare',      color: '#4a8cff', mult: 1.25, affixes: 2, weight: 100 },
    { id: 'epic',      label: 'Epic',      color: '#b25cff', mult: 1.42, affixes: 3, weight: 30 },
    { id: 'legendary', label: 'Legendary', color: '#ff9a2e', mult: 1.62, affixes: 4, weight: 8 },
    { id: 'mythic',    label: 'Mythic',    color: '#ff4d6d', mult: 1.85, affixes: 5, weight: 1.5 },
  ],
};

export function xpToNext(level) {
  return Math.floor(CONFIG.xp.base * Math.pow(level, CONFIG.xp.exponent));
}

export function rarityById(id) {
  return CONFIG.rarities.find(r => r.id === id) || CONFIG.rarities[0];
}

export function rarityIndex(id) {
  return Math.max(0, CONFIG.rarities.findIndex(r => r.id === id));
}
