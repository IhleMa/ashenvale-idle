// Behaviour rule system. Each ability carries a rule:
// {
//   enabled: true,
//   mode: 'all' | 'any',                  // how activation conditions combine
//   conditions: [ { type, ...params, negate? } | { type:'group', mode, conditions:[...] } ],
//   target: { selector, param? },
//   targetConditions: [ { type, ...params, negate? } ]   // filters candidate targets (all must pass)
// }
// Conditions and selectors are registries: add an entry here and the editor UI picks it up automatically.
import { STATUSES } from './data/statuses.js';
import { MINIONS } from './data/minions.js';

// ---------- helpers on battle units ----------
export const hpPct = u => (u.maxHp > 0 ? (u.hp / u.maxHp) * 100 : 0);
export const hasStatus = (u, id) => u.statuses.some(s => s.id === id);
export const hasDebuff = u => u.statuses.some(s => STATUSES[s.id]?.type === 'debuff');
// Allies are the real party members — summoned minions are left out (healers don't waste heals on them,
// "allies below X%" ignores them); minion-specific conditions and targets use ownMinions().
export const alliesOf = (battle, u) => battle.units.filter(x => x.side === u.side && x.alive && x.kind !== 'minion');
export const ownMinions = (battle, u, type = '') => battle.units.filter(x => x.kind === 'minion' && x.alive && x.ownerUid === u.uid && (!type || x.defId === type));
export const enemiesOf = (battle, u) => battle.units.filter(x => x.side !== u.side && x.alive);
const cmp = (a, op, b) => (op === '<=' ? a <= b : op === '==' ? a === b : op === '<' ? a < b : op === '>' ? a > b : a >= b);

const P = {
  pct: (key = 'value', def = 50) => ({ key, type: 'number', min: 0, max: 100, step: 5, default: def, suffix: '%' }),
  count: (key = 'value', def = 2) => ({ key, type: 'number', min: 0, max: 20, step: 1, default: def }),
  cmp: () => ({ key: 'cmp', type: 'select', options: [['>=', 'at least'], ['<=', 'at most'], ['==', 'exactly']], default: '>=' }),
  status: (def = 'poison') => ({ key: 'status', type: 'status', default: def }),
  seconds: (def = 10) => ({ key: 'value', type: 'number', min: 0, max: 600, step: 1, default: def, suffix: 's' }),
  role: () => ({ key: 'role', type: 'select', options: [['tank', 'Tank'], ['healer', 'Healer'], ['damage', 'Damage'], ['support', 'Support']], default: 'tank' }),
  tag: () => ({ key: 'param', type: 'enemyTag', default: 'boss' }),
  minion: () => ({ key: 'minion', type: 'minion', default: '' }),
};

// ---------- Activation conditions ----------
export const CONDITIONS = {
  always:             { label: 'Whenever available', params: [], test: () => true },
  self_hp_below:      { label: 'Own health below', params: [P.pct('value', 40)], test: (c, b, u) => hpPct(u) < c.value },
  self_hp_above:      { label: 'Own health above', params: [P.pct('value', 80)], test: (c, b, u) => hpPct(u) > c.value },
  ally_hp_below:      { label: 'Any ally health below', params: [P.pct('value', 30)], test: (c, b, u) => alliesOf(b, u).some(a => hpPct(a) < c.value) },
  allies_below_hp:    { label: 'Number of allies below health', params: [P.pct('value', 60), P.count('count', 2)], test: (c, b, u) => alliesOf(b, u).filter(a => hpPct(a) < c.value).length >= c.count, format: c => `≥${c.count} allies below ${c.value}% health` },
  enemy_hp_below:     { label: 'Any enemy health below', params: [P.pct('value', 30)], test: (c, b, u) => enemiesOf(b, u).some(e => hpPct(e) < c.value) },
  enemies_alive:      { label: 'Number of enemies alive', params: [P.cmp(), P.count('value', 2)], test: (c, b, u) => cmp(enemiesOf(b, u).length, c.cmp, c.value) },
  allies_alive:       { label: 'Number of allies alive', params: [P.cmp(), P.count('value', 2)], test: (c, b, u) => cmp(alliesOf(b, u).length, c.cmp, c.value) },
  self_has_status:    { label: 'I have buff/debuff', params: [P.status('battle_cry')], test: (c, b, u) => hasStatus(u, c.status) },
  self_missing_status:{ label: 'I am missing buff/debuff', params: [P.status('shield_wall')], test: (c, b, u) => !hasStatus(u, c.status) },
  ally_has_status:    { label: 'Any ally has buff/debuff', params: [P.status('poison')], test: (c, b, u) => alliesOf(b, u).some(a => hasStatus(a, c.status)) },
  enemy_has_status:   { label: 'Any enemy has buff/debuff', params: [P.status('enrage')], test: (c, b, u) => enemiesOf(b, u).some(a => hasStatus(a, c.status)) },
  resource_above:     { label: 'Resource above', params: [P.pct('value', 50)], test: (c, b, u) => (u.resourceMax ? (u.resource / u.resourceMax) * 100 : 100) > c.value },
  resource_below:     { label: 'Resource below', params: [P.pct('value', 50)], test: (c, b, u) => (u.resourceMax ? (u.resource / u.resourceMax) * 100 : 100) < c.value },
  boss_present:       { label: 'A boss is present', params: [], test: (c, b, u) => enemiesOf(b, u).some(e => e.tags?.includes('boss')) },
  combat_time_above:  { label: 'Fight has lasted longer than', params: [P.seconds(10)], test: (c, b) => b.time > c.value },
  own_minions:        { label: 'Number of my minions', params: [P.minion(), P.cmp(), P.count('value', 2)], test: (c, b, u) => cmp(ownMinions(b, u, c.minion).length, c.cmp, c.value), format: c => `my ${c.minion ? MINIONS[c.minion]?.name || c.minion : 'minions'}: ${c.cmp === '<=' ? 'at most' : c.cmp === '==' ? 'exactly' : 'at least'} ${c.value}` },
};

// ---------- Target conditions (filters on candidates) ----------
export const TARGET_CONDITIONS = {
  alive:                 { label: 'Target must be alive', params: [], test: (c, t) => t.alive, locked: true },
  target_missing_status: { label: 'Target must NOT have', params: [P.status('renew')], test: (c, t) => !hasStatus(t, c.status) },
  target_has_status:     { label: 'Target must have', params: [P.status('poison')], test: (c, t) => hasStatus(t, c.status) },
  target_has_debuff:     { label: 'Target has any debuff', params: [], test: (c, t) => hasDebuff(t) },
  target_hp_below:       { label: 'Target health below', params: [P.pct('value', 50)], test: (c, t) => hpPct(t) < c.value },
  target_hp_above:       { label: 'Target health above', params: [P.pct('value', 50)], test: (c, t) => hpPct(t) > c.value },
  target_role:           { label: 'Target has role', params: [P.role()], test: (c, t) => t.role === c.role },
  target_is_type:        { label: 'Target is enemy type', params: [P.tag()], test: (c, t) => t.tags?.includes(c.param) || t.defId === c.param },
  target_is_minion:      { label: 'Target is a minion', params: [P.minion()], test: (c, t) => t.kind === 'minion' && (!c.minion || t.defId === c.minion) },
};

// ---------- Target selectors ----------
const minBy = (arr, f) => arr.reduce((best, x) => (best == null || f(x) < f(best) ? x : best), null);
const maxBy = (arr, f) => arr.reduce((best, x) => (best == null || f(x) > f(best) ? x : best), null);

export const SELECTORS = {
  self:                { label: 'Self', side: 'self', pick: (pool, b, u) => (pool.includes(u) ? [u] : []) },
  ally_lowest_hp_pct:  { label: 'Ally with lowest health %', side: 'ally', pick: pool => one(minBy(pool, hpPct)) },
  ally_lowest_hp:      { label: 'Ally with lowest health', side: 'ally', pick: pool => one(minBy(pool, a => a.hp)) },
  ally_highest_hp_pct: { label: 'Ally with highest health %', side: 'ally', pick: pool => one(maxBy(pool, hpPct)) },
  ally_random:         { label: 'Random living ally', side: 'ally', pick: (pool, b) => one(pool[Math.floor(b.rng() * pool.length)]) },
  ally_tank:           { label: 'Ally tank (fallback: lowest health %)', side: 'ally', pick: pool => one(pool.find(a => a.role === 'tank') || minBy(pool, hpPct)) },
  all_allies:          { label: 'All allies', side: 'ally', area: true, pick: pool => pool },
  own_minions:         { label: 'All my minions', side: 'ally', area: true, minions: true, pick: pool => pool },
  own_minion_lowest_hp:{ label: 'My minion with lowest health %', side: 'ally', minions: true, pick: pool => one(minBy(pool, hpPct)) },
  enemy_current:       { label: 'Current target (front-most enemy)', side: 'enemy', pick: pool => one(minBy(pool, e => e.position)) },
  enemy_lowest_hp_pct: { label: 'Enemy with lowest health %', side: 'enemy', pick: pool => one(minBy(pool, hpPct)) },
  enemy_lowest_hp:     { label: 'Enemy with lowest health', side: 'enemy', pick: pool => one(minBy(pool, e => e.hp)) },
  enemy_highest_hp:    { label: 'Enemy with highest health', side: 'enemy', pick: pool => one(maxBy(pool, e => e.hp)) },
  enemy_highest_threat:{ label: 'Enemy with highest threat', side: 'enemy', pick: (pool, b, u) => one(maxBy(pool, e => threatOf(e, u))) },
  enemy_random:        { label: 'Random enemy', side: 'enemy', pick: (pool, b) => one(pool[Math.floor(b.rng() * pool.length)]) },
  enemy_type:          { label: 'Specific enemy type', side: 'enemy', hasParam: true, pick: (pool, b, u, param) => one(minBy(pool.filter(e => e.tags?.includes(param) || e.defId === param), e => e.position)) },
  all_enemies:         { label: 'All enemies', side: 'enemy', area: true, pick: pool => pool },
};
function one(x) { return x ? [x] : []; }

// "Threat" from the point of view of `viewer`:
// - an enemy AI looks at its threat table (who has generated the most threat against it)
// - a player character rates enemies by how dangerous they are (boss/elite first, then damage output)
function threatOf(target, viewer) {
  if (viewer.threatTable) return viewer.threatTable[target.uid] || 0;
  if (hasStatus(target, 'taunting')) return 1e9;
  if (target.threatTable) return (target.danger || 0) + (target.threatTable[viewer.uid] || 0) * 0.001;
  return target.danger || 0;
}

export function selectorsForAbility(ability) {
  if (ability.target === 'self') return ['self'];
  const side = ability.target;
  return Object.entries(SELECTORS)
    .filter(([, s]) => (side === 'ally' ? s.side === 'ally' || s.side === 'self' : s.side === 'enemy'))
    .filter(([, s]) => (ability.area ? s.area : !s.area))
    .map(([id]) => id);
}

// ---------- Evaluation ----------
export function evalConditions(list, mode, battle, unit) {
  if (!list || list.length === 0) return true;
  const results = list.map(c => {
    let r;
    if (c.type === 'group') r = evalConditions(c.conditions, c.mode || 'all', battle, unit);
    else {
      const def = CONDITIONS[c.type];
      r = def ? !!def.test(c, battle, unit) : false;
    }
    return c.negate ? !r : r;
  });
  return mode === 'any' ? results.some(Boolean) : results.every(Boolean);
}

// Returns an array of targets, or null if the rule says "don't cast now".
export function resolveRule(rule, ability, battle, unit) {
  if (!rule || rule.enabled === false) return null;
  if (!evalConditions(rule.conditions, rule.mode || 'all', battle, unit)) return null;

  let selectorId = rule.target?.selector;
  const allowed = selectorsForAbility(ability);
  if (!allowed.includes(selectorId)) selectorId = allowed[0];
  const sel = SELECTORS[selectorId];
  let pool = sel.side === 'enemy' ? enemiesOf(battle, unit) : sel.minions ? ownMinions(battle, unit) : alliesOf(battle, unit);
  if (selectorId === 'self') pool = [unit];
  // Enemies being taunted must target the taunter with single-target attacks
  if (sel.side === 'enemy' && !sel.area && unit.threatTable) {
    const taunter = pool.find(p => hasStatus(p, 'taunting'));
    if (taunter && ability.effects.some(e => e.kind === 'damage')) pool = [taunter];
  }
  pool = pool.filter(t => (rule.targetConditions || []).every(tc => {
    const def = TARGET_CONDITIONS[tc.type];
    const r = def ? !!def.test(tc, t, battle, unit) : true;
    return tc.negate ? !r : r;
  }));
  if (pool.length === 0) return null;
  const targets = sel.pick(pool, battle, unit, rule.target?.param);
  return targets.length ? targets : null;
}

// Validate & sanitize a rule coming from a client. Returns a clean rule or throws.
export function sanitizeRule(raw, ability) {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid rule');
  const cleanCond = (c, registry, depth) => {
    if (!c || typeof c !== 'object') throw new Error('Invalid condition');
    if (c.type === 'group' && registry === CONDITIONS) {
      if (depth > 3) throw new Error('Conditions nested too deeply');
      const conds = Array.isArray(c.conditions) ? c.conditions.slice(0, 8) : [];
      return { type: 'group', mode: c.mode === 'any' ? 'any' : 'all', negate: !!c.negate, conditions: conds.map(x => cleanCond(x, registry, depth + 1)) };
    }
    const def = registry[c.type];
    if (!def) throw new Error(`Unknown condition: ${c.type}`);
    const out = { type: c.type };
    if (c.negate) out.negate = true;
    for (const p of def.params) out[p.key] = cleanParam(p, c[p.key]);
    return out;
  };
  const conditions = (Array.isArray(raw.conditions) ? raw.conditions : []).slice(0, 8).map(c => cleanCond(c, CONDITIONS, 0));
  const targetConditions = (Array.isArray(raw.targetConditions) ? raw.targetConditions : []).slice(0, 6).map(c => cleanCond(c, TARGET_CONDITIONS, 0));
  const allowed = selectorsForAbility(ability);
  const selector = allowed.includes(raw.target?.selector) ? raw.target.selector : allowed[0];
  const target = { selector };
  if (SELECTORS[selector].hasParam) target.param = String(raw.target?.param || 'boss').slice(0, 40);
  return { enabled: raw.enabled !== false, mode: raw.mode === 'any' ? 'any' : 'all', reserve: raw.reserve !== false, conditions, target, targetConditions };
}

function cleanParam(p, v) {
  if (p.type === 'number') {
    let n = Number(v);
    if (!Number.isFinite(n)) n = p.default;
    return Math.min(p.max, Math.max(p.min, n));
  }
  if (p.type === 'select') return p.options.some(o => o[0] === v) ? v : p.default;
  if (p.type === 'status') return STATUSES[v] ? v : p.default;
  if (p.type === 'minion') return v && MINIONS[v] ? v : '';
  return String(v ?? p.default).slice(0, 40);
}

export function describeCondition(c) {
  if (c.type === 'group') return `(${c.conditions.map(describeCondition).join(c.mode === 'any' ? ' OR ' : ' AND ')})`;
  const def = CONDITIONS[c.type] || TARGET_CONDITIONS[c.type];
  if (!def) return c.type;
  let s = def.format ? def.format(c) : def.label + def.params.map(p => {
    const v = c[p.key];
    if (p.type === 'select') return ' ' + (p.options.find(o => o[0] === v)?.[1] ?? v);
    if (p.type === 'status') return ' ' + (STATUSES[v]?.name ?? v);
    if (p.type === 'minion') return v ? ` ${MINIONS[v]?.name ?? v}` : '';
    return ` ${v}${p.suffix || ''}`;
  }).join('');
  return c.negate ? `NOT ${s}` : s;
}
