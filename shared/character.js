// Character model helpers shared by client and server.
import { CONFIG, xpToNext } from './config.js';
import { CLASSES } from './data/classes.js';
import { ABILITIES, classAbilities } from './data/abilities.js';
import { SLOT_IDS } from './data/items.js';

export function abilitySlots(ch) {
  return CONFIG.baseAbilitySlots + (ch.isMain ? CONFIG.mainCharacter.extraAbilitySlots : 0);
}

export function attributePointsPerLevel(ch) {
  return CONFIG.attributePointsPerLevel + (ch.isMain ? CONFIG.mainCharacter.extraAttributePointsPerLevel : 0);
}

export function abilityPointsForLevel(ch, level) {
  let pts = CONFIG.abilityPointsPerLevel;
  if (ch.isMain && level % CONFIG.mainCharacter.bonusAbilityPointEvery === 0) pts += 1;
  return pts;
}

export function cloneRule(rule) {
  return JSON.parse(JSON.stringify(rule));
}

export function createCharacter({ id, name, classId, isMain = false, level = 1, portrait = null, trait = null }) {
  const cls = CLASSES[classId];
  if (!cls) throw new Error('Unknown class');
  const ch = {
    id, name, classId, isMain, level: 1, xp: 0, portrait, trait,
    role: cls.role,
    attributes: { str: 0, int: 0, dex: 0, vit: 0 },
    unspentAttributePoints: 0,
    abilityPoints: 1,
    abilities: {},   // abilityId -> rank
    loadout: [],     // ability ids in priority order
    rules: {},       // abilityId -> behaviour rule
    equipment: Object.fromEntries(SLOT_IDS.map(s => [s, null])),
  };
  // Starting abilities: all level-1 abilities unlocked at rank 1
  for (const a of classAbilities(classId)) {
    if (a.unlockLevel <= 1) unlockAbility(ch, a.id, true);
  }
  for (let l = 1; l < level; l++) levelUp(ch);
  ch.xp = 0;
  autoSpendAttributes(ch);
  autoLearnAbilities(ch);
  return ch;
}

export function unlockAbility(ch, abilityId, free = false) {
  const a = ABILITIES[abilityId];
  if (!a || a.classId !== ch.classId) throw new Error('Ability not available for this class');
  if (ch.abilities[abilityId]) throw new Error('Already unlocked');
  if (a.unlockLevel > ch.level) throw new Error(`Requires level ${a.unlockLevel}`);
  if (!free) {
    if (ch.abilityPoints < 1) throw new Error('Not enough ability points');
    ch.abilityPoints -= 1;
  }
  ch.abilities[abilityId] = 1;
  ch.rules[abilityId] = cloneRule(a.defaultRule);
  if (ch.loadout.length < abilitySlots(ch)) ch.loadout.push(abilityId);
}

export function upgradeCost(rank) { return rank; } // rank 1→2 costs 1, 2→3 costs 2 ...

export function upgradeAbility(ch, abilityId) {
  const rank = ch.abilities[abilityId];
  if (!rank) throw new Error('Ability not unlocked');
  if (rank >= CONFIG.maxAbilityRank) throw new Error('Already at max rank');
  const cost = upgradeCost(rank);
  if (ch.abilityPoints < cost) throw new Error('Not enough ability points');
  const minLevel = ABILITIES[abilityId].unlockLevel + rank * 4;
  if (ch.level < minLevel) throw new Error(`Requires level ${minLevel}`);
  ch.abilityPoints -= cost;
  ch.abilities[abilityId] = rank + 1;
}

export function levelUp(ch) {
  if (ch.level >= CONFIG.levelCap) return false;
  ch.level += 1;
  ch.unspentAttributePoints += attributePointsPerLevel(ch);
  ch.abilityPoints += abilityPointsForLevel(ch, ch.level);
  return true;
}

// Adds XP; returns number of levels gained.
export function addXp(ch, amount) {
  if (ch.level >= CONFIG.levelCap) { ch.xp = 0; return 0; }
  ch.xp += Math.floor(amount);
  let gained = 0;
  while (ch.level < CONFIG.levelCap && ch.xp >= xpToNext(ch.level)) {
    ch.xp -= xpToNext(ch.level);
    levelUp(ch);
    gained++;
  }
  if (ch.level >= CONFIG.levelCap) ch.xp = 0;
  return gained;
}

// Recruits auto-spend points along class growth to stay useful without micromanagement (optional toggle)
export function autoSpendAttributes(ch) {
  const g = CLASSES[ch.classId].growth;
  const total = Object.values(g).reduce((s, v) => s + v, 0);
  while (ch.unspentAttributePoints > 0) {
    // pick attribute with the largest deficit vs. growth proportion
    const spent = Object.values(ch.attributes).reduce((s, v) => s + v, 0) + 1;
    let best = 'str', bestScore = -Infinity;
    for (const [a, w] of Object.entries(g)) {
      const score = w / total - ch.attributes[a] / spent;
      if (score > bestScore) { bestScore = score; best = a; }
    }
    ch.attributes[best] += 1;
    ch.unspentAttributePoints -= 1;
  }
}

export function autoLearnAbilities(ch) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const a of classAbilities(ch.classId)) {
      if (!ch.abilities[a.id] && a.unlockLevel <= ch.level && ch.abilityPoints >= 1) {
        unlockAbility(ch, a.id); changed = true;
      }
    }
    for (const a of classAbilities(ch.classId)) {
      const r = ch.abilities[a.id];
      if (r && r < CONFIG.maxAbilityRank && ch.abilityPoints >= upgradeCost(r) && ch.level >= a.unlockLevel + r * 4) {
        upgradeAbility(ch, a.id); changed = true;
      }
    }
  }
}

export function respecCost(ch) { return 50 * ch.level; }

// True when the character can unlock or upgrade something right now (used for UI hints)
export function hasAbilityAction(ch) {
  for (const a of classAbilities(ch.classId)) {
    const r = ch.abilities[a.id];
    if (!r && a.unlockLevel <= ch.level && ch.abilityPoints >= 1) return true;
    if (r && r < CONFIG.maxAbilityRank && ch.abilityPoints >= upgradeCost(r) && ch.level >= a.unlockLevel + r * 4) return true;
  }
  return false;
}
