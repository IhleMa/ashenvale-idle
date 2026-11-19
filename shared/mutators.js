// Ability mutators: subclass skill-tree nodes that change how a base-class ability works
// (content/subclasses/<id>.json → branches[].mutators). A mutator names one ability and a set of changes:
//   power      +0.3  → every damage/heal/shield/over-time effect of the ability is 30 % stronger
//   cost       -5    → resource cost (never below 0)          cooldown  -2 → seconds (never below 0.5)
//   hits       +2    → extra hits on its damage effects      duration  +3 → seconds on its statuses/shields/taunts
//   bonusCrit  +0.2  → extra crit chance on its damage       executeBelow 0.45 → sets the execute threshold
//   effects    [...] → extra effects (same format as ability effects; "once": true = only on the first target,
//                      "self": true = on the caster)
import { ABILITIES } from './data/abilities.js';
import { STATUSES } from './data/statuses.js';

export const MUTATOR_CHANGES = ['power', 'cost', 'cooldown', 'hits', 'duration', 'bonusCrit', 'executeBelow', 'effects', 'set'];

const POWER_KINDS = new Set(['damage', 'heal', 'shield', 'status', 'sacrifice']);

// Returns a modified copy of an ability with all given change sets applied (in order).
export function applyMutators(ability, changeSets) {
  const ab = JSON.parse(JSON.stringify(ability));
  for (const ch of changeSets) {
    if (ch.cost) ab.cost = Math.max(0, (ab.cost || 0) + ch.cost);
    if (ch.cooldown) ab.cooldown = Math.max(0.5, (ab.cooldown || 0) + ch.cooldown);
    for (const e of ab.effects) {
      if (ch.power && POWER_KINDS.has(e.kind) && e.power != null) e.power = +(e.power * (1 + ch.power)).toFixed(4);
      if (e.kind === 'damage') {
        if (ch.hits) e.hits = (e.hits || 1) + ch.hits;
        if (ch.bonusCrit) e.bonusCrit = (e.bonusCrit || 0) + ch.bonusCrit;
        if (ch.executeBelow) { e.executeBelow = ch.executeBelow; e.executeMult = e.executeMult || 2; }
      }
      if (ch.duration && (e.kind === 'status' || e.kind === 'shield' || e.kind === 'taunt') && e.duration) e.duration += ch.duration;
    }
    // set: { "<effect kind>": { field: value } } → merged into the ability's effects of that kind (e.g. Reap's splash)
    for (const [kind, fields] of Object.entries(ch.set || {})) for (const e of ab.effects) if (e.kind === kind) Object.assign(e, fields);
    if (ch.effects?.length) ab.effects.push(...JSON.parse(JSON.stringify(ch.effects)));
  }
  return ab;
}

const sgn = v => (v > 0 ? `+${v}` : `−${Math.abs(v)}`);
const pct = v => `${v > 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)}%`;

function describeEffect(e) {
  const who = e.self ? ' on yourself' : '';
  switch (e.kind) {
    case 'status': return `applies ${STATUSES[e.status]?.name || e.status}${who} for ${e.duration}s`;
    case 'damage': return `deals an extra ${Math.round(e.power * 100)}% ${e.school || ''} damage`.replace('  ', ' ');
    case 'heal': return `heals${e.self ? ' you' : ''} for ${Math.round(e.power * 100)}% healing power`;
    case 'shield': return `shields${who} for ${Math.round(e.power * 100)}% power (${e.duration}s)`;
    case 'taunt': return `taunts enemies for ${e.duration}s`;
    case 'resource': return `restores ${e.amount} resource`;
    case 'cleanse': return `removes ${e.count || 1} debuff${(e.count || 1) > 1 ? 's' : ''}`;
    default: return e.kind;
  }
}

// Short list of what a mutator does, e.g. ["+1s duration", "−4s cooldown", "applies Bleed for 6s"]
export function describeChanges(ch) {
  const out = [];
  if (ch.power) out.push(`${pct(ch.power)} effect`);
  if (ch.hits) out.push(`${sgn(ch.hits)} hit${Math.abs(ch.hits) > 1 ? 's' : ''}`);
  if (ch.bonusCrit) out.push(`${pct(ch.bonusCrit)} crit chance`);
  if (ch.executeBelow) out.push(`execute below ${Math.round(ch.executeBelow * 100)}% health`);
  if (ch.duration) out.push(`${sgn(ch.duration)}s duration`);
  if (ch.cooldown) out.push(`${sgn(ch.cooldown)}s cooldown`);
  if (ch.cost) out.push(`${sgn(ch.cost)} cost`);
  for (const fields of Object.values(ch.set || {})) {
    if (fields.all) out.push('detonates every minion you have at once');
    if (fields.splash) out.push(`also hits every other enemy for ${Math.round(fields.splash * 100)}% of the damage`);
    if (fields.refundPerStack) out.push(`refunds ${fields.refundPerStack} resource per effect consumed`);
    if (fields.lifesteal) out.push(`heals for ${Math.round(fields.lifesteal * 100)}% of the damage`);
  }
  for (const e of ch.effects || []) out.push(describeEffect(e));
  return out;
}

export const mutatorAbilityName = m => ABILITIES[m.ability]?.name || m.ability;
