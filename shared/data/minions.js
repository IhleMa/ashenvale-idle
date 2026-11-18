// Minions summoned by players (content/minions/): temporary allies built from their summoner's power.
//   hp / power / defense — fractions of the summoner's max health / Magic Power / defense
//   attack               — basic attack { name, power, school }; abilities — extra abilities (classId "minion")
//   duration             — seconds until it fades (0 = until the fight ends); threat — starting threat on enemies
import { CONTENT, withIds, onContentReload } from '../content.js';

export const MINIONS = withIds(CONTENT.minions.minions);
onContentReload(() => withIds(MINIONS));
