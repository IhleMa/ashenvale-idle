// Pinnacle bosses (content/pinnacle/): endgame fights with mechanics that ask for a specific party.
import { CONTENT, withIds, onContentReload } from './content.js';

export const PINNACLE = CONTENT.pinnacle?.config || { minLevel: 60, level: 60, sigilDrops: {} };
export const PINNACLE_BOSSES = withIds(CONTENT.pinnacle?.bosses || {});
onContentReload(() => { withIds(PINNACLE_BOSSES); Object.assign(PINNACLE, CONTENT.pinnacle?.config || {}); });

export const pinnacleList = () => Object.values(PINNACLE_BOSSES).sort((a, b) => (a.order || 0) - (b.order || 0));

export function pinnacleWaves(bossId) {
  const def = PINNACLE_BOSSES[bossId];
  return def.waves.map(w => w.map(enemyId => ({ enemyId, level: PINNACLE.level })));
}

export function pinnacleScale(bossId) {
  const s = PINNACLE_BOSSES[bossId]?.scale || {};
  return { hp: s.hp ?? 1, damage: s.damage ?? 1 };
}

// Pinnacle Sigils from a won fight (never from rifts): a very rare roll per kill of a high enough enemy
export function rollSigils(kills, rng) {
  const d = PINNACLE.sigilDrops || {};
  let n = 0;
  for (const k of kills) {
    if (k.summoned || k.level < (d.minLevel ?? 55)) continue;
    const chance = k.boss ? d.boss : k.elite ? d.elite : d.normal;
    if (chance && rng() < chance) n++;
  }
  return n;
}

// weeks start on Monday 00:00 UTC
export function weekKey(at = Date.now()) {
  const d = new Date(at);
  const day = (d.getUTCDay() + 6) % 7;
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
  return new Date(monday).toISOString().slice(0, 10);
}

export function pinnacleState(p) {
  p.pinnacle ||= {};
  const s = p.pinnacle;
  s.sigils ||= 0;
  s.kills ||= {};      // bossId -> kills
  s.best ||= {};       // bossId -> fastest kill (seconds)
  s.firstKill ||= {};  // bossId -> timestamp
  s.weekly ||= {};     // bossId -> week key of the last weekly bonus
  s.attempts ||= 0;
  return s;
}
