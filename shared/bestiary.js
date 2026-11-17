// Bestiary: readable descriptions of every enemy, its abilities and boss phases, where it lives,
// preparation tips, and kill mastery (small permanent damage bonus against that enemy).
import { ENEMIES, enemyStatsAt } from './data/enemies.js';
import { ABILITIES } from './data/abilities.js';
import { STATUSES } from './data/statuses.js';
import { ZONES, COOP_ENCOUNTERS } from './data/zones.js';
import { describeCondition } from './rules.js';

// ---------------------------------------------------------------- mastery
export const MASTERY = {
  normal: [25, 150, 500],  // kills for ★ / ★★ / ★★★
  boss: [3, 15, 40],
  bonus: [0.02, 0.04, 0.06], // damage dealt to that enemy
};
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
const TARGET_TEXT = {
  enemy_highest_threat: 'the hero with the most threat (your tank, if it holds aggro)',
  enemy_lowest_hp_pct: 'the most wounded hero (lowest health %)',
  enemy_lowest_hp: 'the hero with the least health',
  enemy_highest_hp: 'the hero with the most health',
  enemy_random: 'a random hero',
  enemy_current: 'the front-most hero',
  all_enemies: 'your whole party',
  self: 'itself',
  ally_lowest_hp_pct: 'its most wounded ally',
  ally_lowest_hp: 'its most wounded ally',
  all_allies: 'all of its allies',
};

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

// Preparation tips derived from the enemy's actual mechanics
export function enemyTips(enemyId) {
  const def = ENEMIES[enemyId];
  const effects = def.abilities.flatMap(a => (ABILITIES[a]?.effects || []).map(e => ({ ...e, ability: a, area: ABILITIES[a]?.area })));
  const phaseFx = (def.phases || []).flatMap(p => p.effects);
  const statuses = new Set(effects.filter(e => e.kind === 'status' && !e.self).map(e => e.status));
  const tips = [];
  if (def.abilities.some(a => ABILITIES[a]?.type === 'heal' && ABILITIES[a]?.target === 'ally')) tips.push('Heals its allies — kill it first. Use the "Specific enemy type" target on burst abilities to focus it.');
  if (def.abilities.includes('e_regenerate') || phaseFx.some(e => e.status === 'regeneration')) tips.push('Regenerates when hurt — save burst damage so it can\'t out-heal you.');
  const dots = [...statuses].filter(s => STATUSES[s]?.tick === 'damage' || s === 'frostbite' || s === 'weakened' || s === 'sundered' || s === 'exposed');
  if (dots.length) tips.push(`Applies ${dots.map(s => STATUSES[s].name).join(', ')} — a Cleric with Purify (cleanse) removes these.`);
  if (statuses.has('curse')) tips.push('Curse halves healing received — cleanse it quickly, or bring shields (Barrier) instead of relying on heals.');
  if (statuses.has('stun')) tips.push('Stuns heroes — healers with heal-over-time (Renew) or shields keep the party alive while someone is stunned.');
  if (effects.some(e => e.kind === 'damage' && e.area)) tips.push('Deals damage to the whole party — group healing (Prayer of Healing, Renew) and high Vitality help.');
  if (effects.some(e => e.kind === 'damage' && e.power >= 3)) tips.push('Has a huge single-target hit — keep your tank\'s defensive cooldown (Shield Wall/Evasion) ready, e.g. "when my health is below 60%".');
  if (def.abilities.some(a => ABILITIES[a]?.defaultRule?.target?.selector === 'enemy_lowest_hp_pct' || ABILITIES[a]?.defaultRule?.target?.selector === 'enemy_lowest_hp')) tips.push('Picks on wounded heroes — top up low-health party members early.');
  if (def.basicSchool === 'magical') tips.push('Attacks with magic — armor only partly reduces magical damage, so healing matters more than defense.');
  if (statuses.has('frostbite')) tips.push('Frostbite slows attack speed — attack-speed gear and buffs help make up for it.');
  if (phaseFx.some(e => e.kind === 'summon')) tips.push('Summons adds during the fight — area damage (Cleave, Volley, Flame Wave) clears them fast.');
  if (phaseFx.some(e => e.status === 'stone_skin')) tips.push('Becomes almost immune for a few seconds (Stone Skin) — use that window for defensive and healing abilities, not burst.');
  if (phaseFx.some(e => e.status === 'enrage') || def.enrageAfter) tips.push(`Enrages${def.enrageAfter ? ` after ${def.enrageAfter}s` : ''} — bring enough damage to finish before then.`);
  if (def.abilities.includes('e_frenzy')) tips.push('Frenzies at low health (+15% damage) — burst it down from 60%.');
  if (def.tags.includes('elite')) tips.push('Elite: much tougher than normal enemies and more likely to drop uniques and set items.');
  if (!tips.length) tips.push('No special mechanics — a straightforward fight.');
  return tips;
}

export function enemyKind(def) { return def.boss ? 'Boss' : def.tags.includes('elite') ? 'Elite' : 'Normal'; }

export const ALL_TAGS = ['beast', 'humanoid', 'undead', 'demon', 'elemental', 'giant', 'dragon', 'void', 'caster'];
