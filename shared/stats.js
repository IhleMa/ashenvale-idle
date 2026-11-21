// Single source of truth for character statistics — used by server (combat) and client (display).
import { CONFIG } from './config.js';
import { CLASSES, TRAITS, classTier } from './data/classes.js';
import { treeStats } from './skilltree.js';
import { setStatBonuses } from './data/legendaries.js';
import { gearItemStats } from './gems.js';
import { gearSyncFactor } from './levelsync.js';
import { ITEM_BASES } from './data/items.js';

export const ATTRIBUTES = {
  str: { label: 'Strength', short: 'STR' },
  int: { label: 'Intelligence', short: 'INT' },
  dex: { label: 'Dexterity', short: 'DEX' },
  vit: { label: 'Vitality', short: 'VIT' },
};
export const ATTR_IDS = Object.keys(ATTRIBUTES);

export function collectBonuses(ch) {
  const bonus = {};
  const add = obj => { for (const [k, v] of Object.entries(obj || {})) bonus[k] = (bonus[k] || 0) + v; };
  const cls = CLASSES[ch.classId];
  for (const t of cls.tiers) if (ch.level >= t.level && (!t.mainOnly || ch.isMain)) add(t.bonus);
  if (ch.trait && TRAITS[ch.trait]) add(TRAITS[ch.trait].bonus);
  if (ch.tree) add(treeStats(ch)); // skill tree: flat attributes (str/int/dex/vit) and % bonuses
  add(setStatBonuses(ch));          // item set bonuses
  return bonus;
}

// gear stats added straight onto the character's base values; every other gear stat is a bonus like the skill tree's
const GEAR_FLAT = new Set(['str', 'int', 'dex', 'vit', 'hp', 'defense', 'physPower', 'magPower', 'healPower', 'critChance', 'critDamage', 'attackSpeed']);
// affix stats that only matter in combat (they reach the combat unit as gear modifiers)
export const GEAR_COMBAT = ['physDamagePct', 'magDamagePct', 'shieldPct', 'lifeSteal', 'thornsPct', 'blockChance', 'hpRegen', 'healingReceivedPct',
  'cooldownPct', 'resourceRegenPct', 'buffDurationPct', 'threatPct', 'damageVsBossPct', 'executeDamagePct'];

// dyn: the state of combat gems (Tide, Last Stand, Momentum) — see shared/gems.js
export function equipmentStats(ch, dyn = null) {
  const out = {};
  for (const item of Object.values(ch.equipment || {})) {
    if (!item) continue;
    const f = ch.gearSync ? gearSyncFactor(ch.gearSync, item.level, ch.gearUp) : 1; // level sync (ascension) scales gear down
    for (const [k, v] of Object.entries(gearItemStats(item, dyn))) out[k] = (out[k] || 0) + v * f; // affixes with their socketed gems
    if (item.enchant) out[item.enchant.stat] = (out[item.enchant.stat] || 0) + item.enchant.value * f; // Enchanter's Study
  }
  return out;
}

export function computeStats(ch, dyn = null) {
  const cls = CLASSES[ch.classId];
  const bonus = collectBonuses(ch);
  const gear = equipmentStats(ch, dyn);
  // every gear stat besides the flat core stats works like the same skill-tree bonus (Damage %, Strength %, …)
  for (const [k, v] of Object.entries(gear)) if (!GEAR_FLAT.has(k)) bonus[k] = (bonus[k] || 0) + v;
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

  // Critical chance works like in Path of Exile: every hit (attacks and spells alike) has the weapon's base crit chance,
  // and all crit bonuses are "% increased" that multiply it: crit = base × (1 + increased). critInc is that sum
  // (attributes, gear, skill tree, …).
  const critInc = conv('critChance') + (gear.critChance || 0) + (bonus.critChance || 0);
  const weaponCrit = ITEM_BASES[ch.equipment?.weapon?.baseId]?.baseCrit ?? CONFIG.combat.unarmedCritBase ?? 0.05;
  const rawCrit = weaponCrit * (1 + critInc);
  // stats with a cap: the value before capping is kept so the interface can show how far over the cap you are
  // Attack speed works like in Path of Exile too: the weapon has a base speed (1 = normal), every bonus is
  // "% increased" and they add up; "more" bonuses (attackSpeedMore) each multiply. Casters use it as well — it sets the
  // pace of basic attacks and the global cooldown between abilities. Haste buffs and slows in a fight multiply on top.
  const speedInc = conv('attackSpeed') + (gear.attackSpeed || 0) + (bonus.attackSpeed || 0);
  const speedMore = 1 + (bonus.attackSpeedMore || 0);
  const weaponSpeed = ITEM_BASES[ch.equipment?.weapon?.baseId]?.baseSpeed ?? 1;
  const rawSpeed = weaponSpeed * (1 + speedInc) * speedMore;
  const s = {
    attributes,
    uncapped: { critChance: rawCrit, attackSpeed: rawSpeed },
    critInc, weaponCrit, speedInc, speedMore, weaponSpeed,
    maxHp: Math.round((40 + 8 * ch.level + conv('hp') + (gear.hp || 0)) * (1 + allPct + (bonus.hpPct || 0))),
    physPower: Math.round((conv('physPower') + (gear.physPower || 0)) * pctMul('physPower')),
    magPower: Math.round((conv('magPower') + (gear.magPower || 0)) * pctMul('magPower')),
    healPower: Math.round((conv('healPower') + (gear.healPower || 0)) * pctMul('healPower')),
    defense: Math.round((conv('defense') + (gear.defense || 0)) * pctMul('defense')),
    critChance: Math.min(CONFIG.combat.critCap, rawCrit),
    critDamage: 1.5 + (cls.critDamageBonus || 0) + (gear.critDamage || 0) + (bonus.critDamage || 0),
    attackSpeed: Math.min(CONFIG.combat.attackSpeedCap, rawSpeed),
    dodge: bonus.dodge || 0,
    resourceMax: cls.resource.max,
    xpBonus: (bonus.xpPct || 0) + (ch.isMain ? CONFIG.mainCharacter.xpBonus : 0),
    // combat modifiers from the skill tree
    damagePct: bonus.damagePct || 0,
    healingPct: bonus.healingPct || 0,
    damageTakenPct: (bonus.damageTakenPct || 0) - (bonus.damageReduction || 0),
    // minion bonuses (summoner skill tree)
    minionDamagePct: bonus.minionDamagePct || 0,
    minionHpPct: bonus.minionHpPct || 0,
    minionDurationPct: bonus.minionDurationPct || 0,
    minionMax: bonus.minionMax || 0,
    // damage-over-time bonuses (warlock skill tree)
    dotDamagePct: bonus.dotDamagePct || 0,
    dotDurationPct: bonus.dotDurationPct || 0,
    poisonSpread: bonus.poisonSpread || 0, // Plaguebringer (rogue keystone)
    // item affixes (see content/items/_settings.json → affixes)
    ...Object.fromEntries(GEAR_COMBAT.map(k => [k, bonus[k] || 0])),
    damageReduction: bonus.damageReduction || 0,
  };
  // Spellblade: the lower of physical/magic power gains part of the higher one, so split gear isn't wasted
  if (cls.powerBlend) {
    const hi = Math.max(s.physPower, s.magPower), add = Math.round(hi * cls.powerBlend);
    if (s.physPower < s.magPower) s.physPower += add; else s.magPower += add;
  }

  return s;
}

// A rough power rating used for UI comparisons.
export function powerRating(stats) {
  const g = k => stats[k] || 0;
  const heal = stats.healPower * 0.9 > Math.max(stats.physPower, stats.magPower);
  const school = heal ? g('healingPct') + g('shieldPct') * 0.5 : stats.magPower > stats.physPower ? g('magDamagePct') : g('physDamagePct');
  const mult = 1 + (heal ? 0 : g('damagePct')) + school + 0.5 * (g('dotDamagePct') + g('minionDamagePct')) + 0.25 * (g('damageVsBossPct') + g('executeDamagePct'))
    + g('cooldownPct') + 0.3 * g('resourceRegenPct') + 0.2 * g('buffDurationPct');
  const offense = Math.max(stats.physPower, stats.magPower, stats.healPower * 0.9) * (1 + stats.critChance * (stats.critDamage - 1)) * stats.attackSpeed * mult;
  const defense = stats.maxHp * (1 + stats.defense / 100) / Math.max(0.25, 1 + g('damageTakenPct')) * (1 + g('dodge') + g('blockChance') * 0.5)
    * (1 + 0.3 * g('healingReceivedPct') + 2 * g('lifeSteal')) + g('hpRegen') * 30;
  return Math.round(offense * 2 + defense * 0.25);
}
