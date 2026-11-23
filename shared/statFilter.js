// Stat filter groups like the Path of Exile trade site (used by the inventory highlight and saved filters).
// A filter is a list of groups; an item matches when every group (that has stats in it) matches:
//   and    — the item has every stat row
//   not    — the item has none of the stat rows
//   count  — at least `min` (and at most `max`) of the stat rows
//   weight — the sum of value × weight over the rows the item has is between `min` and `max`
// A row: { stat, min, max, tier, weight, off }. min/max are in the stat's display unit (percent for % stats);
// tier = the affix must be at least that tier (1 = best); off = row switched off.
import { PCT_STATS } from './data/items.js';

export const GROUP_TYPES = {
  and: { label: 'And', hint: 'The item must have all of these' },
  not: { label: 'Not', hint: 'The item must have none of these' },
  count: { label: 'Count', hint: 'The item must have at least min (and at most max) of these' },
  weight: { label: 'Weighted sum', hint: 'Adds up value × weight of the stats the item has; the sum must be between min and max' },
};

const num = v => (v === '' || v == null || !Number.isFinite(+v) ? null : +v);
const shown = (stat, v) => (PCT_STATS.has(stat) ? v * 100 : v); // value as the player types it
const liveRows = g => (g.rows || []).filter(r => r.stat && !r.off);
export const groupsActive = groups => (groups || []).some(g => liveRows(g).length);

// stats: the item's total stats (gearItemStats); affixes for tier checks come from the item
export function matchStatGroups(item, groups, stats) {
  const has = r => {
    const v = shown(r.stat, stats[r.stat] || 0);
    if (!v) return false;
    const lo = num(r.min), hi = num(r.max);
    if (lo != null && v < lo - 1e-9) return false;
    if (hi != null && v > hi + 1e-9) return false;
    if (r.tier && !(item.affixes || []).some(a => a.stat === r.stat && a.tier <= Number(r.tier))) return false;
    return true;
  };
  for (const g of groups || []) {
    const rows = liveRows(g);
    if (!rows.length) continue;
    const lo = num(g.min), hi = num(g.max);
    if (g.type === 'not') { if (rows.some(has)) return false; }
    else if (g.type === 'count') { const c = rows.filter(has).length; if (c < (lo ?? 1) || (hi != null && c > hi)) return false; }
    else if (g.type === 'weight') {
      const sum = rows.reduce((s, r) => s + shown(r.stat, stats[r.stat] || 0) * (num(r.weight) ?? 1), 0);
      if ((lo != null && sum < lo - 1e-9) || (hi != null && sum > hi + 1e-9)) return false;
    } else if (!rows.every(has)) return false; // and
  }
  return true;
}

// sanitised copy (server side for saved filters); old highlight format { rows, mode } becomes one group
export function cleanGroups(groups, legacy = null) {
  const str = (v, n) => String(v ?? '').slice(0, n);
  const n = v => (num(v) == null ? '' : num(v));
  if (!Array.isArray(groups) && legacy?.rows) groups = [{ type: legacy.mode === 'any' ? 'count' : 'and', rows: legacy.rows }];
  return (Array.isArray(groups) ? groups : []).slice(0, 8).map(g => ({
    type: GROUP_TYPES[g?.type] ? g.type : 'and', min: n(g?.min), max: n(g?.max),
    rows: (Array.isArray(g?.rows) ? g.rows : []).slice(0, 10).map(r => ({
      stat: str(r?.stat, 30), min: n(r?.min), max: n(r?.max), tier: /^[1-7]?$/.test(String(r?.tier ?? '')) ? String(r?.tier ?? '') : '',
      weight: n(r?.weight), off: !!r?.off,
    })),
  }));
}
