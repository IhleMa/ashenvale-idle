// Zones and co-op encounters — defined in content/zones.json.
import { CONTENT, withIds } from '../content.js';

export const ZONES = withIds(CONTENT.zones.zones);

// Boss challenge composition: the boss plus a few zone minions ("bossWaveEscorts")
export function bossWave(zone) {
  return [zone.boss, ...zone.enemies.slice(0, CONTENT.zones.bossWaveEscorts ?? 1)].filter(Boolean);
}

// Co-op encounters. waves: arrays of enemy ids fought in sequence (HP carries over between waves).
export const COOP_ENCOUNTERS = withIds(CONTENT.zones.coopEncounters);
