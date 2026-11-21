// Exact numbers of an ability for a character right now (abilities page, skill tree), worked out by the combat engine
// itself (previewAbility in shared/combat.js) — gear, skill tree, rank, mutators, crit and cooldown/cost modifiers.
import { esc, fmt, pct } from './ui.js';
import { makeCharacterUnit, previewAbility } from '/shared/combat.js';
import { STATUSES } from '/shared/data/statuses.js';

let cache = null; // building a unit computes all stats: reuse it for one render
function unitFor(ch) {
  if (cache?.ch !== ch || Date.now() - cache.at > 500) cache = { ch, at: Date.now(), u: makeCharacterUnit(ch, { ownerId: 'preview', ownerName: '', position: 0 }) };
  return cache.u;
}
export function abilityPreview(ch, abilityId, opts = {}) {
  try { return previewAbility(unitFor(ch), abilityId, opts); } catch (e) { console.warn('ability preview', e); return null; }
}

const sName = id => esc(STATUSES[id]?.name || id);
const secs = v => `${+v.toFixed(1)} s`;
function lineHtml(l) {
  switch (l.kind) {
    case 'damage': {
      const each = l.hits > 1 ? ' per hit' : '';
      return `<div>⚔ <b>${fmt(l.hit)}</b> ${esc(l.school)} damage${each}${l.hits > 1 ? ` × ${l.hits} = <b>${fmt(l.hit * l.hits)}</b>` : ''}${l.perSpent ? ' per point spent' : ''}${l.aoe ? ' to every enemy' : ''}</div>`
        + (l.crit != null ? `<div class="faint">✦ <b>${pct(l.crit)}</b> crit chance${l.bonusCrit ? ` (incl. +${pct(l.bonusCrit)} added base)` : ''} → <b>${fmt(l.critHit)}</b>${each} on a crit</div>` : '<div class="faint">✦ always crits under its condition</div>');
    }
    case 'heal': return `<div>✚ heals <b>${fmt(l.amount)}</b>${l.allies ? ' on every ally' : ''} <span class="faint">· ${pct(l.crit)} crit → ${fmt(l.critAmount)}</span></div>`;
    case 'shield': return `<div>🛡 absorbs <b>${fmt(l.amount)}</b> for ${secs(l.duration)}</div>`;
    case 'dot': return `<div>☠ ${sName(l.status)}: <b>${fmt(l.perSecond)}</b>/s for ${secs(l.duration)} = <b>${fmt(l.total)}</b>${l.stacks > 1 ? ` <span class="faint">(${l.stacks} stacks)</span>` : ''}${l.canCrit ? ` <span class="faint">· ticks crit ${pct(l.crit)}</span>` : ''}</div>`;
    case 'hot': return `<div>✚ ${sName(l.status)}: <b>${fmt(l.perSecond)}</b>/s for ${secs(l.duration)} = <b>${fmt(l.total)}</b></div>`;
    case 'consume': return `<div>☠ <b>${fmt(l.perSecondLeft)}</b> ${esc(l.school)} damage per second of damage over time it consumes</div>`;
    case 'status': return `<div>✧ ${sName(l.status)} for ${secs(l.duration)}${l.chance < 1 ? ` <span class="faint">(${pct(l.chance, 0)} chance)</span>` : ''}</div>`;
    default: return '';
  }
}

// the numbers block; title defaults to the rank shown
export function abilityStatsHtml(ch, abilityId, { rank = null, title = null } = {}) {
  const p = abilityPreview(ch, abilityId, { rank });
  if (!p) return '';
  const learned = (ch.abilities?.[abilityId] || 0) > 0;
  const head = title || (learned || rank ? `With your stats now (rank ${p.rank})` : 'If learned now (rank 1)');
  const body = p.lines.map(lineHtml).join('');
  const foot = [p.baseCooldown ? `⏱ ${secs(p.cooldown)} cooldown${p.cooldown < p.baseCooldown - 0.01 ? ` <span class="faint">(${secs(p.baseCooldown)})</span>` : ''}` : '', p.cost ? `${fmt(p.cost)} ${esc(p.resource)}` : ''].filter(Boolean).join(' · ');
  if (!body && !foot) return '';
  return `<div class="ability-stats"><span class="ability-stats-head">${esc(head)}:</span> <span class="faint">before enemy defense, each hit varies ±8%</span>${body}${foot ? `<div class="faint">${foot}</div>` : ''}</div>`;
}

// rank node: the numbers at the current rank → the next
export function abilityRankHtml(ch, abilityId) {
  const r = ch.abilities?.[abilityId] || 0;
  if (!r) return '';
  const a = abilityPreview(ch, abilityId, { rank: r }), b = abilityPreview(ch, abilityId, { rank: r + 1 });
  if (!a || !b) return '';
  const rows = [];
  a.lines.forEach((x, i) => {
    const y = b.lines[i];
    if (!y || y.kind !== x.kind) return;
    const ch2 = (label, k) => x[k] !== y[k] ? `${label} ${fmt(x[k])} → <span class="up">${fmt(y[k])}</span>` : '';
    const t = x.kind === 'damage' ? ch2(`⚔ ${x.hits > 1 ? 'per hit' : 'damage'}`, 'hit')
      : x.kind === 'heal' || x.kind === 'shield' ? ch2(x.kind === 'heal' ? '✚ heal' : '🛡 shield', 'amount')
      : x.kind === 'dot' || x.kind === 'hot' ? ch2(`${x.kind === 'dot' ? '☠' : '✚'} ${sName(x.status)} per second`, 'perSecond') : '';
    if (t) rows.push(`<div>${t}</div>`);
  });
  return rows.length ? `<div class="ability-stats"><span class="ability-stats-head">Rank ${r} → ${r + 1}:</span>${rows.join('')}</div>` : '';
}
