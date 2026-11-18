// Admin → ⚖ Balance: live statistics from real fights (server/balance.js).
import { act } from '../net.js';
import { esc, fmt, toast, tipAttr } from '../ui.js';
import { classIcon } from '../assets.js';
import { CONFIG } from '/shared/config.js';
import { CLASSES } from '/shared/data/classes.js';
import { ABILITIES, classAbilities } from '/shared/data/abilities.js';
import { ZONES, COOP_ENCOUNTERS } from '/shared/data/zones.js';

const BANDS = [[1, 10], [11, 20], [21, 30], [31, 40], [41, 50], [51, 60], [61, 1000]];
const WINDOWS = [[24, '24 hours'], [72, '3 days'], [168, '7 days'], [720, '30 days'], [2160, '90 days']];
const WHO = [['human', 'Real players'], ['bot', 'Bots'], ['all', 'Everyone']];
const ACTIVITIES = [['all', 'All fights'], ['idle', 'Zone farming'], ['boss', 'Zone bosses'], ['rift', 'Rifts'], ['coop', 'Co-op'], ['offline', 'Offline progress']];
const METRICS = {
  dps: { label: 'Damage per second', short: 'DPS', get: c => c.dmg / c.sec, good: 'high', role: true, fmt: v => fmt(Math.round(v)) },
  hps: { label: 'Healing per second', short: 'HPS', get: c => c.heal / c.sec, good: 'high', role: true, fmt: v => fmt(Math.round(v)) },
  win: { label: 'Win rate', short: 'Win %', get: c => c.wins / c.n, good: 'high', fmt: v => `${Math.round(v * 100)}%` },
  deaths: { label: 'Deaths per fight', short: 'Deaths', get: c => c.deaths / c.n, good: 'low', fmt: v => v.toFixed(2) },
  taken: { label: 'Damage taken per second', short: 'Taken/s', get: c => c.taken / c.sec, good: 'low', role: true, fmt: v => fmt(Math.round(v)) },
  fights: { label: 'Fights (sample size)', short: 'Fights', get: c => c.n, fmt: v => fmt(v) },
};
const MIN_SAMPLES = 20;
const COLORS = ['#e0b25a', '#4a7cff', '#3fae5a', '#e6d27a', '#8fd14f', '#8a5cf6', '#ff7a5a', '#5fd3d3'];

const S = { hours: 168, who: 'human', activity: 'all', metric: 'dps', data: null, loading: false, showClasses: false };
let host = null, timer = null;

const bandLabel = i => { const [a, b] = BANDS[i]; return b >= 1000 ? `${a}+` : `${a}–${b}`; };
const fmtTime = s => (s == null ? '—' : s < 90 ? `${Math.round(s)}s` : s < 5400 ? `${Math.round(s / 60)}m` : s < 172800 ? `${(s / 3600).toFixed(1)}h` : `${(s / 86400).toFixed(1)}d`);
const pct = v => `${Math.round(v * 100)}%`;
const classIds = () => Object.keys(CLASSES).sort((a, b) => (CLASSES[a].order ?? 999) - (CLASSES[b].order ?? 999));

async function load() {
  S.loading = true; draw();
  try { S.data = await act('admin_balance', { hours: S.hours, who: S.who, activity: S.activity }); } catch (e) { toast(e.message, 'error'); }
  S.loading = false; draw();
}

// ---------------------------------------------------------------- class × level matrix
function matrixHtml(d) {
  const M = METRICS[S.metric];
  const bands = BANDS.map((_, i) => i).filter(i => classIds().some(c => d.classes[`${c}|${i}`]));
  if (!bands.length) return '<p class="muted">No fights recorded yet for this filter.</p>';
  const cell = (c, i) => d.classes[`${c}|${i}`];
  const val = (c, i) => { const x = cell(c, i); return x && x.n && x.sec ? M.get(x) : null; };
  // reference per band: average over classes of the same role (if the metric depends on the role), else all classes
  const ref = (c, i) => {
    const peers = classIds().filter(o => (!M.role || CLASSES[o].role === CLASSES[c].role) && (cell(o, i)?.n || 0) >= MIN_SAMPLES);
    if (peers.length < 2) return null;
    return peers.reduce((s, o) => s + val(o, i), 0) / peers.length;
  };
  const rows = classIds().filter(c => bands.some(i => cell(c, i))).map(c => `<tr>
    <td class="bl-cls">${classIcon(c, 'xxs')} ${esc(CLASSES[c].name)} <span class="faint small">${esc(CLASSES[c].role)}</span></td>
    ${bands.map(i => {
      const x = cell(c, i), v = val(c, i);
      if (v == null) return '<td class="faint">—</td>';
      const few = x.n < MIN_SAMPLES;
      const r = M.good && !few ? ref(c, i) : null;
      const diff = r ? (v - r) / r : 0;
      const better = M.good === 'high' ? diff : -diff;
      const tone = !r || Math.abs(diff) < 0.1 ? '' : better > 0.25 ? 'up2' : better > 0 ? 'up' : better < -0.25 ? 'down2' : 'down';
      return `<td class="bl-cell ${tone} ${few ? 'few' : ''}" ${tipAttr(`<b>${esc(CLASSES[c].name)}</b>, level ${bandLabel(i)}<br>${M.label}: <b>${M.fmt(v)}</b>${r ? ` (${diff >= 0 ? '+' : ''}${Math.round(diff * 100)}% vs ${M.role ? `other ${esc(CLASSES[c].role)} classes` : 'other classes'})` : ''}<br>${fmt(x.n)} fights · win ${pct(x.wins / x.n)} · ${(x.deaths / x.n).toFixed(2)} deaths/fight${few ? '<br><i>Few fights — not reliable yet</i>' : ''}`)}>${M.fmt(v)}${r && Math.abs(diff) >= 0.1 ? `<small>${diff >= 0 ? '+' : ''}${Math.round(diff * 100)}%</small>` : ''}</td>`;
    }).join('')}</tr>`).join('');
  return `<table class="bl-table bl-matrix"><thead><tr><th>Class</th>${bands.map(i => `<th>Lv ${bandLabel(i)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
    <p class="faint small">Per character and fight. Colors compare each class with ${M.role ? 'the other classes of the same role' : 'the other classes'} in the same level range (green = stronger, red = weaker; ±10% is neutral). Faded cells have fewer than ${MIN_SAMPLES} fights.</p>`;
}

// ---------------------------------------------------------------- level times
function levelsHtml(d) {
  const cap = CONFIG.levelCap;
  const series = [{ id: '*', label: 'All classes', color: '#f2c14e', width: 3 }, ...(S.showClasses ? classIds().map((c, i) => ({ id: c, label: CLASSES[c].name, color: CLASSES[c].color || COLORS[i % COLORS.length], width: 1.6 })) : [])];
  const pts = s => { const out = []; for (let L = 2; L <= cap; L++) { const v = d.levels[`${s.id}|${L}`]; if (v && v.n >= (s.id === '*' ? 2 : 3)) out.push([L, v.median, v.n]); } return out; };
  const lines = series.map(s => ({ ...s, pts: pts(s) })).filter(s => s.pts.length);
  if (!lines.length) return '<p class="muted">No hero level-ups recorded yet for this filter.</p>';
  const W = 900, H = 260, m = { l: 56, r: 14, t: 12, b: 30 };
  const maxL = Math.max(...lines.flatMap(l => l.pts.map(p => p[0]))), maxV = Math.max(...lines.flatMap(l => l.pts.map(p => p[1]))) * 1.1;
  const X = L => m.l + ((L - 2) / Math.max(1, maxL - 2)) * (W - m.l - m.r), Y = v => m.t + (1 - v / maxV) * (H - m.t - m.b);
  const step = [60, 300, 600, 1800, 3600, 7200, 21600, 43200, 86400, 172800].find(s => maxV / s <= 6) || 604800;
  const yt = []; for (let v = 0; v <= maxV; v += step) yt.push(v);
  const xt = []; for (let L = 2; L <= maxL; L++) if (L === 2 || L % (maxL > 40 ? 10 : 5) === 0) xt.push(L);
  return `<svg viewBox="0 0 ${W} ${H}" class="bl-svg">
      ${yt.map(v => `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" class="xc-grid"/><text x="${m.l - 6}" y="${Y(v) + 4}" class="xc-tick" text-anchor="end">${v ? fmtTime(v) : '0'}</text>`).join('')}
      ${xt.map(L => `<text x="${X(L)}" y="${H - m.b + 16}" class="xc-tick" text-anchor="middle">${L}</text>`).join('')}
      <text x="${(m.l + W - m.r) / 2}" y="${H - 2}" class="xc-axis" text-anchor="middle">level reached</text>
      ${lines.map(l => `<path d="${l.pts.map(([L, v], i) => `${i ? 'L' : 'M'}${X(L).toFixed(1)},${Y(v).toFixed(1)}`).join('')}" fill="none" stroke="${l.color}" stroke-width="${l.width}"/>${l.pts.map(([L, v, n]) => `<circle cx="${X(L)}" cy="${Y(v)}" r="${l.width > 2 ? 3 : 2}" fill="${l.color}"><title>${esc(l.label)}: level ${L} took ${fmtTime(v)} (median of ${n})</title></circle>`).join('')}`).join('')}
    </svg>
    <div class="xc-legend">${lines.map(l => `<span><i style="background:${l.color}"></i>${esc(l.label)}</span>`).join('')}
      <label class="small"><input type="checkbox" data-bl-classes ${S.showClasses ? 'checked' : ''}> per class</label></div>
    <p class="faint small">Median real time heroes spent on each level before reaching the next (including offline time). Compare with ⏱ Test with bots in the 📈 XP curve tab.</p>`;
}

// ---------------------------------------------------------------- abilities
function abilitiesHtml(d) {
  if (S.activity !== 'all') return '<p class="muted small">Ability usage is shown for "All fights".</p>';
  return `<div class="bl-abil">${classIds().map(c => {
    const list = classAbilities(c, '*').map(a => ({ a, n: d.casts[`${c}|${a.id}`] || 0 }));
    const total = list.reduce((s, x) => s + x.n, 0);
    if (!total) return '';
    list.sort((x, y) => y.n - x.n);
    return `<div class="bl-abil-card"><h4>${classIcon(c, 'xxs')} ${esc(CLASSES[c].name)} <span class="faint small">${fmt(total)} casts</span></h4>
      ${list.map(({ a, n }) => `<div class="bl-bar ${n ? '' : 'none'}" ${tipAttr(`<b>${esc(a.name)}</b> — ${fmt(n)} casts (${total ? Math.round((n / total) * 100) : 0}%)${n ? '' : '<br>Never cast: not learned, not in loadouts, or its rule never fires.'}`)}><span>${esc(a.name)}</span><i style="width:${total ? Math.max(n ? 2 : 0, Math.round((n / total) * 100)) : 0}%"></i><b>${n ? `${Math.round((n / total) * 100)}%` : 'never'}</b></div>`).join('')}
    </div>`;
  }).join('') || '<p class="muted">No casts recorded yet.</p>'}</div>`;
}

// ---------------------------------------------------------------- places, rifts, economy
function placeName(act, place) {
  if (act === 'coop') return COOP_ENCOUNTERS[place]?.name || place;
  if (act === 'rift') return `Rift ${place.replace('tier', 'tier ')}`;
  return ZONES[place]?.name || place;
}
function fightsHtml(d) {
  const order = { idle: 1, boss: 2, offline: 3, coop: 4, rift: 5 };
  const rows = Object.entries(d.fights).filter(([k]) => !k.startsWith('rift|')).map(([k, v]) => { const [a, place] = k.split('|'); return { a, place, ...v }; })
    .sort((x, y) => (order[x.a] - order[y.a]) || ((ZONES[x.place]?.order ?? 0) - (ZONES[y.place]?.order ?? 0)));
  if (!rows.length) return '<p class="muted">No fights recorded yet.</p>';
  const label = { idle: 'Farming', boss: 'Boss', offline: 'Offline', coop: 'Co-op' };
  return `<table class="bl-table"><thead><tr><th>Where</th><th>Fights</th><th>Win rate</th><th>Avg length</th><th>Deaths / fight</th></tr></thead><tbody>
    ${rows.map(r => `<tr class="${r.n < MIN_SAMPLES ? 'few' : ''}"><td><span class="tag">${label[r.a] || r.a}</span> ${esc(placeName(r.a, r.place))}</td><td>${fmt(r.n)}</td>
      <td class="${r.wins / r.n < 0.6 ? 'bad' : r.wins / r.n > 0.97 && r.a === 'boss' ? 'warn' : ''}">${pct(r.wins / r.n)}</td><td>${fmtTime(r.sec / r.n)}</td><td>${(r.deaths / r.n).toFixed(2)}</td></tr>`).join('')}
  </tbody></table>`;
}
function riftsHtml(d) {
  const rows = Object.entries(d.rifts).map(([k, v]) => ({ band: Number(k), ...v })).sort((a, b) => a.band - b.band);
  if (!rows.length) return '<p class="muted">No rift runs recorded yet.</p>';
  return `<table class="bl-table"><thead><tr><th>Tiers</th><th>Runs</th><th>Cleared</th><th>In time</th></tr></thead><tbody>
    ${rows.map(r => `<tr class="${r.n < 5 ? 'few' : ''}"><td>${r.band * 10 + 1}–${r.band * 10 + 10}</td><td>${fmt(r.n)}</td><td>${pct(r.wins / r.n)}</td><td>${pct(r.timed / r.n)}</td></tr>`).join('')}
  </tbody></table>`;
}
function econHtml(d) {
  const rows = Object.entries(d.econ).map(([k, v]) => ({ band: Number(k), ...v })).filter(r => r.sec > 0).sort((a, b) => a.band - b.band);
  if (!rows.length) return '<p class="muted">No rewards recorded yet.</p>';
  return `<table class="bl-table"><thead><tr><th>Hero level</th><th>XP / hour</th><th>Gold / hour</th><th>Fights / hour</th><th>Fights</th></tr></thead><tbody>
    ${rows.map(r => { const h = r.sec / 3600; return `<tr class="${r.n < MIN_SAMPLES ? 'few' : ''}"><td>${bandLabel(r.band)}</td><td>${fmt(Math.round(r.xp / h))}</td><td>${fmt(Math.round(r.gold / h))}</td><td>${(r.n / h).toFixed(0)}</td><td>${fmt(r.n)}</td></tr>`; }).join('')}
  </tbody></table><p class="faint small">Per hour of fighting (incl. rest between fights), per party, after server rates and elixirs.</p>`;
}

// ---------------------------------------------------------------- page
function html() {
  const d = S.data;
  const sel = (key, list) => `<select data-bl="${key}">${list.map(([v, l]) => `<option value="${v}" ${String(S[key]) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  return `<section class="panel bl">
    <div class="panel-head"><h3>⚖ Live balance</h3>
      <div class="row gap wrap">${sel('hours', WINDOWS)} ${sel('who', WHO)} ${sel('activity', ACTIVITIES)} <button class="btn small ghost" data-bl-refresh ${S.loading ? 'disabled' : ''}>${S.loading ? 'Loading…' : '↻ Refresh'}</button></div></div>
    <p class="muted small">Collected from every real fight on this server — farming, bosses, rifts, co-op and offline progress — in hourly steps. Bots are counted separately, so you can compare them with real players.</p>
    ${!d ? '<p class="muted pad">Loading…</p>' : `
    <div class="bl-chips">
      <span><b>${fmt(d.players)}</b> players</span><span><b>${fmt(d.partyFights)}</b> fights</span><span><b>${fmt(d.characterFights)}</b> character-fights</span><span class="faint">${d.buckets} hours with data</span>
    </div>
    <div class="bl-section"><div class="row between wrap"><h4>Classes by level</h4><div class="tabs small-tabs">${Object.entries(METRICS).map(([k, m]) => `<button class="tab ${S.metric === k ? 'active' : ''}" data-bl-metric="${k}">${m.short}</button>`).join('')}</div></div>${matrixHtml(d)}</div>
    <div class="bl-section"><h4>Time per level (heroes)</h4>${levelsHtml(d)}</div>
    <div class="bl-grid">
      <div class="bl-section"><h4>Zones, bosses & co-op</h4>${fightsHtml(d)}</div>
      <div class="bl-section"><h4>Rifts</h4>${riftsHtml(d)}<h4>XP & gold income</h4>${econHtml(d)}</div>
    </div>
    <div class="bl-section"><h4>Ability usage</h4>${abilitiesHtml(d)}</div>`}
  </section>`;
}

function draw() { if (host?.isConnected) host.innerHTML = html(); }

export function mountBalance(el) {
  host = document.createElement('div');
  el.innerHTML = '';
  el.appendChild(host);
  host.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.bl) { S[t.dataset.bl] = t.dataset.bl === 'hours' ? Number(t.value) : t.value; load(); }
    if (t.matches('[data-bl-classes]')) { S.showClasses = t.checked; draw(); }
  });
  host.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    if ('blRefresh' in t.dataset) load();
    if (t.dataset.blMetric) { S.metric = t.dataset.blMetric; draw(); }
  });
  clearInterval(timer);
  timer = setInterval(() => { if (!host?.isConnected) return clearInterval(timer); if (!S.loading && document.visibilityState === 'visible') load(); }, 60_000);
  load();
}
