// Admin → 📈 XP curve: drag control points to shape how much XP each level needs.
// Saved into content/config.json → xp.curve (as a content override, live for everyone, see admin-content.js).
import { act } from '../net.js';
import { bus } from '../state.js';
import { esc, fmt, toast, confirmBox } from '../ui.js';
import { CONTENT } from '/shared/content.js';
import { makeCurve } from '/shared/curve.js';
import { ZONES } from '/shared/data/zones.js';
import { ENEMIES } from '/shared/data/enemies.js';
import { zoneLevel, killXp } from '/shared/encounters.js';

const W = 920, H = 390, M = { l: 70, r: 22, t: 18, b: 38 };
const S = { entry: null, pts: [], baseJson: '', logY: true, sel: null, hover: null, drag: null, dom: null, busy: false, problems: null, table: false };
let host = null;

const clone = v => JSON.parse(JSON.stringify(v));
const cap = () => (CONTENT.config.levelCap || 60);
const lastLevel = () => Math.max(2, cap() - 1);
const nice = v => { const d = Math.pow(10, Math.max(0, Math.floor(Math.log10(Math.max(1, v))) - 2)); return Math.max(1, Math.round(v / d) * d); };
const formulaOf = xp => L => Math.floor(xp.base * Math.pow(L, xp.exponent));
const savedXp = () => S.entry?.data?.xp || CONTENT.config.xp;
const savedCurve = () => (Array.isArray(savedXp().curve) && savedXp().curve.length ? savedXp().curve : null);
const fnOf = pts => { const c = makeCurve(pts); return L => Math.max(1, Math.round(c(L))); };
const savedFn = () => (savedCurve() ? fnOf(savedCurve()) : formulaOf(savedXp()));
const dirty = () => !!S.entry && JSON.stringify(S.pts) !== S.baseJson;

const SAMPLE_LEVELS = () => [...new Set([1, 5, 10, 20, 30, 40, 50, lastLevel()].filter(l => l <= lastLevel()))];
const PRESETS = {
  saved: { label: 'Saved curve', make: () => (savedCurve() ? clone(savedCurve()) : SAMPLE_LEVELS().map(L => [L, formulaOf(savedXp())(L)])) },
  formula: { label: 'Formula (base × level^exponent)', make: () => SAMPLE_LEVELS().map(L => [L, formulaOf(savedXp())(L)]) },
  linear: { label: 'Linear (same extra XP every level)', make: () => { const a = savedFn()(1), b = savedFn()(lastLevel()); return SAMPLE_LEVELS().map(L => [L, nice(a + ((b - a) * (L - 1)) / (lastLevel() - 1))]); } },
  gentle: { label: 'Gentle (fast early, steady later)', make: () => SAMPLE_LEVELS().map(L => [L, nice(savedFn()(1) * Math.pow(L, 1.5))]) },
  steep: { label: 'Steep (slow at high levels)', make: () => SAMPLE_LEVELS().map(L => [L, nice(savedFn()(1) * Math.pow(L, 2.2))]) },
  exponential: { label: 'Exponential (+9% per level)', make: () => SAMPLE_LEVELS().map(L => [L, nice(savedFn()(1) * Math.pow(1.09, L - 1))]) },
  plateau: { label: 'Faster start, steeper at the end', make: () => { const f = savedFn(), e = lastLevel(); return SAMPLE_LEVELS().map(L => [L, nice(L < e * 0.8 ? f(L) * 0.7 : f(L) * (1 + ((L - e * 0.8) / (e * 0.2)) * 1.5))]); } },
};

// ≈ kills per level in the zone that fits the level (before XP bonuses)
function killsAt(L, xp) {
  const zones = Object.values(ZONES).filter(z => z.levelRange[0] <= L).sort((a, b) => b.levelRange[0] - a.levelRange[0]);
  const z = zones[0] || Object.values(ZONES)[0];
  if (!z?.enemies?.length) return null;
  const lvl = zoneLevel(z, L);
  const avg = z.enemies.reduce((s, id) => s + (ENEMIES[id] ? killXp({ enemyId: id, level: lvl }) : 0), 0) / z.enemies.length;
  return avg > 0 ? { kills: Math.ceil(xp / avg), zone: z.name } : null;
}

// ---------------------------------------------------------------- chart geometry
function domain(fns) {
  if (S.drag && S.dom) return S.dom;
  let lo = Infinity, hi = 0;
  for (const f of fns) for (let L = 1; L <= lastLevel(); L++) { const v = f(L); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  for (const [, y] of S.pts) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
  return S.logY ? { lo: Math.max(1, lo / 1.6), hi: hi * 1.6 } : { lo: 0, hi: hi * 1.15 };
}
const px = L => M.l + ((L - 1) / (lastLevel() - 1)) * (W - M.l - M.r);
const lvlAt = x => 1 + ((x - M.l) / (W - M.l - M.r)) * (lastLevel() - 1);
function py(v, d) {
  const h = H - M.t - M.b;
  if (S.logY) return M.t + h - ((Math.log(Math.max(1, v)) - Math.log(d.lo)) / (Math.log(d.hi) - Math.log(d.lo))) * h;
  return M.t + h - ((v - d.lo) / (d.hi - d.lo)) * h;
}
function valAt(y, d) {
  const h = H - M.t - M.b, t = (M.t + h - y) / h;
  return S.logY ? Math.exp(Math.log(d.lo) + t * (Math.log(d.hi) - Math.log(d.lo))) : d.lo + t * (d.hi - d.lo);
}
function yTicks(d) {
  const out = [];
  if (S.logY) {
    for (let e = Math.floor(Math.log10(d.lo)); e <= Math.ceil(Math.log10(d.hi)); e++) for (const m of [1, 2, 5]) { const v = m * 10 ** e; if (v >= d.lo && v <= d.hi) out.push(v); }
  } else {
    const step = nice((d.hi - d.lo) / 6);
    for (let v = 0; v <= d.hi; v += step) out.push(v);
  }
  return out;
}
const short = v => (v >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${+(v / 1e3).toFixed(1)}k` : String(Math.round(v)));

function chartSvg() {
  const cur = S.pts.length >= 2 ? fnOf(S.pts) : savedFn(), old = savedFn();
  const d = domain([cur, old]);
  if (S.drag && !S.dom) S.dom = d;
  const line = f => Array.from({ length: lastLevel() }, (_, i) => `${i ? 'L' : 'M'}${px(i + 1).toFixed(1)},${py(f(i + 1), d).toFixed(1)}`).join('');
  const xt = [];
  for (let L = 1; L <= lastLevel(); L++) if (L === 1 || L % (lastLevel() > 40 ? 10 : 5) === 0 || L === lastLevel()) xt.push(L);
  const hov = S.hover;
  return `<svg viewBox="0 0 ${W} ${H}" class="xc-svg" preserveAspectRatio="xMidYMid meet">
    ${yTicks(d).map(v => `<line x1="${M.l}" x2="${W - M.r}" y1="${py(v, d)}" y2="${py(v, d)}" class="xc-grid"/><text x="${M.l - 8}" y="${py(v, d) + 4}" class="xc-tick" text-anchor="end">${short(v)}</text>`).join('')}
    ${xt.map(L => `<line x1="${px(L)}" x2="${px(L)}" y1="${M.t}" y2="${H - M.b}" class="xc-grid v"/><text x="${px(L)}" y="${H - M.b + 18}" class="xc-tick" text-anchor="middle">${L}</text>`).join('')}
    <text x="${(M.l + W - M.r) / 2}" y="${H - 4}" class="xc-axis" text-anchor="middle">level</text>
    <text x="14" y="${(M.t + H - M.b) / 2}" class="xc-axis" text-anchor="middle" transform="rotate(-90 14 ${(M.t + H - M.b) / 2})">XP to next level</text>
    <path d="${line(cur)}L${px(lastLevel())},${H - M.b}L${px(1)},${H - M.b}Z" class="xc-area"/>
    <path d="${line(old)}" class="xc-old"/>
    <path d="${line(cur)}" class="xc-cur"/>
    ${hov ? `<line x1="${px(hov)}" x2="${px(hov)}" y1="${M.t}" y2="${H - M.b}" class="xc-hover"/><circle cx="${px(hov)}" cy="${py(cur(hov), d)}" r="4" class="xc-hdot"/>` : ''}
    ${S.pts.map(([L, v], i) => `<g class="xc-pt ${S.sel === i ? 'sel' : ''} ${i === 0 || i === S.pts.length - 1 ? 'end' : ''}" data-i="${i}"><circle cx="${px(L)}" cy="${py(v, d)}" r="14" class="hit"/><circle cx="${px(L)}" cy="${py(v, d)}" r="7"/></g>`).join('')}
  </svg>`;
}

function tooltipHtml(L) {
  const cur = fnOf(S.pts), old = savedFn();
  const v = cur(L), o = old(L);
  let total = 0, oldTotal = 0;
  for (let i = 1; i <= L; i++) { total += cur(i); oldTotal += old(i); }
  const k = killsAt(L, v);
  const diff = o ? Math.round(((v - o) / o) * 100) : 0;
  return `<b>Level ${L} → ${L + 1}</b><br>${fmt(v)} XP${diff ? ` <span class="${diff > 0 ? 'bad' : 'good'}">${diff > 0 ? '+' : ''}${diff}%</span>` : ''}
    <br><span class="muted">total to reach ${L + 1}: ${fmt(total)}${oldTotal !== total ? ` (was ${fmt(oldTotal)})` : ''}</span>${k ? `<br><span class="muted">≈ ${fmt(k.kills)} kills in ${esc(k.zone)}</span>` : ''}`;
}

function milestonesHtml() {
  const cur = fnOf(S.pts), old = savedFn();
  const marks = [...new Set([10, 20, 30, 40, 50, cap()].filter(L => L <= cap()))];
  let t = 0, o = 0;
  const totals = {}, oldTotals = {};
  for (let L = 1; L < cap(); L++) { t += cur(L); o += old(L); totals[L + 1] = t; oldTotals[L + 1] = o; }
  return `<table class="xc-mile"><thead><tr><th>Reach level</th><th>Total XP</th><th>vs saved</th></tr></thead><tbody>${marks.map(L => {
    const a = totals[L] || 0, b = oldTotals[L] || 0, diff = b ? Math.round(((a - b) / b) * 100) : 0;
    return `<tr><td>${L}${L === cap() ? ' (max)' : ''}</td><td>${fmt(a)}</td><td class="${diff > 0 ? 'bad' : diff < 0 ? 'good' : 'muted'}">${diff ? `${diff > 0 ? '+' : ''}${diff}%` : '—'}</td></tr>`;
  }).join('')}</tbody></table>`;
}

function fullTableHtml() {
  const cur = fnOf(S.pts), old = savedFn();
  let t = 0;
  const rows = [];
  for (let L = 1; L < cap(); L++) {
    const v = cur(L), o = old(L); t += v;
    const k = killsAt(L, v), diff = o ? Math.round(((v - o) / o) * 100) : 0;
    rows.push(`<tr class="${S.pts.some(p => p[0] === L) ? 'is-pt' : ''}"><td>${L} → ${L + 1}</td><td>${fmt(v)}</td><td class="${diff > 0 ? 'bad' : diff < 0 ? 'good' : 'muted'}">${diff ? `${diff > 0 ? '+' : ''}${diff}%` : ''}</td><td>${fmt(t)}</td><td class="muted">${k ? `≈ ${fmt(k.kills)}` : ''}</td></tr>`);
  }
  return `<table class="xc-full"><thead><tr><th>Level</th><th>XP needed</th><th>vs saved</th><th>Total</th><th>Kills*</th></tr></thead><tbody>${rows.join('')}</tbody></table>
    <p class="faint small">* rough number of kills in the zone that fits the level, before XP bonuses (hero, traits, elixirs, server rate).</p>`;
}

function html() {
  if (!S.entry) return '<p class="muted pad">Loading…</p>';
  const usingCurve = !!savedCurve();
  return `<section class="panel xc">
    <div class="panel-head"><h3>📈 XP needed per level ${dirty() ? '<span class="ce-badge st-unsaved">Unsaved</span>' : ''}</h3>
      <div class="row gap"><button class="btn small ghost" data-xc-discard ${dirty() ? '' : 'disabled'}>Discard</button>
      <button class="btn small primary" data-xc-save ${dirty() && !S.busy ? '' : 'disabled'}>💾 Save — live for everyone</button></div></div>
    <p class="muted small">Drag the points up or down (and sideways) to shape the curve — it bends smoothly through them. <b>Double-click</b> the chart to add a point, double-click a point to remove it. The dashed line is what the game uses right now${usingCurve ? '' : ` (the formula ${esc(String(savedXp().base))} × level<sup>${esc(String(savedXp().exponent))}</sup>)`}. Hover for details.</p>
    ${S.problems ? `<div class="ce-note bad"><b>Not saved:</b><ul>${S.problems.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}
    <div class="xc-chart-wrap"><div class="xc-chart">${chartSvg()}</div><div class="xc-tip" hidden></div></div>
    <div class="xc-tools row gap wrap">
      <label class="small">Start from <select data-xc-preset><option value="">choose a shape…</option>${Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${esc(p.label)}</option>`).join('')}</select></label>
      <span class="small muted">Scale all:</span>${[0.8, 0.9, 1.1, 1.25].map(f => `<button class="btn tiny ghost" data-xc-scale="${f}">×${f}</button>`).join('')}
      <label class="switch small"><input type="checkbox" data-xc-log ${S.logY ? 'checked' : ''}><span></span> log scale</label>
      <span class="grow"></span>
      ${usingCurve ? '<button class="btn tiny ghost" data-xc-formula title="Remove the curve and use base × level^exponent again">Use the formula instead</button>' : ''}
    </div>
    <div class="xc-grid2">
      <div><h4>Points</h4><table class="xc-pts"><thead><tr><th>Level</th><th>XP to next</th><th></th></tr></thead><tbody>
        ${S.pts.map(([L, v], i) => `<tr class="${S.sel === i ? 'sel' : ''}"><td><input type="number" min="1" max="${lastLevel()}" step="1" value="${L}" data-xc-l="${i}" ${i === 0 ? 'disabled title="The first point stays at level 1"' : ''}></td>
          <td><input type="number" min="1" step="1" value="${v}" data-xc-v="${i}"></td>
          <td>${S.pts.length > 2 && i > 0 ? `<button class="btn tiny ghost danger" data-xc-del="${i}" title="Remove point">✕</button>` : ''}</td></tr>`).join('')}
      </tbody></table><button class="btn tiny ghost" data-xc-add>+ point</button></div>
      <div><h4>Milestones</h4>${milestonesHtml()}<p class="faint small">Changing the curve doesn't change anyone's level; it only changes how much XP the next levels need.</p></div>
    </div>
    <button class="btn tiny ghost" data-xc-table>${S.table ? '▾ Hide' : '▸ Show'} every level</button>
    ${S.table ? fullTableHtml() : ''}
  </section>`;
}

function draw(part = 'all') {
  if (!host?.isConnected) return;
  if (part === 'chart') { host.querySelector('.xc-chart').innerHTML = chartSvg(); return; }
  host.innerHTML = html();
}

// ---------------------------------------------------------------- loading & saving
async function load() {
  try {
    S.entry = await act('admin_content_get', { type: 'settings', id: 'config' });
    S.pts = PRESETS.saved.make();
    S.baseJson = JSON.stringify(S.pts);
    S.problems = null;
  } catch (e) { toast(e.message, 'error'); }
  draw();
}
async function save(useFormula = false) {
  if (S.busy) return;
  S.busy = true;
  const data = clone(S.entry.data);
  data.xp = { ...data.xp };
  if (useFormula) delete data.xp.curve; else data.xp.curve = sorted(S.pts);
  try {
    const r = await act('admin_content_save', { type: 'settings', id: 'config', data });
    S.entry = r.entry;
    S.pts = PRESETS.saved.make();
    S.baseJson = JSON.stringify(S.pts);
    S.problems = null;
    toast(useFormula ? 'Back to the formula — live now.' : 'XP curve saved — live for everyone now.', 'success');
  } catch (e) { S.problems = e.details?.length ? e.details : [e.message]; }
  S.busy = false;
  draw();
}
const sorted = pts => [...pts].sort((a, b) => a[0] - b[0]).map(([L, v]) => [Math.round(L), Math.max(1, Math.round(v))]);

// ---------------------------------------------------------------- interaction
function svgPoint(e) {
  const svg = host.querySelector('.xc-svg');
  const r = svg.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H, r };
}
function bind(el) {
  el.addEventListener('pointerdown', e => {
    const g = e.target.closest('.xc-pt');
    if (!g) return;
    e.preventDefault();
    const i = Number(g.dataset.i);
    S.sel = i; S.drag = { i }; S.dom = null;
    el.querySelector('.xc-chart').setPointerCapture(e.pointerId);
    draw('chart');
  });
  el.addEventListener('pointermove', e => {
    if (!e.target.closest('.xc-chart')) return;
    const { x, y, r } = svgPoint(e);
    const L = Math.max(1, Math.min(lastLevel(), Math.round(lvlAt(x))));
    if (S.drag) {
      const i = S.drag.i, pts = S.pts;
      const v = Math.max(1, nice(valAt(y, S.dom)));
      let lv = pts[i][0];
      if (i > 0 && i < pts.length - 1) lv = Math.max(pts[i - 1][0] + 1, Math.min(pts[i + 1][0] - 1, L));
      if (i === pts.length - 1 && pts.length > 1) lv = Math.max(pts[i - 1][0] + 1, Math.min(lastLevel(), L));
      pts[i] = [lv, v];
      S.hover = lv;
    } else S.hover = L;
    draw('chart');
    const tip = el.querySelector('.xc-tip');
    tip.hidden = false;
    tip.innerHTML = tooltipHtml(S.hover);
    const wrap = el.querySelector('.xc-chart-wrap').getBoundingClientRect();
    const left = e.clientX - wrap.left;
    tip.style.left = `${Math.min(left + 14, wrap.width - 230)}px`;
    tip.style.top = `${Math.max(0, e.clientY - wrap.top - 70)}px`;
    void r;
  });
  const endDrag = () => { if (S.drag) { S.drag = null; S.dom = null; draw(); } };
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);
  el.addEventListener('pointerleave', e => { if (e.target === el && !S.drag) { S.hover = null; const t = el.querySelector('.xc-tip'); if (t) t.hidden = true; draw('chart'); } });
  el.addEventListener('dblclick', e => {
    if (!e.target.closest('.xc-chart')) return;
    const g = e.target.closest('.xc-pt');
    if (g) {
      const i = Number(g.dataset.i);
      if (i === 0 || S.pts.length <= 2) return toast('The first point and the last two points stay', 'info');
      S.pts.splice(i, 1); S.sel = null; draw(); return;
    }
    const L = Math.max(2, Math.min(lastLevel(), Math.round(lvlAt(svgPoint(e).x))));
    if (S.pts.some(p => p[0] === L)) return;
    S.pts.push([L, nice(fnOf(S.pts)(L))]);
    S.pts = sorted(S.pts);
    S.sel = S.pts.findIndex(p => p[0] === L);
    draw();
  });
  el.addEventListener('click', async e => {
    const t = e.target.closest('button');
    if (!t || t.disabled) return;
    if ('xcSave' in t.dataset) return save();
    if ('xcDiscard' in t.dataset) { S.pts = JSON.parse(S.baseJson); S.problems = null; return draw(); }
    if ('xcFormula' in t.dataset) { if (await confirmBox('Remove the XP curve and use the formula (base × level^exponent) again?', 'Use formula')) save(true); return; }
    if (t.dataset.xcScale) { const f = Number(t.dataset.xcScale); S.pts = S.pts.map(([L, v]) => [L, nice(v * f)]); return draw(); }
    if (t.dataset.xcDel) { S.pts.splice(Number(t.dataset.xcDel), 1); S.sel = null; return draw(); }
    if ('xcAdd' in t.dataset) {
      // halfway into the widest gap
      let best = null;
      for (let i = 0; i < S.pts.length - 1; i++) { const gap = S.pts[i + 1][0] - S.pts[i][0]; if (gap > 1 && (!best || gap > best.gap)) best = { gap, L: Math.round((S.pts[i][0] + S.pts[i + 1][0]) / 2) }; }
      if (!best) return toast('Every level already has a point', 'info');
      S.pts = sorted([...S.pts, [best.L, nice(fnOf(S.pts)(best.L))]]);
      return draw();
    }
    if ('xcTable' in t.dataset) { S.table = !S.table; return draw(); }
  });
  el.addEventListener('change', e => {
    const t = e.target;
    if (t.matches('[data-xc-preset]')) { if (t.value) { S.pts = PRESETS[t.value].make(); S.sel = null; draw(); } return; }
    if (t.matches('[data-xc-log]')) { S.logY = t.checked; return draw(); }
    if (t.dataset.xcV) { const i = Number(t.dataset.xcV); S.pts[i] = [S.pts[i][0], Math.max(1, Math.round(Number(t.value) || 1))]; return draw(); }
    if (t.dataset.xcL) {
      const i = Number(t.dataset.xcL), L = Math.max(2, Math.min(lastLevel(), Math.round(Number(t.value) || 2)));
      if (S.pts.some((p, j) => j !== i && p[0] === L)) { toast(`There is already a point at level ${L}`, 'error'); return draw(); }
      S.pts[i] = [L, S.pts[i][1]]; S.pts = sorted(S.pts); return draw();
    }
  });
}

bus.on('content:updated', () => { if (host?.isConnected && !dirty() && !S.busy) load(); });

export function mountCurveEditor(el) {
  host = document.createElement('div');
  el.innerHTML = '';
  el.appendChild(host);
  bind(host);
  if (S.entry && dirty()) draw(); else load();
}
export const curveEditorDirty = () => !!dirty();
