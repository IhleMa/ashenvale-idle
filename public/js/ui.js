// UI helpers: escaping, formatting, toasts, modals, tooltips.
import { STAT_LABELS, PCT_STATS, SLOTS } from '/shared/data/items.js';
import { GEM_KINDS, gemName, gemValue, parseGemKey } from '/shared/gems.js';
import { rarityById } from '/shared/config.js';
import { CLASSES } from '/shared/data/classes.js';
import { UNIQUES, SETS, equippedSetCounts } from '/shared/data/legendaries.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = n => {
  n = Math.round(n || 0);
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
  if (Math.abs(n) >= 1e4) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'k';
  return n.toLocaleString('en-US');
};
export const pct = (v, digits = 1) => `${(v * 100).toFixed(digits)}%`;
export function statValue(key, v) {
  return PCT_STATS.has(key) ? `+${(v * 100).toFixed(1)}%` : `+${fmt(v)}`;
}
export function duration(sec) {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

export function toast(text, kind = 'info', ms = 4500) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  host.appendChild(el);
  while (host.children.length > 5) host.firstChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, ms);
}

export function modal(innerHtml, { onClose, wide = false } = {}) {
  const root = document.getElementById('modal-root');
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog"><button class="modal-x" data-close aria-label="Close">✕</button>${innerHtml}</div>`;
  const onKey = e => { if (e.key === 'Escape') close(); };
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', e => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
  root.appendChild(wrap);
  return { el: wrap.querySelector('.modal'), close };
}

export function confirmBox(text, okLabel = 'Confirm', { html = false } = {}) {
  return new Promise(resolve => {
    const m = modal(`<p>${html ? text : esc(text)}</p><div class="row end gap"><button class="btn" data-close>Cancel</button><button class="btn primary" data-ok>${esc(okLabel)}</button></div>`, { onClose: () => resolve(false) });
    m.el.querySelector('[data-ok]').addEventListener('click', () => { resolve(true); m.el.parentElement.remove(); });
  });
}

// Runs an async action and shows an error toast if it fails
export async function run(promise, okText) {
  try {
    const r = await promise;
    if (okText) toast(okText, 'success', 2500);
    return r;
  } catch (e) {
    toast(e.message, 'error');
    return undefined;
  }
}

export function bar(value, max, cls = '', label = null) {
  const p = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return `<div class="bar ${cls}"><div class="fill" style="width:${p}%"></div><span class="bar-label">${label ?? `${fmt(value)} / ${fmt(max)}`}</span></div>`;
}

export function rarityLabel(id) {
  const r = rarityById(id);
  return `<span class="rarity-text rarity-${r.id}">${esc(r.label)}</span>`;
}

export function itemTooltipHtml(item, compareTo = null, wearer = null) {
  const lines = Object.entries(item.stats).map(([k, v]) => {
    let diff = '';
    if (compareTo) {
      const d = v - (compareTo.stats[k] || 0);
      if (Math.abs(d) > 1e-6) diff = ` <span class="${d > 0 ? 'up' : 'down'}">(${d > 0 ? '+' : ''}${PCT_STATS.has(k) ? (d * 100).toFixed(1) + '%' : fmt(d)})</span>`;
    }
    return `<div class="stat-line"><span>${esc(STAT_LABELS[k] || k)}</span><span>${statValue(k, v)}${diff}</span></div>`;
  });
  if (compareTo) {
    for (const [k, v] of Object.entries(compareTo.stats)) {
      if (k in item.stats) continue;
      lines.push(`<div class="stat-line"><span>${esc(STAT_LABELS[k] || k)}</span><span class="down">(−${PCT_STATS.has(k) ? (v * 100).toFixed(1) + '%' : fmt(v)})</span></div>`);
    }
  }
  if (item.enchant) lines.push(`<div class="stat-line enchant-line"><span>✨ Enchanted: ${esc(STAT_LABELS[item.enchant.stat] || item.enchant.stat)}</span><span>${statValue(item.enchant.stat, item.enchant.value)}</span></div>`);
  if (item.sockets?.length) {
    for (const g of item.sockets) {
      const gem = g && parseGemKey(g);
      lines.push(gem ? `<div class="stat-line socket-line"><span><i class="sock-dot full" style="--gem:${GEM_KINDS[gem.stat].color}"></i>${esc(gemName(gem.stat, gem.tier))}</span><span>${statValue(gem.stat, gemValue(gem.stat, gem.tier))}</span></div>`
        : '<div class="stat-line socket-line muted"><span><i class="sock-dot"></i>Empty socket</span><span></span></div>');
    }
  }
  if (item.crafted) lines.push(`<div class="muted small">Crafted by ${esc(item.crafted)}</div>`);
  if (item.unique && UNIQUES[item.unique]) {
    const u = UNIQUES[item.unique];
    lines.push(`<div class="unique-effect">✦ ${esc(u.description)}</div>${u.flavor ? `<div class="flavor">“${esc(u.flavor)}”</div>` : ''}`);
  }
  if (item.set && SETS[item.set]) {
    const set = SETS[item.set];
    const n = wearer ? (equippedSetCounts(wearer)[item.set] || 0) : 0;
    lines.push(`<div class="set-block"><div class="set-name">${esc(set.name)}${wearer ? ` (${n}/${Object.keys(set.pieces).length})` : ''}</div>
      ${Object.values(set.pieces).map(nm => `<div class="set-piece">${esc(nm)}</div>`).join('')}
      ${Object.entries(set.bonuses).map(([need, b]) => `<div class="set-bonus ${n >= Number(need) ? 'on' : ''}">(${need}) ${esc(b.description)}</div>`).join('')}</div>`);
  }
  const classes = item.classes ? item.classes.map(c => CLASSES[c]?.name).join(', ') : 'All classes';
  return `<div class="item-tip">
    <div class="item-name rarity-text rarity-${item.rarity} ${item.unique ? 'unique-name' : ''} ${item.set ? 'set-name' : ''}">${esc(item.name)}</div>
    <div class="muted small">${item.unique ? '<span class="unique-name">Unique</span>' : item.set ? '<span class="set-name">Set item</span>' : rarityLabel(item.rarity)} ${esc(SLOTS[item.slot]?.label || '')} · Item level ${item.level}</div>
    ${lines.join('')}
    <div class="muted small">Requires level ${item.requiredLevel} · ${esc(classes)}</div>
  </div>`;
}

// Generic hover tooltip: elements with data-tip="html" get a floating tooltip
let tipEl = null;
export function initTooltips() {
  tipEl = document.createElement('div');
  tipEl.id = 'tooltip';
  document.body.appendChild(tipEl);
  document.addEventListener('mouseover', e => {
    const t = e.target.closest('[data-tip]');
    if (!t) { tipEl.style.display = 'none'; return; }
    tipEl.innerHTML = t.dataset.tip;
    tipEl.style.display = 'block';
  });
  document.addEventListener('mousemove', e => {
    if (tipEl.style.display !== 'block') return;
    const pad = 14;
    let x = e.clientX + pad, y = e.clientY + pad;
    const r = tipEl.getBoundingClientRect();
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - pad;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - pad;
    tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
  });
  document.addEventListener('click', () => { tipEl.style.display = 'none'; }, true);
}
export const tipAttr = html => `data-tip="${esc(html)}"`;

// ---- premium currency helpers
export const premiumTxt = n => `<span class="premium-text">💠 ${fmt(n)}</span>`;
export async function confirmSpend(cost, what) {
  return confirmBox(`Spend ${cost} Ashen Crystal${cost === 1 ? '' : 's'} to ${what}?`, `Spend 💠 ${cost}`);
}
