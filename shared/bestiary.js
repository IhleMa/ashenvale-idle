// Bestiary: readable descriptions of every enemy, its abilities and boss phases, where it lives,
// preparation tips, and kill mastery (small permanent damage bonus against that enemy).
import { ENEMIES, enemyStatsAt } from './data/enemies.js';
import { ABILITIES } from './data/abilities.js';
import { STATUSES } from './data/statuses.js';
import { ZONES, COOP_ENCOUNTERS } from './data/zones.js';
import { describeCondition } from './rules.js';

// ---------------------------------------------------------------- mastery
import { CONTENT } from './content.js';

const B = CONTENT.bestiary;
export const MASTERY = B.mastery;
const isBossLike = def => !!def.boss;
export function masteryTiers(enemyId) { return isBossLike(ENEMIES[enemyId]) ? MASTERY.boss : MASTERY.normal; }
export function masteryLevel(enemyId, kills = 0) { return masteryTiers(enemyId).filter(n => kills >= n).length; }
export function masteryBonus(enemyId, kills = 0) { const l = masteryLevel(enemyId, kills); return l ? MASTERY.bonus[l - 1] : 0; }
// { enemyId: bonus } for all enemies with at least ★ — passed into battles
export function masteryMap(p) {
  const out = {};
  for (const [id, e] of Object.entries(p?.bestiary || {})) { const b = masteryBonus(id, e.kills); if (b) out[id] = b; }
  return out;
}

// ---------------------------------------------------------------- where it appears
export function enemyLocations(enemyId) {
  const out = [];
  for (const z of Object.values(ZONES)) {
    if (z.enemies.includes(enemyId)) out.push({ kind: 'zone', id: z.id, name: z.name, levels: z.levelRange });
    if (z.boss === enemyId) out.push({ kind: 'boss', id: z.id, name: `${z.name} (zone boss)`, levels: z.levelRange });
  }
  for (const e of Object.values(COOP_ENCOUNTERS)) if (e.waves.some(w => w.includes(enemyId))) out.push({ kind: 'coop', id: e.id, name: `${e.name} (co-op)`, minLevel: e.minLevel });
  // summoned by bosses
  for (const b of Object.values(ENEMIES)) {
    if ((b.phases || []).some(ph => ph.effects.some(ef => ef.kind === 'summon' && ef.enemyId === enemyId))) out.push({ kind: 'summon', id: b.id, name: `Summoned by ${b.name}` });
  }
  if (out.some(l => l.kind === 'zone' || l.kind === 'boss')) out.push({ kind: 'rift', name: 'Rifts themed after its zone' });
  return out;
}

// Sensible level to show stats at (the hero's level, clamped to where the enemy lives)
export function defaultLevel(enemyId, heroLevel = 1) {
  const z = Object.values(ZONES).find(zz => zz.enemies.includes(enemyId) || zz.boss === enemyId);
  if (!z) return Math.max(heroLevel, Object.values(COOP_ENCOUNTERS).find(e => e.waves.some(w => w.includes(enemyId)))?.minLevel || 1);
  return Math.max(z.levelRange[0], Math.min(z.levelRange[1], heroLevel));
}
export function enemyZone(enemyId) {
  return Object.values(ZONES).find(z => z.enemies.includes(enemyId) || z.boss === enemyId) || null;
}

export function enemyStats(enemyId, level) {
  const def = ENEMIES[enemyId];
  const z = enemyZone(enemyId);
  const scale = (def.boss ? z?.bossScale : z?.scale) || { hp: 1, damage: 1 };
  return enemyStatsAt(def, level, scale);
}

// ---------------------------------------------------------------- text
const pct = v => `${Math.round(v * 100)}%`;
const statName = s => (s === 'magPower' ? 'magic power' : 'attack power');
const TARGET_TEXT = B.targetText;

function statusText(eff, stats) {
  const st = STATUSES[eff.status];
  if (!st) return eff.status;
  const dur = eff.duration >= 900 ? 'permanently' : `for ${eff.duration}s`;
  let t = `${st.name} ${dur}`;
  if (st.tick === 'damage' && eff.power) t += ` (${est(stats, eff.stat, eff.power) || pct(eff.power) + ' of ' + statName(eff.stat)} ${st.school} damage per second${st.maxStacks ? `, stacks up to ${st.maxStacks}×` : ''})`;
  else if (st.tick === 'heal' && eff.power) t += ` (heals ${est(stats, eff.stat, eff.power) || pct(eff.power) + ' of ' + statName(eff.stat)} per second)`;
  else t += ` — ${st.description.replace(/\.$/, '')}`;
  return t;
}

// ~number when stats are known (before armor), otherwise null
const est = (stats, stat, power) => (stats && stats[stat] ? `~${Math.round(stats[stat] * power)}` : null);

export function effectText(eff, stats = null) {
  switch (eff.kind) {
    case 'damage': return `deals ${est(stats, eff.stat, eff.power * (eff.hits || 1)) || pct(eff.power * (eff.hits || 1)) + ' ' + statName(eff.stat) + ' as'} ${eff.school} damage${eff.hits > 1 ? ` in ${eff.hits} hits` : ''}`;
    case 'heal': return `heals for ${est(stats, eff.stat === 'magPower' ? 'healPower' : eff.stat, eff.power) || pct(eff.power) + ' of its ' + statName(eff.stat)}`;
    case 'status': return `${eff.self ? 'gains' : 'applies'} ${statusText(eff, stats)}`;
    case 'shield': return `shields for ${pct(eff.power)} of ${statName(eff.stat)}`;
    case 'summon': return `summons ${eff.count || 1}× ${ENEMIES[eff.enemyId]?.name || eff.enemyId}`;
    case 'taunt': return 'forces attacks onto itself';
    case 'cleanse': return `removes ${eff.count || 1} debuff(s)`;
    default: return eff.kind;
  }
}

export function describeEnemyAbility(abilityId, stats = null) {
  const a = ABILITIES[abilityId];
  if (!a) return null;
  const rule = a.defaultRule || {};
  const target = TARGET_TEXT[rule.target?.selector] || (a.area ? 'your whole party' : 'a hero');
  const when = (rule.conditions || []).filter(c => c.type !== 'always').map(describeCondition);
  const onlyIf = (rule.targetConditions || []).map(describeCondition);
  return {
    id: abilityId, name: a.name, type: a.type, cooldown: a.cooldown, area: !!a.area,
    text: `${a.area ? 'Hits' : 'Targets'} ${target}: ${a.effects.map(e => effectText(e, stats)).join(', then ')}.`,
    when: when.length ? `Used when ${when.join(' and ')}${onlyIf.length ? `, only if ${onlyIf.join(' and ')}` : ''}.` : (onlyIf.length ? `Only if ${onlyIf.join(' and ')}.` : 'Used whenever it is ready.'),
    statuses: a.effects.filter(e => e.kind === 'status').map(e => e.status),
  };
}

export function describePhases(def, stats = null) {
  return (def.phases || []).map(ph => ({ hpBelow: ph.hpBelow, message: ph.message, text: ph.effects.map(e => effectText(e, stats)).join(', ') }));
}

// Preparation tips: rules in content/bestiary.json, checked against the enemy's actual mechanics.
// Conditions: healsAllies, hasAbility, phaseStatus, appliesStatus, appliesStatuses { tickDamage, ids },
// areaDamage, minHitPower, targetsSelectors, basicSchool, phaseSummons, enrages, hasTag, anyOf [..]
function tipFacts(def) {
  const effects = def.abilities.flatMap(a => (ABILITIES[a]?.effects || []).map(e => ({ ...e, ability: a, area: ABILITIES[a]?.area })));
  const phaseFx = (def.phases || []).flatMap(p => p.effects);
  return { def, effects, phaseFx, statuses: new Set(effects.filter(e => e.kind === 'status' && !e.self).map(e => e.status)) };
}
function tipMatches(cond, f, vars) {
  const { def, effects, phaseFx, statuses } = f;
  return Object.entries(cond).every(([k, v]) => {
    switch (k) {
      case 'anyOf': return v.some(c => tipMatches(c, f, vars));
      case 'healsAllies': return def.abilities.some(a => ABILITIES[a]?.type === 'heal' && ABILITIES[a]?.target === 'ally') === v;
      case 'hasAbility': return def.abilities.includes(v);
      case 'phaseStatus': return phaseFx.some(e => e.status === v);
      case 'appliesStatus': return statuses.has(v);
      case 'appliesStatuses': {
        const list = [...statuses].filter(s => (v.tickDamage && STATUSES[s]?.tick === 'damage') || (v.ids || []).includes(s));
        vars.statuses = list.map(s => STATUSES[s].name).join(', ');
        return list.length > 0;
      }
      case 'areaDamage': return effects.some(e => e.kind === 'damage' && e.area) === v;
      case 'minHitPower': return effects.some(e => e.kind === 'damage' && e.power >= v);
      case 'targetsSelectors': return def.abilities.some(a => v.includes(ABILITIES[a]?.defaultRule?.target?.selector));
      case 'basicSchool': return def.basicSchool === v;
      case 'phaseSummons': return phaseFx.some(e => e.kind === 'summon') === v;
      case 'enrages': vars.enrageAfter = def.enrageAfter ? ` after ${def.enrageAfter}s` : ''; return (phaseFx.some(e => e.status === 'enrage') || !!def.enrageAfter) === v;
      case 'hasTag': return def.tags.includes(v);
      default: return false;
    }
  });
}
export function enemyTips(enemyId) {
  const f = tipFacts(ENEMIES[enemyId]);
  const tips = [];
  for (const rule of B.tips) {
    const vars = {};
    if (tipMatches(rule.if, f, vars)) tips.push(rule.text.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? ''));
  }
  if (!tips.length) tips.push(B.noTipsText);
  return tips;
}

export function enemyKind(def) { return def.boss ? 'Boss' : def.tags.includes('elite') ? 'Elite' : 'Normal'; }

export const ALL_TAGS = B.tags;
