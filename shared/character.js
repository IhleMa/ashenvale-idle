// Character model helpers shared by client and server.
// Abilities and bonus attributes come from the passive skill tree (shared/skilltree.js).
import { CONFIG, xpToNext } from './config.js';
import { CLASSES } from './data/classes.js';
import { ABILITIES, abilityPriority } from './data/abilities.js';
import { SLOT_IDS } from './data/items.js';
import { treeAbilities, availablePoints, autoAllocate, sanitizeTree, getTree, treeMutators } from './skilltree.js';
import { TREE_SPECS } from './data/skilltree.js';

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
    loadoutV2: true,
    levelAt: Date.now(), // when the current level was reached (balance statistics)
  };
  if (autoTree) autoAllocate(ch);
  syncTree(ch);
  if (autoTree) ch.loadout = autoLoadout(ch);
  return ch;
}

// Inserts an ability into the loadout at its default priority (before the first lower-priority ability)
function insertByPriority(loadout, a) {
  const i = loadout.findIndex(x => abilityPriority(x) < abilityPriority(a));
  if (i < 0) loadout.push(a); else loadout.splice(i, 0, a);
}

// Recomputes abilities from the tree; keeps loadout & rules consistent. Call after every tree change.
// Returns the newly learned abilities that could not be equipped because the loadout is full.
// manageLoadout: when the loadout is full, swap the lowest-priority ability out for a more important new one
// (used for auto-developed companions).
export function syncTree(ch, { manageLoadout = false } = {}) {
  sanitizeTree(ch);
  const before = ch.abilities || {};
  ch.abilities = treeAbilities(ch);
  ch.rules = ch.rules || {};
  ch.loadout = (ch.loadout || []).filter(a => ch.abilities[a]);
  const notEquipped = [];
  const learned = Object.keys(ch.abilities).filter(a => !before[a]).sort((x, y) => abilityPriority(y) - abilityPriority(x));
  for (const a of Object.keys(ch.abilities)) if (!ch.rules[a]) ch.rules[a] = cloneRule(ABILITIES[a].defaultRule);
  for (const a of learned) {
    if (ch.loadout.includes(a)) continue;
    if (ch.loadout.length < abilitySlots(ch)) { insertByPriority(ch.loadout, a); continue; }
    if (manageLoadout) {
      const core = TREE_SPECS[ch.classId]?.start; // the class's bread-and-butter ability always stays
      const candidates = ch.loadout.filter(x => x !== core);
      const weakest = candidates.reduce((w, x) => (abilityPriority(x) < abilityPriority(w) ? x : w), candidates[0]);
      if (weakest && abilityPriority(weakest) < abilityPriority(a)) {
        ch.loadout = ch.loadout.filter(x => x !== weakest);
        insertByPriority(ch.loadout, a);
        notEquipped.push(weakest);
        continue;
      }
    }
    notEquipped.push(a);
  }
  for (const a of Object.keys(ch.rules)) if (!ch.abilities[a]) delete ch.rules[a];
  return notEquipped;
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
  return syncTree(ch, { manageLoadout: true });
}

// True when the character has unspent skill points (UI hint)
export function hasAbilityAction(ch) {
  return availablePoints(ch) > 0;
}

export function treeRefundCost(ch) { return CONFIG.treeNodeRefundCostPerLevel * ch.level; }
export function treeResetCost(ch) { return CONFIG.treeResetCostPerLevel * ch.level; }

// Where in the tree an ability can be found (for UI)
export function abilityNodeId(classId, abilityId, subclassId = null) {
  const t = getTree(classId, subclassId);
  return Object.values(t.nodes).find(n => n.ability === abilityId)?.id || null;
}

// Best loadout for an automatically managed character: core ability + highest-priority others, ordered by priority
export function autoLoadout(ch) {
  const core = TREE_SPECS[ch.classId]?.start;
  const muts = treeMutators(ch); // abilities changed by subclass mutators are worth a slot
  const pickScore = a => abilityPriority(a) + (muts[a] ? 1000 * muts[a].length : 0);
  const others = Object.keys(ch.abilities).filter(a => a !== core).sort((a, b) => pickScore(b) - pickScore(a));
  const pick = [...(ch.abilities[core] ? [core] : []), ...others].slice(0, abilitySlots(ch));
  return pick.sort((a, b) => abilityPriority(b) - abilityPriority(a));
}
