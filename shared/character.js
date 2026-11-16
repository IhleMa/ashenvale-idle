// Character model helpers shared by client and server.
// Abilities and bonus attributes come from the passive skill tree (shared/skilltree.js).
import { CONFIG, xpToNext } from './config.js';
import { CLASSES } from './data/classes.js';
import { ABILITIES } from './data/abilities.js';
import { SLOT_IDS } from './data/items.js';
import { treeAbilities, availablePoints, autoAllocate, sanitizeTree, getTree } from './skilltree.js';

export function abilitySlots(ch) {
  return CONFIG.baseAbilitySlots + (ch.isMain ? CONFIG.mainCharacter.extraAbilitySlots : 0);
}

export function cloneRule(rule) {
  return JSON.parse(JSON.stringify(rule));
}

export function createCharacter({ id, name, classId, isMain = false, level = 1, portrait = null, trait = null, autoTree = true }) {
  const cls = CLASSES[classId];
  if (!cls) throw new Error('Unknown class');
  const ch = {
    id, name, classId, isMain, level: Math.max(1, Math.min(CONFIG.levelCap, level)), xp: 0, portrait, trait,
    role: cls.role,
    tree: { allocated: ['start'] },
    abilities: {},   // abilityId -> rank (derived from the tree, cached for combat & UI)
    loadout: [],     // ability ids in priority order
    rules: {},       // abilityId -> behaviour rule
    equipment: Object.fromEntries(SLOT_IDS.map(s => [s, null])),
  };
  if (autoTree) autoAllocate(ch);
  syncTree(ch);
  return ch;
}

// Recomputes abilities from the tree; keeps loadout & rules consistent. Call after every tree change.
export function syncTree(ch) {
  sanitizeTree(ch);
  const before = ch.abilities || {};
  ch.abilities = treeAbilities(ch);
  ch.rules = ch.rules || {};
  ch.loadout = (ch.loadout || []).filter(a => ch.abilities[a]);
  for (const a of Object.keys(ch.abilities)) {
    if (!ch.rules[a]) ch.rules[a] = cloneRule(ABILITIES[a].defaultRule);
    if (!before[a] && !ch.loadout.includes(a) && ch.loadout.length < abilitySlots(ch)) ch.loadout.push(a);
  }
  for (const a of Object.keys(ch.rules)) if (!ch.abilities[a]) delete ch.rules[a];
}

export function levelUp(ch) {
  if (ch.level >= CONFIG.levelCap) return false;
  ch.level += 1;
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

// Spend all free skill points automatically (used for companions with auto-develop on)
export function autoDevelop(ch) {
  autoAllocate(ch);
  syncTree(ch);
}

// True when the character has unspent skill points (UI hint)
export function hasAbilityAction(ch) {
  return availablePoints(ch) > 0;
}

export function treeRefundCost(ch) { return CONFIG.treeNodeRefundCostPerLevel * ch.level; }
export function treeResetCost(ch) { return CONFIG.treeResetCostPerLevel * ch.level; }

// Where in the tree an ability can be found (for UI)
export function abilityNodeId(classId, abilityId) {
  const t = getTree(classId);
  return Object.values(t.nodes).find(n => n.ability === abilityId)?.id || null;
}
