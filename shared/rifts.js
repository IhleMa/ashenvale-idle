// Rifts: endless, scaling dungeon runs against the clock.
//
// A rift is themed after one of the player's unlocked zones: 3 waves of that zone's enemies, then a
// Rift Guardian (the zone's boss) with an escort. Each tier makes enemies tougher. Finish within the
// time limit ("timed") to unlock the next tier. Affixes rotate weekly (the same for everyone, so the
// leaderboard is fair) and switch on at tier 2, 5 and 10.
import { ZONES } from './data/zones.js';
import { ENEMIES } from './data/enemies.js';
import { createRng } from './rng.js';
import { CONFIG } from './config.js';

const DT = CONFIG.combat.tickMs / 1000;

export const RIFT = {
  minLevel: 8,
  maxTier: 150,
  trashWaves: 3,
  timeLimit: 210,            // seconds of battle time for the whole run
  baseHp: 0.55,              // tier 1 enemy health vs. the open world
  baseDamage: 0.6,
  hpGrowth: 1.12,            // per tier
  damageGrowth: 1.075,       // per tier
  affixTiers: [2, 5, 10],    // tier at which the 1st/2nd/3rd affix switches on
  untimedRewardMult: 0.5,
};

// ---------------------------------------------------------------- affixes
// Every affix is pure data + battle hooks (see createBattle hooks in combat.js).
export const AFFIXES = {
  fortified: {
    name: 'Fortified', icon: '🛡', description: 'Non-boss enemies have 25% more health and deal 15% more damage.',
    spawn(b, u) { if (u.side === 'B' && !u.boss) buffUnit(u, 0.25, 0.15); },
  },
  tyrannical: {
    name: 'Tyrannical', icon: '👑', description: 'The Rift Guardian has 35% more health and deals 15% more damage.',
    spawn(b, u) { if (u.side === 'B' && u.boss) buffUnit(u, 0.35, 0.15); },
  },
  bolstering: {
    name: 'Bolstering', icon: '💪', description: 'When an enemy dies, the other enemies gain +8% damage (stacks) and 8% more max health.',
    kill(b, src, tgt, api) {
      if (tgt.side !== 'B') return;
      const rest = b.units.filter(u => u.side === 'B' && u.alive);
      for (const u of rest) { api.applyStatus(b, u, u, 'bolstered', 999, 0, 1); const add = Math.round(u.maxHp * 0.08); u.maxHp += add; u.hp += add; }
      if (rest.length) api.message(b, rest[0], 'Bolstering: the remaining enemies grow stronger!');
    },
  },
  sanguine: {
    name: 'Sanguine', icon: '🩸', description: 'When an enemy dies, the other enemies are healed for 15% of their max health.',
    kill(b, src, tgt, api) {
      if (tgt.side !== 'B') return;
      for (const u of b.units.filter(x => x.side === 'B' && x.alive)) api.heal(b, u, u, u.maxHp * 0.15);
    },
  },
  raging: {
    name: 'Raging', icon: '😡', description: 'Non-boss enemies enrage below 30% health (+50% damage, +30% attack speed). Kill them quickly once they get low.',
    damaged(b, src, tgt, info, api) {
      if (tgt.side !== 'B' || tgt.boss || tgt.raged || tgt.hp / tgt.maxHp >= 0.3) return;
      tgt.raged = true;
      api.applyStatus(b, tgt, tgt, 'enrage', 999, 0, 1);
      api.message(b, tgt, `${tgt.name} becomes enraged!`);
    },
  },
  volcanic: {
    name: 'Volcanic', icon: '🌋', description: 'Every 9 seconds the ground erupts under a random hero, burning them (3% of their max health per second for 5s).',
    tick(b, api) {
      b.affixTimer = (b.affixTimer ?? 9) - DT;
      if (b.affixTimer > 0) return;
      b.affixTimer = 9;
      const heroes = b.units.filter(u => u.side === 'A' && u.alive);
      const src = b.units.find(u => u.side === 'B' && u.alive);
      if (!heroes.length || !src) return;
      const t = heroes[Math.floor(b.rng() * heroes.length)];
      api.applyStatus(b, src, t, 'burn', 5, t.maxHp * 0.03, 1);
    },
  },
  necrotic: {
    name: 'Necrotic', icon: '☠', description: 'Enemy attacks inflict Necrotic Wounds: healing received −8% per stack (up to 8). Hits your tank hardest — strong healing and cleanses help.',
    damaged(b, src, tgt, info, api) {
      if (src.side === 'B' && tgt.side === 'A' && !info.dot && !info.ability) api.applyStatus(b, src, tgt, 'necrotic', 6, 0, 1);
    },
  },
  arcane_ward: {
    name: 'Arcane Ward', icon: '🔮', description: 'Enemies take 25% less magical damage. Physical damage dealers shine.',
    damageMult(src, tgt, school) { return tgt.side === 'B' && school === 'magical' ? 0.75 : 1; },
  },
  ironhide: {
    name: 'Ironhide', icon: '🪨', description: 'Enemies take 25% less physical damage. Spellcasters shine.',
    damageMult(src, tgt, school) { return tgt.side === 'B' && school === 'physical' ? 0.75 : 1; },
  },
  quaking: {
    name: 'Quaking', icon: '💥', description: 'Every 14 seconds the rift quakes, dealing 8% of max health as damage to every hero.',
    tick(b, api) {
      b.quakeTimer = (b.quakeTimer ?? 14) - DT;
      if (b.quakeTimer > 0) return;
      b.quakeTimer = 14;
      const src = b.units.find(u => u.side === 'B' && u.alive);
      if (!src) return;
      api.message(b, src, 'The rift quakes!');
      for (const h of b.units.filter(u => u.side === 'A' && u.alive)) api.damage(b, src, h, h.maxHp * 0.08, 'physical');
    },
  },
};
for (const [id, a] of Object.entries(AFFIXES)) a.id = id;

function buffUnit(u, hpPct, dmgPct) {
  u.maxHp = Math.round(u.maxHp * (1 + hpPct));
  u.hp = u.maxHp;
  u.bonuses.damagePct += dmgPct;
}

// ---------------------------------------------------------------- weekly rotation
const WEEK_MS = 7 * 86400000;
const EPOCH = Date.UTC(2024, 0, 1, 3); // a Monday, 03:00 UTC (weekly reset)
export function weekIndex(now = Date.now()) { return Math.floor((now - EPOCH) / WEEK_MS); }
export function weekEndsAt(now = Date.now()) { return EPOCH + (weekIndex(now) + 1) * WEEK_MS; }

// [first, second, third]: first is always fortified or tyrannical (like the classic rotation)
export function weeklyAffixes(now = Date.now()) {
  const w = weekIndex(now);
  const rng = createRng(9173 + w * 7919);
  const first = w % 2 === 0 ? 'fortified' : 'tyrannical';
  const pool = Object.keys(AFFIXES).filter(a => a !== 'fortified' && a !== 'tyrannical');
  const second = pool.splice(Math.floor(rng() * pool.length), 1)[0];
  // never two affixes that cancel each other's counterplay (arcane_ward + ironhide)
  const third = pool.filter(a => !(second === 'arcane_ward' && a === 'ironhide') && !(second === 'ironhide' && a === 'arcane_ward'))[Math.floor(rng() * (pool.length - 1))];
  return [first, second, third];
}
export function affixesFor(tier, now = Date.now()) {
  return weeklyAffixes(now).filter((a, i) => tier >= RIFT.affixTiers[i]);
}

export function riftHooks(affixIds) {
  const list = affixIds.map(id => AFFIXES[id]).filter(Boolean);
  if (!list.length) return null;
  return {
    spawn: (b, u, api) => { for (const a of list) a.spawn?.(b, u, api); },
    kill: (b, s, t, api) => { for (const a of list) a.kill?.(b, s, t, api); },
    damaged: (b, s, t, info, api) => { for (const a of list) a.damaged?.(b, s, t, info, api); },
    tick: list.some(a => a.tick) ? (b, api) => { for (const a of list) a.tick?.(b, api); } : null,
    damageMult: list.some(a => a.damageMult) ? (s, t, school) => list.reduce((m, a) => m * (a.damageMult ? a.damageMult(s, t, school) : 1), 1) : null,
  };
}

// ---------------------------------------------------------------- run composition
export function maxStartTier(p) { return Math.min(RIFT.maxTier, (p.rift?.best || 0) + 1); }
export function riftScale(tier) {
  return { hp: RIFT.baseHp * Math.pow(RIFT.hpGrowth, tier - 1), damage: RIFT.baseDamage * Math.pow(RIFT.damageGrowth, tier - 1) };
}
export function riftLevel(heroLevel) { return Math.max(RIFT.minLevel, heroLevel); }

// Picks a theme zone among the unlocked ones and builds the waves
export function riftWaves(themeZoneId, heroLevel, rng, partySize = 4) {
  const zone = ZONES[themeZoneId];
  const lvl = riftLevel(heroLevel);
  const size = Math.max(3, Math.min(5, partySize));
  const waves = [];
  for (let w = 0; w < RIFT.trashWaves; w++) {
    const wave = [];
    const n = size - (w === 0 ? 1 : 0);
    for (let i = 0; i < n; i++) wave.push({ enemyId: rng.pick(zone.enemies), level: lvl });
    waves.push(wave);
  }
  waves.push([{ enemyId: zone.boss, level: lvl + 1 }, { enemyId: zone.enemies[0], level: lvl }]);
  return waves;
}

export function riftThemes(p) { return p.unlockedZones.filter(z => ZONES[z]?.boss && ENEMIES[ZONES[z].boss]); }

// ---------------------------------------------------------------- rewards
export function riftRewardOptions(tier, timed) {
  const m = timed ? 1 : RIFT.untimedRewardMult;
  return { rewardMult: (1.4 + 0.08 * tier) * m, lootBoost: Math.min(2.5, 0.12 * tier) };
}
// guaranteed chest for timed runs
export function riftChest(tier) {
  const count = 1 + (tier >= 5 ? 1 : 0) + (tier >= 12 ? 1 : 0);
  const minRarity = tier >= 25 ? 'legendary' : tier >= 12 ? 'epic' : tier >= 5 ? 'rare' : 'uncommon';
  return { count, minRarity, itemLevelBonus: Math.min(10, Math.floor(tier / 4)) };
}
// crystals for the first timed clear of a tier
export function firstClearCrystals(tier) { return 2 + Math.floor(tier / 5); }
