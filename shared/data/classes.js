// Class definitions. To add a class: add an entry here and give it abilities in abilities.js.
// scaling: how attributes convert into combat stats (see shared/stats.js).
export const CLASSES = {
  warrior: {
    name: 'Warrior',
    role: 'tank',
    color: '#c0533a',
    glyph: '⚔',
    description: 'Armored frontliner. High health and defense, taunts enemies and protects allies.',
    strengths: ['Very durable', 'Taunts & damage mitigation', 'Steady physical damage'],
    weaknesses: ['Low burst damage', 'Rage starts low'],
    resource: { id: 'rage', name: 'Rage', color: '#d9452b', max: 100, start: 20, regen: 1, onHit: 7, onDamaged: 4 },
    baseAttributes: { str: 12, int: 4, dex: 6, vit: 15 },
    growth:         { str: 2.3, int: 0.5, dex: 1.0, vit: 2.9 },
    scaling: {
      hp: { vit: 13 }, physPower: { str: 2.0, dex: 0.4 }, magPower: { int: 1.0 }, healPower: { int: 0.5, vit: 0.2 },
      defense: { str: 0.45, vit: 0.7 }, critChance: { dex: 0.0007 }, attackSpeed: { dex: 0.0012 },
    },
    basicAttack: { name: 'Strike', stat: 'physPower', power: 1.0, school: 'physical' },
    threatMult: 1.5,
    tiers: [
      { level: 1,  title: 'Squire' },
      { level: 10, title: 'Knight',  bonus: { vitPct: 0.05 } },
      { level: 25, title: 'Warlord', bonus: { strPct: 0.06, defensePct: 0.05 } },
      { level: 40, title: 'Bulwark of Ashenvale', mainOnly: true, bonus: { allPct: 0.06 } },
    ],
  },
  mage: {
    name: 'Mage',
    role: 'damage',
    color: '#4a7cff',
    glyph: '✦',
    description: 'Master of the elements. Devastating magical and area-of-effect damage, but fragile.',
    strengths: ['Huge area damage', 'Elemental debuffs', 'Crowd control'],
    weaknesses: ['Low health & defense', 'Mana hungry'],
    resource: { id: 'mana', name: 'Mana', color: '#3a7bff', max: 100, start: 100, regen: 4.5 },
    baseAttributes: { str: 4, int: 15, dex: 7, vit: 8 },
    growth:         { str: 0.4, int: 3.0, dex: 1.1, vit: 1.6 },
    scaling: {
      hp: { vit: 10 }, physPower: { str: 1.0, dex: 0.3 }, magPower: { int: 2.4 }, healPower: { int: 0.8 },
      defense: { str: 0.2, vit: 0.35 }, critChance: { dex: 0.0008, int: 0.0003 }, attackSpeed: { dex: 0.0012 },
    },
    basicAttack: { name: 'Arcane Bolt', stat: 'magPower', power: 0.85, school: 'magical' },
    threatMult: 1,
    tiers: [
      { level: 1,  title: 'Apprentice' },
      { level: 10, title: 'Magus',     bonus: { intPct: 0.05 } },
      { level: 25, title: 'Archmage',  bonus: { intPct: 0.06, critChance: 0.03 } },
      { level: 40, title: 'Ashen Sage', mainOnly: true, bonus: { allPct: 0.06 } },
    ],
  },
  rogue: {
    name: 'Rogue',
    role: 'damage',
    color: '#5bbf6a',
    glyph: '🗡',
    description: 'Lethal assassin. High single-target and critical damage, poisons, bleeds and executes.',
    strengths: ['Highest single-target damage', 'Critical strikes', 'Execute weakened foes'],
    weaknesses: ['Weak against groups', 'Moderate durability'],
    resource: { id: 'energy', name: 'Energy', color: '#f2d33a', max: 100, start: 100, regen: 9 },
    baseAttributes: { str: 7, int: 4, dex: 15, vit: 9 },
    growth:         { str: 1.0, int: 0.4, dex: 3.0, vit: 1.7 },
    scaling: {
      hp: { vit: 11 }, physPower: { dex: 2.0, str: 0.6 }, magPower: { int: 1.0 }, healPower: { int: 0.4 },
      defense: { str: 0.25, vit: 0.4, dex: 0.15 }, critChance: { dex: 0.0016 }, attackSpeed: { dex: 0.0022 },
    },
    basicAttack: { name: 'Slash', stat: 'physPower', power: 0.9, school: 'physical' },
    critDamageBonus: 0.25,
    threatMult: 1,
    tiers: [
      { level: 1,  title: 'Cutpurse' },
      { level: 10, title: 'Assassin',  bonus: { dexPct: 0.05 } },
      { level: 25, title: 'Shadowblade', bonus: { critChance: 0.04, critDamage: 0.15 } },
      { level: 40, title: 'Ashen Phantom', mainOnly: true, bonus: { allPct: 0.06 } },
    ],
  },
  cleric: {
    name: 'Cleric',
    role: 'healer',
    color: '#f0d27a',
    glyph: '✚',
    description: 'Holy healer. Heals single allies or the whole party, shields, buffs and cleanses.',
    strengths: ['Powerful healing', 'Shields & buffs', 'Removes debuffs'],
    weaknesses: ['Low damage', 'Mana management'],
    resource: { id: 'mana', name: 'Mana', color: '#3a7bff', max: 100, start: 100, regen: 5 },
    baseAttributes: { str: 6, int: 13, dex: 5, vit: 11 },
    growth:         { str: 0.7, int: 2.5, dex: 0.7, vit: 2.2 },
    scaling: {
      hp: { vit: 11 }, physPower: { str: 1.2 }, magPower: { int: 1.6 }, healPower: { int: 2.3, vit: 0.3 },
      defense: { str: 0.35, vit: 0.55 }, critChance: { dex: 0.0007, int: 0.0002 }, attackSpeed: { dex: 0.0010 },
    },
    basicAttack: { name: 'Mace Strike', stat: 'magPower', power: 0.7, school: 'magical' },
    threatMult: 1,
    tiers: [
      { level: 1,  title: 'Acolyte' },
      { level: 10, title: 'Priest',   bonus: { healPowerPct: 0.06 } },
      { level: 25, title: 'High Priest', bonus: { intPct: 0.05, vitPct: 0.05 } },
      { level: 40, title: 'Saint of Ashenvale', mainOnly: true, bonus: { allPct: 0.06 } },
    ],
  },
  ranger: {
    name: 'Ranger',
    role: 'damage',
    color: '#9ad14a',
    glyph: '➶',
    description: 'Ranged marksman. Sustained physical damage, multi-target shots and damage over time.',
    strengths: ['Consistent sustained damage', 'Hits multiple enemies', 'Damage over time'],
    weaknesses: ['Lower burst than Rogue', 'Modest defenses'],
    resource: { id: 'focus', name: 'Focus', color: '#f08a3a', max: 100, start: 60, regen: 6 },
    baseAttributes: { str: 6, int: 5, dex: 14, vit: 10 },
    growth:         { str: 0.8, int: 0.5, dex: 2.8, vit: 1.9 },
    scaling: {
      hp: { vit: 11 }, physPower: { dex: 2.1, str: 0.4 }, magPower: { int: 1.0 }, healPower: { int: 0.5 },
      defense: { str: 0.25, vit: 0.45 }, critChance: { dex: 0.0011 }, attackSpeed: { dex: 0.0026 },
    },
    basicAttack: { name: 'Shoot', stat: 'physPower', power: 1.0, school: 'physical' },
    threatMult: 1,
    tiers: [
      { level: 1,  title: 'Scout' },
      { level: 10, title: 'Pathfinder', bonus: { dexPct: 0.05 } },
      { level: 25, title: 'Sharpshooter', bonus: { attackSpeed: 0.08, critChance: 0.02 } },
      { level: 40, title: 'Warden of Ashenvale', mainOnly: true, bonus: { allPct: 0.06 } },
    ],
  },
};

export const CLASS_IDS = Object.keys(CLASSES);

// Traits give recruits personality. Each recruit rolls one.
export const TRAITS = {
  stalwart: { name: 'Stalwart', description: '+6% Vitality', bonus: { vitPct: 0.06 } },
  brute:    { name: 'Brute',    description: '+6% Strength', bonus: { strPct: 0.06 } },
  nimble:   { name: 'Nimble',   description: '+6% Dexterity', bonus: { dexPct: 0.06 } },
  scholar:  { name: 'Scholar',  description: '+6% Intelligence', bonus: { intPct: 0.06 } },
  keen:     { name: 'Keen Eye', description: '+3% Critical Chance', bonus: { critChance: 0.03 } },
  swift:    { name: 'Swift',    description: '+6% Attack Speed', bonus: { attackSpeed: 0.06 } },
  devout:   { name: 'Devout',   description: '+8% Healing Power', bonus: { healPowerPct: 0.08 } },
  ironhide: { name: 'Ironhide', description: '+10% Defense', bonus: { defensePct: 0.10 } },
  quick_learner: { name: 'Quick Learner', description: '+10% experience gained', bonus: { xpPct: 0.10 } },
};

export function classTier(classId, level, isMain) {
  const tiers = CLASSES[classId]?.tiers || [];
  let current = tiers[0];
  for (const t of tiers) if (level >= t.level && (!t.mainOnly || isMain)) current = t;
  return current;
}
