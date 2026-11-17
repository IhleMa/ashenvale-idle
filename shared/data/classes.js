// Classes and recruit traits — defined in content/classes.json.
// To add a class: add it there, give it abilities (abilities.json, "classId") and a skill tree (skilltree.json).
import { CONTENT, onContentReload, refillArray } from '../content.js';

export const CLASSES = CONTENT.classes.classes;
export const CLASS_IDS = Object.keys(CLASSES);
// Traits give recruits personality. Each recruit rolls one.
export const TRAITS = CONTENT.classes.traits;
onContentReload(() => refillArray(CLASS_IDS, Object.keys(CLASSES)));

export function classTier(classId, level, isMain) {
  const tiers = CLASSES[classId]?.tiers || [];
  let current = tiers[0];
  for (const t of tiers) if (level >= t.level && (!t.mainOnly || isMain)) current = t;
  return current;
}
