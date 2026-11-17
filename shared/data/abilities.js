// Abilities of classes and enemies — defined in content/abilities.json.
// The combat engine interprets each ability's "effects" (see CONTENT.md for every effect kind);
// "defaultRule" is the behaviour a freshly unlocked ability starts with (players can change it).
import { CONTENT, withIds, onContentReload, refillObject } from '../content.js';

export const ABILITIES = withIds(CONTENT.abilities.abilities);

// Default priority (higher = checked earlier) used to place newly learned abilities in the loadout.
const priorities = () => Object.fromEntries(Object.entries(ABILITIES).filter(([, a]) => a.priority != null).map(([id, a]) => [id, a.priority]));
export const DEFAULT_PRIORITY = priorities();
onContentReload(() => { withIds(ABILITIES); refillObject(DEFAULT_PRIORITY, priorities()); });
export const abilityPriority = id => DEFAULT_PRIORITY[id] ?? 50;

export function classAbilities(classId) {
  return Object.values(ABILITIES).filter(a => a.classId === classId).sort((a, b) => a.unlockLevel - b.unlockLevel);
}
