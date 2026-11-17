// Buffs and debuffs — defined in content/statuses.json.
import { CONTENT, onContentReload, refillArray } from '../content.js';

export const STATUSES = CONTENT.statuses.statuses;
export const STATUS_IDS = Object.keys(STATUSES);
onContentReload(() => refillArray(STATUS_IDS, Object.keys(STATUSES)));
