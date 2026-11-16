// Encounter generation and reward calculation (shared by live and offline progression).
import { CONFIG } from './config.js';
import { ENEMIES } from './data/enemies.js';
import { ZONES, COOP_ENCOUNTERS, bossWave } from './data/zones.js';
import { generateItem } from './data/items.js';

export function zoneLevel(zone, heroLevel) {
  return Math.max(zone.levelRange[0], Math.min(zone.levelRange[1], heroLevel));
}

export function idleWaves(zoneId, heroLevel, rng, partySize = 4) {
  const zone = ZONES[zoneId];
  const lvl = zoneLevel(zone, heroLevel);
  const [mn, mx] = CONFIG.idle.enemiesPerFight;
  const count = rng.int(mn, Math.max(mn, Math.min(mx, partySize)));
  const wave = [];
  for (let i = 0; i < count; i++) {
    const enemyId = rng.pick(zone.enemies);
    const level = Math.max(zone.levelRange[0], Math.min(zone.levelRange[1], lvl + rng.int(-1, 0)));
    wave.push({ enemyId, level });
  }
  return [wave];
}

export function bossWaves(zoneId, heroLevel) {
  const zone = ZONES[zoneId];
  const lvl = Math.max(zone.levelRange[0] + 2, Math.min(zone.levelRange[1], heroLevel));
  return [bossWave(zone).map(enemyId => ({ enemyId, level: lvl }))];
}

export function coopWaves(encounterId, groupLevel) {
  const enc = COOP_ENCOUNTERS[encounterId];
  const lvl = Math.max(enc.minLevel, groupLevel);
  return enc.waves.map(w => w.map(enemyId => ({ enemyId, level: lvl })));
}

export function coopScale(players) {
  const extra = Math.max(0, players - 1);
  return { hp: 1 + extra * CONFIG.coop.hpScalePerExtraPlayer, damage: 1 + extra * CONFIG.coop.damageScalePerExtraPlayer };
}

export function killXp(kill) {
  const def = ENEMIES[kill.enemyId];
  return Math.round(def.xp * (1 + 0.22 * (kill.level - 1)) * (kill.summoned ? 0.3 : 1));
}

export function killGold(kill, rng) {
  const def = ENEMIES[kill.enemyId];
  const g = rng.int(def.gold[0], def.gold[1]) * (1 + 0.15 * (kill.level - 1));
  return Math.round(g * (kill.summoned ? 0.3 : 1));
}

// Returns { xp, gold, items[] } for a finished (won) battle
export function computeRewards(kills, rng, { rewardMult = 1, lootBoost = 0 } = {}) {
  let xp = 0, gold = 0;
  const items = [];
  for (const k of kills) {
    xp += killXp(k);
    gold += killGold(k, rng);
    const loot = ENEMIES[k.enemyId].loot || { chance: 0.1 };
    const count = loot.count || 1;
    for (let i = 0; i < count; i++) {
      const chance = (loot.chance || 0.1) * (k.summoned ? 0.25 : 1) * Math.min(2, rewardMult);
      if (rng() < chance) items.push(generateItem(rng, k.level, { boost: (loot.boost || 0) + lootBoost, minRarity: k.summoned ? 'common' : loot.minRarity || 'common' }));
    }
  }
  return { xp: Math.round(xp * rewardMult), gold: Math.round(gold * rewardMult), items };
}
