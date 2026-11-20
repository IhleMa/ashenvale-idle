// Minion stats as they would be if summoned right now (see shared/minionPreview.js) — skill tree and abilities page.
import { esc, fmt } from './ui.js';
import { minionPreview, minionNodeDelta, isMinionAbility } from '/shared/minionPreview.js';
export { isMinionAbility };

const ROLE = { tank: '🛡 tank', healer: '✚ healer', damage: '⚔ damage' };
const pctTxt = v => `${Math.round(v * 100)}%`;
const line = m => `<b>${esc(m.name)}</b> <span class="muted">${ROLE[m.role] || esc(m.role)} · ×${m.count} per cast, up to ${m.max}</span><br>`
  + `❤ ${fmt(m.hp)} health · ⚔ ${esc(m.attackName)} ~${fmt(m.hit)} ${esc(m.school)} per hit, ${m.attackSpeed.toFixed(1)}/s`
  + ` · ${fmt(m.defense)} defense · ${pctTxt(m.critChance)} crit${m.duration ? ` · lasts ${Math.round(m.duration)} s` : ''}`;

// title: e.g. 'If summoned now' ; rank: show at this rank (default: current, or 1 if not learned)
export function minionStatsHtml(ch, abilityId, { rank = null, title = null } = {}) {
  const list = minionPreview(ch, abilityId, { rank });
  if (!list.length) return '';
  const learned = (ch.abilities?.[abilityId] || 0) > 0;
  const head = title || (learned ? `If summoned now (rank ${list[0].rank})` : 'If learned now (rank 1)');
  const bonus = list[0].damagePct ? ` <span class="faint">damage includes +${pctTxt(list[0].damagePct)} minion damage; before enemy defense</span>` : ' <span class="faint">before enemy defense</span>';
  return `<div class="minion-now"><span class="minion-now-head">${esc(head)}:</span>${bonus}${list.map(m => `<div>${line(m)}</div>`).join('')}</div>`;
}

// rank node of a summon ability: the minion at the current rank → the next one
export function minionRankHtml(ch, abilityId) {
  const r = ch.abilities?.[abilityId] || 0;
  if (!r) return '';
  const a = minionPreview(ch, abilityId, { rank: r }), b = minionPreview(ch, abilityId, { rank: r + 1 });
  if (!a.length) return '';
  return `<div class="minion-now"><span class="minion-now-head">Rank ${r} → ${r + 1}:</span>${a.map((m, i) => `<div><b>${esc(m.name)}</b>: ❤ ${fmt(m.hp)} → <span class="up">${fmt(b[i].hp)}</span> health · ~${fmt(m.hit)} → <span class="up">${fmt(b[i].hit)}</span> per hit</div>`).join('')}</div>`;
}

// a node with minion stats: each of your minions before → after it
export function minionNodeHtml(ch, nodeId, taken) {
  const d = minionNodeDelta(ch, nodeId);
  if (!d.length) return '';
  const parts = ({ before, after }) => [
    before.hp !== after.hp && `❤ ${fmt(before.hp)} → <span class="up">${fmt(after.hp)}</span> health`,
    before.hit !== after.hit && `~${fmt(before.hit)} → <span class="up">${fmt(after.hit)}</span> per hit`,
    before.max !== after.max && `up to ${before.max} → <span class="up">${after.max}</span>`,
    Math.round(before.duration) !== Math.round(after.duration) && `${Math.round(before.duration)} s → <span class="up">${Math.round(after.duration)} s</span>`,
  ].filter(Boolean).join(' · ');
  const rows = d.map(x => ({ name: x.before.name, t: parts(x) })).filter(x => x.t);
  if (!rows.length) return '';
  return `<div class="minion-now"><span class="minion-now-head">Your minions ${taken ? 'with this node (vs. without)' : 'if you take this'}:</span>${rows.map(x => `<div><b>${esc(x.name)}</b>: ${x.t}</div>`).join('')}</div>`;
}
