// Single source of truth for character statistics — used by server (combat) and client (display).
import { CONFIG } from './config.js';
import { CLASSES, TRAITS, classTier } from './data/classes.js';
import { treeStats } from './skilltree.js';
import { setStatBonuses } from './data/legendaries.js';
import { socketStats } from './gems.js';
import { gearSyncFactor } from './levelsync.js';

export const ATTRIBUTES = {
  str: { label: 'Strength', short: 'STR' },
  int: { label: 'Intelligence', short: 'INT' },
  dex: { label: 'Dexterity', short: 'DEX' },
  vit: { label: 'Vitality', short: 'VIT' },
};
export const ATTR_IDS = Object.keys(ATTRIBUTES);

function collectBonuses(ch) {
  const bonus = {};
  const add = obj => { for (const [k, v] of Object.entries(obj || {})) bonus[k] = (bonus[k] || 0) + v; };
  const cls = CLASSES[ch.classId];
  for (const t of cls.tiers) if (ch.level >= t.level && (!t.mainOnly || ch.isMain)) add(t.bonus);
  if (ch.trait && TRAITS[ch.trait]) add(TRAITS[ch.trait].bonus);
  if (ch.tree) add(treeStats(ch)); // skill tree: flat attributes (str/int/dex/vit) and % bonuses
  add(setStatBonuses(ch));          // item set bonuses
  return bonus;
}

export function equipmentStats(ch) {
  const out = {};
  for (const item of Object.values(ch.equipment || {})) {
    if (!item) continue;
    const f = ch.gearSync ? gearSyncFactor(ch.gearSync, item.level) : 1; // level sync (ascension) scales gear down
    for (const [k, v] of Object.entries(item.stats)) out[k] = (out[k] || 0) + v * f;
    if (item.enchant) out[item.enchant.stat] = (out[item.enchant.stat] || 0) + item.enchant.value * f; // Enchanter's Study
    if (item.sockets) for (const [k, v] of Object.entries(socketStats(item))) out[k] = (out[k] || 0) + v * f; // socketed gems
  }
  return out;
}

export function computeStats(ch) {
  const cls = CLASSES[ch.classId];
  const bonus = collectBonuses(ch);
  const gear = equipmentStats(ch);
  const mainMult = ch.isMain ? 1 + CONFIG.mainCharacter.attributeBonus : 1;
  const allPct = bonus.allPct || 0;

  const attributes = {};
  for (const a of ATTR_IDS) {
    const natural = (cls.baseAttributes[a] + cls.growth[a] * (ch.level - 1)) * mainMult;
    const raw = natural + (bonus[a] || 0) + (gear[a] || 0);
    attributes[a] = Math.round(raw * (1 + (bonus[a + 'Pct'] || 0) + allPct));
  }
  const conv = key => {
    const sc = cls.scaling[key] || {};
    let v = 0;
    for (const [a, coef] of Object.entries(sc)) v += attributes[a] * coef;
    return v;
  };
  const pctMul = key => 1 + (bonus[key + 'Pct'] || 0);

  const s = {
    attributes,
    maxHp: Math.round((40 + 8 * ch.level + conv('hp') + (gear.hp || 0)) * (1 + allPct + (bonus.hpPct || 0))),
    physPower: Math.round((conv('physPower') + (gear.physPower || 0)) * pctMul('physPower')),
    magPower: Math.round((conv('magPower') + (gear.magPower || 0)) * pctMul('magPower')),
    healPower: Math.round((conv('healPower') + (gear.healPower || 0)) * pctMul('healPower')),
    defense: Math.round((conv('defense') + (gear.defense || 0)) * pctMul('defense')),
    critChance: Math.min(CONFIG.combat.critCap, 0.05 + conv('critChance') + (gear.critChance || 0) + (bonus.critChance || 0)),
    critDamage: 1.5 + (cls.critDamageBonus || 0) + (gear.critDamage || 0) + (bonus.critDamage || 0),
    attackSpeed: Math.min(CONFIG.combat.attackSpeedCap, 1 + conv('attackSpeed') + (gear.attackSpeed || 0) + (bonus.attackSpeed || 0)),
    dodge: 0,
    resourceMax: cls.resource.max,
    xpBonus: (bonus.xpPct || 0) + (ch.isMain ? CONFIG.mainCharacter.xpBonus : 0),
    // combat modifiers from the skill tree
    damagePct: bonus.damagePct || 0,
    healingPct: bonus.healingPct || 0,
    damageTakenPct: bonus.damageTakenPct || 0,
    // minion bonuses (summoner skill tree)
    minionDamagePct: bonus.minionDamagePct || 0,
    minionHpPct: bonus.minionHpPct || 0,
    minionDurationPct: bonus.minionDurationPct || 0,
    minionMax: bonus.minionMax || 0,
  };
  return s;
}

// A rough power rating used for UI comparisons.
export function powerRating(stats) {
  const offense = Math.max(stats.physPower, stats.magPower, stats.healPower * 0.9) * (1 + stats.critChance * (stats.critDamage - 1)) * stats.attackSpeed;
  const defense = stats.maxHp * (1 + stats.defense / 100);
  return Math.round(offense * 2 + defense * 0.25);
}
