// Level sync: while an ascended hero levels up again, every character in the hero's party fights at the hero's
// level + config.ascension.levelSync.levelGap, so level-60 recruits can't carry the hero through the endgame.
// A synced character uses the stats of the lower level, only the skill-tree points it would have at that level
// (the earliest allocated nodes are kept), and its gear is scaled down to that level.
import { CONFIG } from './config.js';
import { sanitizeTree, treeAbilities, autoAllocate } from './skilltree.js';

const SYNC = () => CONFIG.ascension?.levelSync || {};

// The level a party is synced to, or null when no sync applies.
export function partySyncLevel(characters) {
  const s = SYNC();
  if (!CONFIG.ascension?.enabled || !s.enabled) return null;
  const h = characters.find(c => c?.isMain);
  if (!h?.subclass || h.level >= CONFIG.levelCap) return null;
  return Math.min(CONFIG.levelCap, h.level + (s.levelGap ?? 3));
}

// How much of an item's stats count when its wearer is synced down to `level`.
// Item stats grow roughly like (gearCurve + level), so a level-60 item worn at level 8 keeps (4+8)/(4+60) ≈ 19 %.
// With `up` (Arena), gear below the level is scaled up the same way.
export function gearSyncFactor(level, itemLevel, up = false) {
  if (!level || !itemLevel || itemLevel === level || (itemLevel < level && !up)) return 1;
  const k = SYNC().gearCurve ?? 4;
  return (k + level) / (k + itemLevel);
}

// A synced copy of a character (the original is not changed). Characters at or below the level come back as-is,
// unless `up` (Arena): then they are raised to the level — stats of that level, gear scaled up, and the skill points
// they don't have yet are spent automatically for this fight only (like recruits' auto-allocation).
export function syncedCharacter(ch, level, { up = false } = {}) {
  if (!level || ch.level === level) return ch;
  if (ch.level < level) {
    if (!up) return ch;
    const c = { ...ch, level, xp: 0, syncedFrom: ch.level, gearSync: level, gearUp: true, tree: { ...(ch.tree || {}), allocated: [...(ch.tree?.allocated || ['start'])] } };
    autoAllocate(c);
    c.abilities = treeAbilities(c);
    c.loadout = [...(ch.loadout || [])];
    return c;
  }
  const c = { ...ch, level, xp: 0, syncedFrom: ch.level, gearSync: level, tree: { ...(ch.tree || {}), allocated: [...(ch.tree?.allocated || ['start'])] } };
  sanitizeTree(c); // keeps the earliest allocated nodes that fit the point budget of the lower level
  c.abilities = treeAbilities(c);
  c.loadout = (ch.loadout || []).filter(a => c.abilities[a]);
  return c;
}

export function syncParty(characters) {
  const level = partySyncLevel(characters);
  return { level, characters: level ? characters.map(c => syncedCharacter(c, level)) : characters };
}
