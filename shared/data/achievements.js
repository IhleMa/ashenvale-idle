// Achievements — defined in content/achievements.json. Images: assets/achievements/<id>.png
import { CONTENT, withIds, onContentReload } from '../content.js';

export const ACHIEVEMENTS = withIds(CONTENT.achievements.achievements);
onContentReload(() => withIds(ACHIEVEMENTS));
