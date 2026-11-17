// Expedition destinations and camp limits — defined in content/expeditions.json.
import { CONTENT, withIds, onContentReload } from '../content.js';

const X = CONTENT.expeditions;
export const EXPEDITIONS = withIds(X.expeditions);
export const EXPEDITION_DURATIONS = X.durations;
export const CAMP_SLOTS = X.campSlots;     // simultaneous expeditions by Expedition Camp level
export const CAMP_MEMBERS = X.campMembers; // recruits per expedition by camp level
onContentReload(() => withIds(EXPEDITIONS));
