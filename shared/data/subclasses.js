// Subclasses (content/subclasses/): what a hero can ascend into at max level (see server/playerLogic.js → ascendHero).
// A subclass keeps everything of its class and adds: its own branch(es) in the skill tree (with subclass abilities,
// classId = the class + "subclass": id) and a permanent passive bonus (same stat keys as skill-tree nodes).
import { CONTENT, withIds, onContentReload } from '../content.js';

export const SUBCLASSES = withIds(CONTENT.subclasses.subclasses);
onContentReload(() => withIds(SUBCLASSES));
export const subclassesOf = classId => Object.values(SUBCLASSES).filter(s => s.classId === classId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

// Display name for a hero/unit: the subclass name once ascended, otherwise the class name.
import { CLASSES } from './classes.js';
export const classLabel = (classId, subclassId) => (subclassId && SUBCLASSES[subclassId]?.name) || CLASSES[classId]?.name || classId;
