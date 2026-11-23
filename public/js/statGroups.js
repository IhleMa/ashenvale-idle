// Editor for stat filter groups (And / Not / Count / Weighted sum, like the Path of Exile trade site) — shared by the
// inventory highlight and the Auction House search. The matching itself is in shared/statFilter.js.
// The host renders statGroupsHtml(groups) + addGroupSelect() and forwards click / change / input events:
//   onGroupsClick / onGroupsChange return 'structure' (re-render) or 'value' (just re-filter), onGroupsInput true/false.
import { esc, tipAttr } from './ui.js';
import { PCT_STATS, AFFIXES, AFFIX_TIERS } from '/shared/data/items.js';
import { GROUP_TYPES } from '/shared/statFilter.js';

// stat and tier pickers (also used by other filters)
export const statOptions = sel => ['prefix', 'suffix'].map(type => `<optgroup label="${type === 'prefix' ? 'Prefixes' : 'Suffixes'}">${Object.entries(AFFIXES).filter(([, a]) => a.type === type).sort((x, y) => x[1].label.localeCompare(y[1].label) || (x[1].pct ? 1 : -1)).map(([k, a]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${esc(a.label)}${a.pct && ['str', 'int', 'dex', 'vit', 'defense'].some(f => k === f + 'Pct') ? ' %' : ''}</option>`).join('')}</optgroup>`).join('');
export const tierOptions = (sel, any = 'Any tier') => `<option value="">${any}</option>${AFFIX_TIERS.map(t => `<option value="${t.tier}" ${String(sel) === String(t.tier) ? 'selected' : ''}>T${t.tier}${t.tier > 1 ? ' or better' : ''}</option>`).join('')}`;

const newRow = () => ({ stat: '', min: '', max: '', tier: '', weight: '', off: false });
const v = x => esc(x ?? '');

export function addGroupSelect() {
  return `<select data-sg-add ${tipAttr('Add a group of stat filters, like on the Path of Exile trade site')}><option value="">＋ Stat group…</option>${Object.entries(GROUP_TYPES).map(([k, t]) => `<option value="${k}">${t.label} — ${esc(t.hint.toLowerCase())}</option>`).join('')}</select>`;
}

export function statGroupsHtml(groups) {
  return groups.map((g, gi) => `<div class="hl-group hl-g-${g.type}">
    <div class="row gap small">
      <select data-g="${gi}" data-gf="type" ${tipAttr(esc(GROUP_TYPES[g.type].hint))}>${Object.entries(GROUP_TYPES).map(([k, t]) => `<option value="${k}" ${g.type === k ? 'selected' : ''}>${t.label}</option>`).join('')}</select>
      ${g.type === 'count' || g.type === 'weight' ? `<label class="inline">min <input type="number" step="any" class="af-min" data-g="${gi}" data-gf="min" value="${v(g.min)}" placeholder="${g.type === 'count' ? '1' : 'any'}"></label>
        <label class="inline">max <input type="number" step="any" class="af-min" data-g="${gi}" data-gf="max" value="${v(g.max)}" placeholder="any"></label>` : ''}
      <span class="grow"></span>
      <button class="btn tiny" data-sg-addrow="${gi}">＋ Stat</button>
      <button class="btn tiny ghost danger" data-sg-del="${gi}" title="Remove group">✕</button>
    </div>
    ${g.rows.map((r, ri) => `<div class="row gap small hl-row ${r.off ? 'off' : ''}">
      <input type="checkbox" data-g="${gi}" data-r="${ri}" data-rf="on" ${r.off ? '' : 'checked'} title="Use this stat">
      <select data-g="${gi}" data-r="${ri}" data-rf="stat"><option value="">Choose a stat…</option>${statOptions(r.stat)}</select>
      <input type="number" step="any" class="af-min" data-g="${gi}" data-r="${ri}" data-rf="min" value="${v(r.min)}" placeholder="min" title="Minimum${r.stat && PCT_STATS.has(r.stat) ? ' (in %)' : ''}">
      <input type="number" step="any" class="af-min" data-g="${gi}" data-r="${ri}" data-rf="max" value="${v(r.max)}" placeholder="max" title="Maximum${r.stat && PCT_STATS.has(r.stat) ? ' (in %)' : ''}">
      ${g.type === 'weight' ? `<input type="number" step="any" class="af-min" data-g="${gi}" data-r="${ri}" data-rf="weight" value="${v(r.weight)}" placeholder="×1" title="Weight: the value counts this many times">` : ''}
      <select data-g="${gi}" data-r="${ri}" data-rf="tier">${tierOptions(r.tier, 'Any tier')}</select>
      <button class="btn tiny ghost danger" data-g="${gi}" data-sg-rdel="${ri}" title="Remove">✕</button></div>`).join('')}
  </div>`).join('');
}

export function onGroupsClick(groups, el) {
  const d = el.dataset;
  if (d.sgAddrow != null) { const g = groups[Number(d.sgAddrow)]; if (g && g.rows.length < 10) g.rows.push(newRow()); return 'structure'; }
  if (d.sgDel != null) { groups.splice(Number(d.sgDel), 1); return 'structure'; }
  if (d.sgRdel != null) { groups[Number(d.g)]?.rows.splice(Number(d.sgRdel), 1); return 'structure'; }
  return null;
}
export function onGroupsChange(groups, el) {
  const d = el.dataset;
  if (el.matches('[data-sg-add]')) {
    if (el.value && groups.length < 8) groups.push({ type: el.value, min: '', max: '', rows: [newRow()] });
    el.value = '';
    return 'structure';
  }
  const g = groups[Number(d.g)];
  if (!g) return null;
  if (d.gf === 'type') { g.type = el.value; return 'structure'; }
  const r = g.rows[Number(d.r)];
  if (!r) return null;
  if (d.rf === 'stat') { r.stat = el.value; return 'structure'; }
  if (d.rf === 'on') { r.off = !el.checked; return 'structure'; }
  if (d.rf === 'tier') { r.tier = el.value; return 'value'; }
  return null;
}
export function onGroupsInput(groups, el) {
  const d = el.dataset, g = groups[Number(d.g)];
  if (!g) return false;
  if (d.gf === 'min' || d.gf === 'max') { g[d.gf] = el.value; return true; }
  const r = g.rows[Number(d.r)];
  if (r && (d.rf === 'min' || d.rf === 'max' || d.rf === 'weight')) { r[d.rf] = el.value; return true; }
  return false;
}
