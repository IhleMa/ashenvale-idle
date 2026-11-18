// Damage meter panel (rankings + detailed per-unit breakdown).
import { esc, fmt, duration } from '../ui.js';
import { classIcon, enemyArt, abilityIcon, minionArt } from '../assets.js';
import { CLASSES } from '/shared/data/classes.js';
import { ABILITIES } from '/shared/data/abilities.js';

export const meterUI = { mode: 'damage', scope: 'current', side: 'party', selected: null };

const MODES = {
  damage: { label: 'Damage', value: u => u.dmg.total, rate: 'DPS' },
  healing: { label: 'Healing', value: u => u.heal.total, rate: 'HPS' },
  taken: { label: 'Taken', value: u => u.taken.total, rate: 'DTPS' },
  casts: { label: 'Casts', value: u => Object.values(u.casts).reduce((a, b) => a + b, 0), rate: '/min' },
};

const pctTxt = (a, b) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : '—');
const per = (v, sec) => fmt(v / Math.max(1, sec));
const color = u => (u.side === 'A' ? CLASSES[u.classId]?.color || '#8fd3ff' : u.boss ? '#d9452b' : '#a86b4a');

function icon(u) { return u.minions ? minionArt(u.defId, 'xxs') : u.side === 'A' ? classIcon(u.classId, 'xxs') : enemyArt(u.defId, 'xxs'); }

function labels(units) {
  // number duplicate names ("Grey Wolf", "Grey Wolf #2")
  const seen = {};
  const out = {};
  for (const u of units) {
    seen[u.name] = (seen[u.name] || 0) + 1;
    out[u.key] = seen[u.name] > 1 ? `${u.name} #${seen[u.name]}` : u.name;
  }
  for (const u of units) if (seen[u.name] > 1 && out[u.key] === u.name) out[u.key] = `${u.name} #1`;
  return out;
}

export function renderMeterPanel(host, meter, { myId, coop, running }) {
  const mode = MODES[meterUI.mode];
  const head = `<div class="panel-head"><h3>Damage meter</h3>
    <div class="row gap">
      <select data-meter-scope title="Which fights to include">${[['current', running ? 'Current fight' : 'Latest fight'], ['last', 'Last completed'], ['session', 'Session total']].map(([v, l]) => `<option value="${v}" ${meterUI.scope === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select data-meter-side>${[['party', 'My side'], ['enemies', 'Enemies'], ['all', 'Everyone']].map(([v, l]) => `<option value="${v}" ${meterUI.side === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      ${meterUI.scope === 'session' ? '<button class="btn tiny ghost" data-meter-reset title="Clear session totals">Reset</button>' : ''}
    </div></div>
    <div class="meter-tabs">${Object.entries(MODES).map(([id, m]) => `<button class="tab small ${meterUI.mode === id ? 'active' : ''}" data-meter-mode="${id}">${m.label}</button>`).join('')}</div>`;
  if (!meter || !Object.keys(meter.units).length) {
    host.innerHTML = head + '<p class="muted small pad-s">No combat data yet.</p>';
    return;
  }
  const sec = meter.duration;
  const all = Object.values(meter.units);
  const names = labels(all);
  const party = all.filter(u => u.side === 'A');
  const sum = (list, f) => list.reduce((a, u) => a + f(u), 0);
  const summary = `<div class="meter-summary small">
    <span><b>${duration(sec)}</b> ${meter.fights ? `· ${meter.fights} fight${meter.fights > 1 ? 's' : ''}` : ''}</span>
    <span>Party DPS <b>${per(sum(party, u => u.dmg.total), sec)}</b></span>
    <span>Party HPS <b>${per(sum(party, u => u.heal.total), sec)}</b></span>
    <span>Damage taken <b>${fmt(sum(party, u => u.taken.total))}</b></span>
    <span>Deaths <b>${sum(party, u => u.deaths)}</b></span>
  </div>`;
  let list = all.filter(u => meterUI.side === 'all' || (meterUI.side === 'party' ? u.side === 'A' : u.side === 'B'));
  list = list.map(u => ({ u, v: mode.value(u) })).filter(x => x.v > 0 || x.u.side === 'A').sort((a, b) => b.v - a.v);
  const total = list.reduce((a, x) => a + x.v, 0);
  const top = list[0]?.v || 1;
  const rows = list.map((x, i) => {
    const u = x.u;
    const rate = meterUI.mode === 'casts' ? `${(x.v / Math.max(1, sec / 60)).toFixed(1)}/min` : `${per(x.v, sec)} ${mode.rate}`;
    const extra = meterUI.mode === 'healing' && u.heal.over ? ` <span class="faint">(${pctTxt(u.heal.over, u.heal.total + u.heal.over)} over)</span>` : '';
    return `<button class="meter-row ${meterUI.selected === u.key ? 'active' : ''} ${coop && u.ownerId && u.ownerId === myId ? 'mine' : ''}" data-meter-unit="${esc(u.key)}" style="--pct:${(x.v / top) * 100}%; --cc:${color(u)}">
      <span class="mr-rank">${i + 1}</span>${icon(u)}
      <span class="mr-name">${u.isMain ? '★ ' : ''}${esc(names[u.key])}${coop && u.ownerName ? ` <small class="faint">${esc(u.ownerName)}</small>` : ''}</span>
      <span class="mr-val"><b>${fmt(x.v)}</b>${extra} <small>${rate} · ${pctTxt(x.v, total)}</small></span>
    </button>`;
  }).join('');
  const sel = meterUI.selected && meter.units[meterUI.selected];
  host.innerHTML = head + summary + `<div class="meter-rows">${rows || '<p class="muted small">Nothing recorded for this view.</p>'}</div>` + (sel ? detail(sel, names[sel.key] || sel.name, sec) : '<p class="faint small center">Click a row for a detailed breakdown.</p>');
}

function table(cols, rows, total) {
  if (!rows.length) return '<p class="muted small">Nothing recorded.</p>';
  return `<table class="meter-table"><thead><tr>${cols.map(c => `<th class="${c.num ? 'num' : ''}">${c.label}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${cols.map((c, i) => `<td class="${c.num ? 'num' : ''}">${i === 0 ? `<span class="cellbar" style="width:${total > 0 ? (r._v / total) * 100 : 0}%"></span>` : ''}${c.get(r)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function abilityCell(key, label) {
  const id = key.includes('|') ? key.split('|')[1] : key;
  const ic = ABILITIES[id] ? abilityIcon(id, 'xxs') : '<span class="art xxs ph" style="--ph:#555"><span class="ph-glyph">·</span></span>';
  return `<span class="ab-cell">${ic}${esc(label)}</span>`;
}

function detail(u, name, sec) {
  const allHits = Object.values(u.dmg.byAbility).reduce((a, x) => a + x.hits, 0);
  const allCrits = Object.values(u.dmg.byAbility).reduce((a, x) => a + x.crits, 0);
  const biggest = Object.values(u.dmg.byAbility).reduce((m, x) => (x.max > m.max ? x : m), { max: 0, label: '—' });
  const chips = `<div class="meter-chips">
    <span><small>Damage</small><b>${fmt(u.dmg.total)}</b><i>${per(u.dmg.total, sec)} DPS</i></span>
    <span><small>Healing</small><b>${fmt(u.heal.total)}</b><i>${per(u.heal.total, sec)} HPS</i></span>
    <span><small>Taken</small><b>${fmt(u.taken.total)}</b><i>${u.taken.absorbed ? fmt(u.taken.absorbed) + ' absorbed' : per(u.taken.total, sec) + ' DTPS'}</i></span>
    <span><small>Crit rate</small><b>${pctTxt(allCrits, allHits)}</b><i>${allHits} hits</i></span>
    <span><small>Biggest hit</small><b>${fmt(biggest.max)}</b><i>${esc(biggest.label)}</i></span>
    <span><small>Deaths / dodges</small><b>${u.deaths} / ${u.dodged}</b><i>${u.count > 1 ? `${u.count} fights` : ''}</i></span>
  </div>`;
  const val = r => r.total;
  const prep = (obj, f = val) => Object.values(obj).map(r => ({ ...r, _v: f(r) })).sort((a, b) => b._v - a._v);
  let body = '';
  if (meterUI.mode === 'damage') {
    const abil = prep(u.dmg.byAbility);
    const tg = prep(u.dmg.byTarget);
    const tot = u.dmg.total;
    body = `<h4>Damage by ability</h4>${table([
      { label: 'Ability', get: r => abilityCell(r.key, r.label) },
      { label: 'Total', num: 1, get: r => fmt(r.total) },
      { label: '%', num: 1, get: r => pctTxt(r.total, tot) },
      { label: 'Hits', num: 1, get: r => r.hits },
      { label: 'Crit', num: 1, get: r => pctTxt(r.crits, r.hits) },
      { label: 'Avg', num: 1, get: r => fmt(r.total / Math.max(1, r.hits)) },
      { label: 'Max', num: 1, get: r => fmt(r.max) },
      { label: 'DPS', num: 1, get: r => per(r.total, sec) },
    ], abil, tot)}
    <h4>Damage by target</h4>${table([
      { label: 'Target', get: r => esc(r.label) },
      { label: 'Total', num: 1, get: r => fmt(r.total) },
      { label: '%', num: 1, get: r => pctTxt(r.total, tot) },
      { label: 'Hits', num: 1, get: r => r.hits },
      { label: 'Crit', num: 1, get: r => pctTxt(r.crits, r.hits) },
      { label: 'Max', num: 1, get: r => fmt(r.max) },
    ], tg, tot)}`;
  } else if (meterUI.mode === 'healing') {
    const tot = u.heal.total;
    body = `<h4>Healing by ability</h4>${table([
      { label: 'Ability', get: r => abilityCell(r.key, r.label) },
      { label: 'Effective', num: 1, get: r => fmt(r.total) },
      { label: '%', num: 1, get: r => pctTxt(r.total, tot) },
      { label: 'Overheal', num: 1, get: r => pctTxt(r.over, r.total + r.over) },
      { label: 'Hits', num: 1, get: r => r.hits },
      { label: 'Crit', num: 1, get: r => pctTxt(r.crits, r.hits) },
      { label: 'Avg', num: 1, get: r => fmt(r.total / Math.max(1, r.hits)) },
      { label: 'Max', num: 1, get: r => fmt(r.max) },
      { label: 'HPS', num: 1, get: r => per(r.total, sec) },
    ], prep(u.heal.byAbility), tot)}
    <h4>Healing by target</h4>${table([
      { label: 'Target', get: r => esc(r.label) },
      { label: 'Effective', num: 1, get: r => fmt(r.total) },
      { label: '%', num: 1, get: r => pctTxt(r.total, tot) },
      { label: 'Overheal', num: 1, get: r => pctTxt(r.over, r.total + r.over) },
      { label: 'Hits', num: 1, get: r => r.hits },
    ], prep(u.heal.byTarget), tot)}`;
  } else if (meterUI.mode === 'taken') {
    const tot = u.taken.total;
    body = `<h4>Damage taken by source</h4>${table([
      { label: 'Source', get: r => esc(r.label) },
      { label: 'Total', num: 1, get: r => fmt(r.total) },
      { label: '%', num: 1, get: r => pctTxt(r.total, tot) },
      { label: 'Hits', num: 1, get: r => r.hits },
      { label: 'Crit', num: 1, get: r => pctTxt(r.crits, r.hits) },
      { label: 'Max', num: 1, get: r => fmt(r.max) },
    ], prep(u.taken.bySource), tot)}
    <h4>Damage taken by ability</h4>${table([
      { label: 'Ability — source', get: r => abilityCell(r.key, r.label) },
      { label: 'Total', num: 1, get: r => fmt(r.total) },
      { label: '%', num: 1, get: r => pctTxt(r.total, tot) },
      { label: 'Hits', num: 1, get: r => r.hits },
      { label: 'Avg', num: 1, get: r => fmt(r.total / Math.max(1, r.hits)) },
      { label: 'Max', num: 1, get: r => fmt(r.max) },
    ], prep(u.taken.byAbility), tot)}`;
  } else {
    const casts = Object.entries(u.casts).map(([k, n]) => ({ key: k, label: ABILITIES[k]?.name || k, total: n, _v: n })).sort((a, b) => b._v - a._v);
    const tot = casts.reduce((a, r) => a + r.total, 0);
    body = `<h4>Ability usage</h4>${table([
      { label: 'Ability', get: r => abilityCell(r.key, r.label) },
      { label: 'Casts', num: 1, get: r => r.total },
      { label: '%', num: 1, get: r => pctTxt(r.total, tot) },
      { label: 'Per min', num: 1, get: r => (r.total / Math.max(1, sec / 60)).toFixed(1) },
    ], casts, tot)}
    <p class="faint small">Tip: an ability that is never cast may have behaviour conditions that are too strict, or sits too low in the loadout priority.</p>`;
  }
  return `<div class="meter-detail">
    <div class="row between"><h4 style="margin:0">${esc(name)} — breakdown</h4><button class="icon-btn small" data-meter-close title="Close">✕</button></div>
    ${chips}${body}
  </div>`;
}
