// Plain-language descriptions of ability effects and statuses — the wiki and the abilities page use them.
// effText can show an ability at a rank (×(1 + rank bonus) on damage, healing, shields and over-time effects) and,
// given the caster's stats, the real amounts.
import { CONFIG } from './config.js';
import { CLASSES } from './data/classes.js';
import { STATUSES } from './data/statuses.js';
import { MINIONS } from './data/minions.js';
import { ENEMIES } from './data/enemies.js';
import { ABILITIES } from './data/abilities.js';

export const pct = (v, d = 0) => `${(Math.round(v * 100 * 10 ** d) / 10 ** d)}%`;
export const signed = v => `${v > 0 ? '+' : ''}${pct(v)}`;
const STAT = { physPower: 'physical power', magPower: 'magic power', healPower: 'healing power', maxHp: 'maximum health', defense: 'defense', hp: 'health', critChance: 'critical chance', attackSpeed: 'attack speed' };
export const statName = s => STAT[s] || s || 'power';
export const sec = s => `${Math.round(s * 10) / 10} s`;
const resourceName = classId => CLASSES[classId]?.resource?.name || 'resource';

const MOD_TEXT = {
  damagePct: v => `${signed(v)} damage dealt`, damageTakenPct: v => `${signed(v)} damage taken`, defensePct: v => `${signed(v)} defense`,
  attackSpeedPct: v => `${signed(v)} attack and cast speed`, healingTakenPct: v => `${signed(v)} healing received`, healingDonePct: v => `${signed(v)} healing done`,
  dotTakenPct: v => `${signed(v)} damage taken from damage over time`, dotSpeedPct: v => `own damage over time ticks ${signed(v)} faster`, dodge: v => `${pct(v)} chance to dodge physical hits`,
  thornsPct: v => `attackers take ${pct(v)} of their hit back`, invulnerable: () => 'takes no damage', undying: () => 'cannot drop below 1 health',
  cooldownRatePct: v => `cooldowns run ${signed(v)} faster`, resourceRegenPct: v => `${signed(v)} resource regeneration`, threatPct: v => `${signed(v)} threat`,
  critChance: v => `${signed(v)} critical chance`, reactionPct: v => `next reaction ${signed(v)} stronger`, chainReaction: () => 'reactions repeat on another enemy at half strength',
  costPct: v => `abilities cost ${signed(v)}`,
};
export const modsText = mods => Object.entries(mods || {}).map(([k, v]) => (MOD_TEXT[k] ? MOD_TEXT[k](v) : `${k} ${v}`));

export function statusFacts(id) {
  const s = STATUSES[id];
  if (!s) return [];
  const f = [];
  if (s.tick === 'damage') f.push(`deals ${s.school || 'physical'} damage every second${s.ignoreArmor ? ', ignores armor' : ''}${s.canCrit ? ', each tick can crit' : ', ticks never crit'}`);
  if (s.tick === 'heal') f.push('heals every second');
  f.push(...modsText(s.mods));
  if (s.maxStacks) f.push(`stacks up to ${s.maxStacks}×`);
  if (s.stacking === 'independent') f.push('no stack limit: every application is a separate stack with its own timer');
  if (s.group) f.push(`only one "${s.group}" per caster at a time`);
  if (s.control === 'stun') f.push(`cannot act${s.bossDurationMult != null && s.bossDurationMult !== 1 ? `; lasts ${pct(s.bossDurationMult)} as long on bosses` : ''}`);
  if (s.element) f.push(`${s.element} element mark`);
  if (s.charge) f.push(s.charge === 'both' ? 'counts as Edge and Arcana for every ability' : `${s.charge === 'edge' ? 'Edge' : 'Arcana'} charge`);
  if (s.freeCast) f.push('the next ability costs nothing');
  if (s.volatile) f.push('the next element flask lands on every enemy');
  if (s.jumpOnDeath) f.push('jumps to another enemy when its target dies');
  if (s.tickOnApply) f.push('first tick right away');
  if (s.resourceVsStatus) f.push(`every direct hit on an enemy with ${STATUSES[s.resourceVsStatus]?.name || s.resourceVsStatus} restores ${s.resourceAmount} resource`);
  if (s.recordDamage) f.push(`records the caster's damage; deals ${pct(s.explodePct ?? 1)} of it again when it expires`);
  return f;
}

// opts: { rank, stats (computeStats of the caster: adds the real amount), statusName(id), minionName(id) }
export function effText(eff, classId, opts = {}) {
  const rm = 1 + CONFIG.abilityRankBonus * ((opts.rank || 1) - 1);
  const st = opts.stats;
  const statusLink = opts.statusName || (id => STATUSES[id]?.name || id);
  const esc = opts.escape || (x => x);
  const amount = (power, stat, mult = 1) => (st ? ` (≈ ${Math.round(power * rm * mult * ((stat === 'maxHp' ? st.maxHp : st[stat]) || 0)).toLocaleString('en')})` : '');
  const pw = (power, stat, mult = 1) => `${pct(power * rm)} of ${statName(stat)}${amount(power, stat, mult)}`;
  switch (eff.kind) {
    case 'damage': {
      const hits = eff.hits || 1;
      let t = `deals ${pw(eff.power * hits, eff.stat)}${eff.perSpent ? ` per point of ${resourceName(classId)} spent` : ''} as ${eff.school || 'physical'} damage${hits > 1 ? ` in ${hits} hits` : ''}`;
      if (eff.bonusCrit) t += ` (${signed(eff.bonusCrit)} critical chance)`;
      const exB = (eff.executeBelowByRank ? eff.executeBelowByRank[Math.min(eff.executeBelowByRank.length, opts.rank || 1) - 1] : eff.executeBelow || 0) + (eff.executeBelowAdd || 0);
      if (exB) t += eff.executeStacks ? `; against targets below ${pct(exB)} health +${pct(eff.executeStacks.perStack)} for every ${statusLink(eff.executeStacks.status)} stack on them` : `, ×${eff.executeMult || 2} against targets below ${pct(exB)} health`;
      if (eff.splash) t += `, and ${pct(eff.splash)} of that to every other enemy`;
      if (eff.critResource) t += `; a critical hit refunds ${eff.critResource} ${resourceName(classId)}`;
      if (eff.critIfStatus) t += `; always crits against targets with ${statusLink(eff.critIfStatus)}`;
      if (eff.followUp) t += `; against targets below ${pct(eff.followUp.below)} health it hits again for ${pct(eff.followUp.mult)}`;
      if (eff.killCooldownRefund) t += `; a kill gives back ${pct(eff.killCooldownRefund)} of the cooldown`;
      if (eff.onHitIfStatus) t += `; every hit on a target with ${statusLink(eff.onHitIfStatus.status)} also ${(eff.onHitIfStatus.effects || []).map(e => effText(e, classId, { ...opts, withStatus: false }).replace(/^applies/, 'adds')).join(', ')}`;
      if (eff.lifesteal || eff.lifestealPerDebuff) t += `, healing the caster for ${pct(eff.lifesteal || 0)}${eff.lifestealPerDebuff ? ` + ${pct(eff.lifestealPerDebuff)} per own debuff on the target` : ''} of the damage`;
      return t;
    }
    case 'heal': return `heals ${eff.allies ? 'every ally ' : eff.self ? 'the caster ' : ''}for ${pw(eff.power, eff.stat)}`;
    case 'status': {
      const s = STATUSES[eff.status];
      const dur = eff.duration >= 900 ? 'until changed' : `for ${sec(eff.duration)}`;
      let t = `${eff.chance ? `${pct(eff.chance)} chance to ` : ''}${eff.self ? 'gain' + (eff.chance ? '' : 's') : 'appl' + (eff.chance ? 'y' : 'ies')} ${statusLink(eff.status)}${eff.allEnemies ? ' on every enemy' : ''} ${dur}`;
      const x = eff.extra || {};
      const extras = [x.absorbShieldPct && `a shield worth ${pct(x.absorbShieldPct)} of the damage it prevented when it ends`, x.hitCooldown && `every hit lowers ${x.hitCooldown.ability.replace(/_/g, ' ')}'s cooldown by ${x.hitCooldown.seconds} s`,
        x.spawnChance && `each tick has a ${pct(x.spawnChance)} chance to add a stack`, x.spreadOnDeath && 'spreads to another enemy when the target dies', x.linkHealPct && `you heal for ${pct(x.linkHealPct)} of the damage they take`, x.freeCooldown && 'the next ability after it has no cooldown', x.dodgeResource && `every dodged hit restores ${x.dodgeResource} ${resourceName(classId)}`].filter(Boolean);
      if (s?.tick && eff.power) t += ` (${pw(eff.power, eff.stat, s.tick === 'damage' ? 1 + (st?.dotDamagePct || 0) : 1)} ${s.tick === 'heal' ? 'healing' : 'damage'} per second${s.maxStacks ? ' per stack' : ''})`;
      else if (opts.withStatus && s) { const facts = statusFacts(eff.status).filter(x => !/^stacks up to/.test(x)); if (facts.length) t += ` (${facts.join(', ')})`; }
      if (eff.stacks > 1) t += ` ×${eff.stacks}`;
      if (extras.length) t += `; ${extras.join('; ')}`;
      return t;
    }
    case 'shield': return `${eff.self ? 'shields the caster' : 'shields'} for ${pw(eff.power, eff.stat)} for ${sec(eff.duration)}`;
    case 'taunt': return `taunts enemies for ${sec(eff.duration || 0)}`;
    case 'cleanse': return (eff.count || 1) >= 99 ? 'removes all harmful effects' : `removes up to ${eff.count || 1} harmful effect${(eff.count || 1) > 1 ? 's' : ''}`;
    case 'counter': return `every ${['', '', 'second', 'third', 'fourth', 'fifth'][eff.every || 3] || `${eff.every}th`} use on the same target also ${(eff.effects || []).map(e => effText(e, classId, { ...opts, withStatus: false })).join(', ')}`;
    case 'resource': return `gives ${eff.amount} ${resourceName(classId)}`;
    case 'summon': {
      const od = eff.onDeath || {};
      const death = [od.ownerShieldPct && `when it dies you get a shield worth ${pct(od.ownerShieldPct)} of its maximum health`, od.explode && `when it dies it explodes for ${pct(od.explode.power)} of your ${statName(od.explode.stat || 'magPower')} on every enemy`].filter(Boolean);
      return (eff.minion ? `summons ${eff.count || 1}× ${esc(MINIONS[eff.minion]?.name || eff.minion)}${eff.max ? ` (up to ${eff.max}; at the limit the oldest is renewed)` : ''}` : `summons ${esc(ENEMIES[eff.enemyId]?.name || eff.enemyId)}`) + (death.length ? `; ${death.join('; ')}` : '');
    }
    case 'sacrifice': return `detonates ${eff.all ? 'every minion' : `${eff.count || 1} minion${(eff.count || 1) > 1 ? 's' : ''} (the one closest to fading first)`}, each dealing ${pct(eff.power)} of its maximum health to every enemy`;
    case 'extend': return `makes the minion last ${sec(eff.seconds)} longer`;
    case 'consume_dots': return `removes ${eff.own ? 'its own' : 'all'} damage over time on the target and deals ${pw(eff.power, eff.stat)} for every second they had left${eff.mark ? `; ×${eff.markMult} on targets with ${statusLink(eff.mark)}${eff.markExecute ? `, which also kills non-bosses below ${pct(eff.markExecute)} health` : ''}` : ''}${eff.splash ? `; ${pct(eff.splash)} of it splashes to other enemies` : ''}${eff.refundPerStack ? `; refunds ${eff.refundPerStack} ${resourceName(classId)} per stack` : ''}`;
    case 'spread_dots': return 'copies its own damage over time effects from the target to every other enemy';
    case 'self_damage': return `costs ${pct(eff.pct)} of current health (never lethal)${eff.refundOver ? `, which comes back as healing over ${eff.refundOver} s` : ''}`;
    case 'revive': return `brings a fallen ally back with ${pct(eff.pct)} health`;
    case 'rewind': return `sets health back to what it was ${sec(eff.seconds)} ago (only if that was more)`;
    case 'echo': return `deals ${pct(eff.power)} of the health the target lost in the last ${sec(eff.seconds)} again`;
    case 'reduce_cooldowns': return `cuts every cooldown of ${eff.self ? 'the caster' : 'the target'} by ${sec(eff.seconds)}`;
    case 'prolong': return `makes the party's buffs and its debuffs on enemies last ${sec(eff.seconds)} longer`;
    case 'finale': return 'plays back the last three notes (see Finales below)';
    default: return eff.kind;
  }
}


// What an ability does for this character right now: its rank, skill-tree mutators and rank effects applied, with the
// real amounts from the character's stats (before crits, armor and other modifiers).
export function abilityNow(ch, abilityId, { stats = null, defs = null } = {}) {
  const ab = (defs || {})[abilityId] || ABILITIES[abilityId];
  if (!ab) return '';
  const rank = ch.abilities?.[abilityId] || 1;
  const parts = ab.effects.map(e => effText(e, ab.classId, { rank, stats, withStatus: true }));
  const t = parts.map(x => x[0].toUpperCase() + x.slice(1)).join('. ');
  return t ? t + '.' : '';
}
