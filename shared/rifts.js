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
import { CONTENT, onContentReload } from './content.js';

const DT = CONFIG.combat.tickMs / 1000;

const RF = CONTENT.rifts;
export const RIFT = RF.config;

// ---------------------------------------------------------------- affixes
// Affixes are data (content/rifts.json): each has a list of "mechanics" that this interpreter turns into
// battle hooks (see createBattle hooks in combat.js). Mechanic types:
//   enemyStats        { who: all|boss|nonBoss, hpPct, damagePct }            — when enemies spawn
//   enemyDamageTaken  { school: physical|magical|any, mult }                  — damage enemies take
//   onEnemyDeath      { action: bolster|healAllies, status?, maxHpPct?, pctMaxHp?, message? }
//   enemyLowHealth    { who, below, status, message }                         — once per enemy
//   onEnemyHit        { status, duration, basicAttacksOnly }                   — enemy hits a hero
//   periodic          { every, target: randomHero|allHeroes, status?, duration?, pctMaxHp?, damagePctMaxHp?, school?, message? }
export const AFFIXES = RF.affixes;
for (const [id, a] of Object.entries(AFFIXES)) a.id = id;
onContentReload(() => { for (const [id, a] of Object.entries(AFFIXES)) a.id = id; });

const whoMatches = (who, u) => !who || who === 'all' || (who === 'boss' ? !!u.boss : !u.boss);
const fill = (text, u) => String(text || '').replace('{name}', u?.name || '');

function mechanicHooks(m, key) {
  switch (m.type) {
    case 'enemyStats': return {
      spawn(b, u) { if (u.side === 'B' && whoMatches(m.who, u)) buffUnit(u, m.hpPct || 0, m.damagePct || 0); },
    };
    case 'enemyDamageTaken': return {
      damageMult(src, tgt, school) { return tgt.side === 'B' && (!m.school || m.school === 'any' || m.school === school) ? m.mult : 1; },
    };
    case 'onEnemyDeath': return {
      kill(b, src, tgt, api) {
        if (tgt.side !== 'B') return;
        const rest = b.units.filter(u => u.side === 'B' && u.alive);
        if (m.action === 'bolster') {
          for (const u of rest) { api.applyStatus(b, u, u, m.status, 999, 0, 1); const add = Math.round(u.maxHp * (m.maxHpPct || 0)); u.maxHp += add; u.hp += add; }
          if (rest.length && m.message) api.message(b, rest[0], fill(m.message, rest[0]));
        } else if (m.action === 'healAllies') {
          for (const u of rest) api.heal(b, u, u, u.maxHp * m.pctMaxHp);
        }
      },
    };
    case 'enemyLowHealth': return {
      damaged(b, src, tgt, info, api) {
        const flag = `_affix_${key}`;
        if (tgt.side !== 'B' || !whoMatches(m.who, tgt) || tgt[flag] || tgt.hp / tgt.maxHp >= m.below) return;
        tgt[flag] = true;
        api.applyStatus(b, tgt, tgt, m.status, 999, 0, 1);
        if (m.message) api.message(b, tgt, fill(m.message, tgt));
      },
    };
    case 'onEnemyHit': return {
      damaged(b, src, tgt, info, api) {
        if (src.side === 'B' && tgt.side === 'A' && !info.dot && (!m.basicAttacksOnly || !info.ability)) api.applyStatus(b, src, tgt, m.status, m.duration, 0, 1);
      },
    };
    case 'periodic': return {
      tick(b, api) {
        b.affixTimers ||= {};
        b.affixTimers[key] = (b.affixTimers[key] ?? m.every) - DT;
        if (b.affixTimers[key] > 0) return;
        b.affixTimers[key] = m.every;
        const src = b.units.find(u => u.side === 'B' && u.alive);
        const heroes = b.units.filter(u => u.side === 'A' && u.alive);
        if (m.target === 'randomHero') {
          if (!heroes.length || !src) return;
          const t = heroes[Math.floor(b.rng() * heroes.length)];
          if (m.status) api.applyStatus(b, src, t, m.status, m.duration, t.maxHp * (m.pctMaxHp || 0), 1);
          if (m.damagePctMaxHp) api.damage(b, src, t, t.maxHp * m.damagePctMaxHp, m.school || 'physical');
        } else {
          if (!src) return;
          if (m.message) api.message(b, src, m.message);
          for (const h of heroes) {
            if (m.damagePctMaxHp) api.damage(b, src, h, h.maxHp * m.damagePctMaxHp, m.school || 'physical');
            if (m.status) api.applyStatus(b, src, h, m.status, m.duration, h.maxHp * (m.pctMaxHp || 0), 1);
          }
        }
      },
    };
    default: return {};
  }
}

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
  const RO = RF.rotation;
  const rng = createRng(RO.seed + w * RO.seedPerWeek);
  const first = RO.firstAffix[w % RO.firstAffix.length];
  const pool = Object.keys(AFFIXES).filter(a => !RO.firstAffix.includes(a));
  const second = pool.splice(Math.floor(rng() * pool.length), 1)[0];
  // never two affixes that cancel each other's counterplay (e.g. arcane_ward + ironhide)
  const clash = a => RO.mutuallyExclusive.some(pair => pair.includes(a) && pair.includes(second) && a !== second);
  const third = pool.filter(a => !clash(a))[Math.floor(rng() * (pool.length - 1))];
  return [first, second, third];
}
export function affixesFor(tier, now = Date.now()) {
  return weeklyAffixes(now).filter((a, i) => tier >= RIFT.affixTiers[i]);
}

export function riftHooks(affixIds) {
  const list = affixIds.filter(id => AFFIXES[id]).flatMap(id => (AFFIXES[id].mechanics || []).map((m, i) => mechanicHooks(m, `${id}_${i}`)));
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
  const C = RF.composition;
  const size = Math.max(C.minWaveSize, Math.min(C.maxWaveSize, partySize));
  const waves = [];
  for (let w = 0; w < RIFT.trashWaves; w++) {
    const wave = [];
    const n = size - (w === 0 ? C.firstWaveFewer : 0);
    for (let i = 0; i < n; i++) wave.push({ enemyId: rng.pick(zone.enemies), level: lvl });
    waves.push(wave);
  }
  waves.push([{ enemyId: zone.boss, level: lvl + C.guardianLevelBonus }, ...zone.enemies.slice(0, C.guardianEscorts).map(enemyId => ({ enemyId, level: lvl }))]);
  return waves;
}

export function riftThemes(p) { return p.unlockedZones.filter(z => ZONES[z]?.boss && ENEMIES[ZONES[z].boss]); }

// ---------------------------------------------------------------- rewards
export function riftRewardOptions(tier, timed) {
  const m = timed ? 1 : RIFT.untimedRewardMult;
  const W = RF.rewards;
  return { rewardMult: (W.rewardMult.base + W.rewardMult.perTier * tier) * m, lootBoost: Math.min(W.lootBoost.max, W.lootBoost.perTier * tier) };
}
// guaranteed chest for timed runs
export function riftChest(tier) {
  const C = RF.rewards.chest;
  const count = 1 + C.extraItemAtTiers.filter(t => tier >= t).length;
  const minRarity = C.rarityByTier.filter(([t]) => tier >= t).pop()?.[1] || C.rarityByTier[0][1];
  return { count, minRarity, itemLevelBonus: Math.min(C.maxItemLevelBonus, Math.floor(tier / C.itemLevelEveryTiers)), boost: 1 + tier * C.qualityBoostPerTier };
}
// crystals for the first timed clear of a tier
export function firstClearCrystals(tier) { const F = RF.rewards.firstClearCrystals; return F.base + Math.floor(tier / F.perTiers); }
