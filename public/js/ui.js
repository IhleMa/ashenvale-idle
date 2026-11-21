// UI helpers: escaping, formatting, toasts, modals, tooltips.
import { STAT_LABELS, PCT_STATS, SLOTS, AFFIXES, AFFIX_LIMITS, itemStats, affixValue, tierRange, isSoulbound, ITEM_BASES } from '/shared/data/items.js';
import { GEM_KINDS, gemName, gemText, parseGemKey, affixPlan, gearItemStats, COMBAT_GEMS } from '/shared/gems.js';
import { rarityById } from '/shared/config.js';
import { CLASSES } from '/shared/data/classes.js';
import { UNIQUES, SETS, equippedSetCounts } from '/shared/data/legendaries.js';
import { cosmetic } from '/shared/data/cosmetics.js';
import { state } from './state.js';

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

// 🤖 marker for bot players (server decides whether it is shown)
export const botTag = x => (x?.bot ? ' <span class="bot-tag" title="Bot player">🤖</span>' : '');

// ---- cosmetics: how other players see a name / portrait (state.cosmetics: name → { color, title, frame })
const cosOf = name => (name === state.player?.name ? state.player?.cosmetics?.equipped : state.cosmetics?.[name]) || {};
export function nameStyle(colorId) {
  const c = cosmetic('color', colorId);
  if (!c) return { cls: '', style: '' };
  if (c.gradient) return { cls: `pname-grad${c.animated ? ' pname-anim' : ''}`, style: `--pg:linear-gradient(90deg,${c.gradient.join(',')})` };
  return { cls: '', style: `color:${c.color}` };
}
// the player's name in their colour, followed by their title (title: false to leave it out)
export function nameHtml(name, { title = true, colorId, titleId } = {}) {
  const cos = cosOf(name);
  const st = nameStyle(colorId === undefined ? cos.color : colorId);
  const t = cosmetic('title', titleId === undefined ? cos.title : titleId);
  return `<span class="pname ${st.cls}" ${st.style ? `style="${st.style}"` : ''}>${esc(name)}</span>${title && t ? ` <span class="ptitle">${esc(t.name)}</span>` : ''}`;
}
// a player's hero (★ character) shares the player's name colour
export function heroNameHtml(heroName, ownerName) {
  const st = nameStyle(ownerName ? cosOf(ownerName).color : null);
  return st.cls || st.style ? `<span class="pname ${st.cls}" ${st.style ? `style="${st.style}"` : ''}>${esc(heroName)}</span>` : esc(heroName);
}
export function frameStyle(frameId) {
  const f = cosmetic('frame', frameId);
  if (!f) return null;
  const cols = f.colors || ['#888', '#444'];
  return { cls: `cos-frame${f.animated ? ' cos-frame-anim' : ''}${f.style === 'double' ? ' cos-frame-double' : ''}${f.fx ? ` cos-fx-${f.fx}` : ''}`,
    style: `--cf-cols:${[...cols, cols[0]].join(',')};--cf-c1:${cols[0]};--cf-c2:${cols[1] || cols[0]};--cf-c3:${cols[2] || cols[1] || cols[0]};--cf-glow:${f.glow || cols[0]}` };
}
// profile border around the inspect window (and its preview in the Wardrobe)
export function borderStyle(borderId) {
  const f = cosmetic('border', borderId);
  if (!f) return null;
  const cols = f.colors || ['#888', '#444'];
  return { cls: `cos-border cos-bfx-${f.fx || 'shine'}`, style: `--cf-cols:${[...cols, cols[0]].join(',')};--cf-c1:${cols[0]};--cf-c2:${cols[1] || cols[0]};--cf-c3:${cols[2] || cols[1] || cols[0]};--cf-glow:${f.glow || cols[0]}` };
}
export const borderOf = name => cosOf(name).border || null;
// wrap a portrait in the owner's frame (if they wear one)
export function framed(portraitHtml, name, frameId) {
  const st = frameStyle(frameId === undefined ? cosOf(name).frame : frameId);
  return st ? `<span class="${st.cls}" style="${st.style}">${portraitHtml}</span>` : portraitHtml;
}

export function confirmBox(text, okLabel = 'Confirm', { html = false } = {}) {
  return new Promise(resolve => {
    const m = modal(`<p>${html ? text : esc(text)}</p><div class="row end gap"><button class="btn" data-close>Cancel</button><button class="btn primary" data-ok>${esc(okLabel)}</button></div>`, { onClose: () => resolve(false) });
    m.el.querySelector('[data-ok]').addEventListener('click', () => { resolve(true); m.el.parentElement.remove(); });
  });
}

// Asks for a short text; resolves to the text or null
export function promptBox(text, value = '', okLabel = 'OK', maxLength = 24) {
  return new Promise(resolve => {
    let done = false;
    const m = modal(`<p>${esc(text)}</p><input class="prompt-input" maxlength="${maxLength}" value="${esc(value)}"><div class="row end gap" style="margin-top:10px"><button class="btn" data-close>Cancel</button><button class="btn primary" data-ok>${esc(okLabel)}</button></div>`, { onClose: () => { if (!done) resolve(null); } });
    const input = m.el.querySelector('input');
    const ok = () => { done = true; resolve(input.value); m.close(); };
    input.focus(); input.select();
    input.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
    m.el.querySelector('[data-ok]').addEventListener('click', ok);
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
  const statLine = (k, v, cls = '', tag = '') => `<div class="stat-line ${cls}"><span>${tag}${esc(STAT_LABELS[k] || k)}</span><span>${statValue(k, v)}</span></div>`;
  let lines;
  if (item.affixes) {
    // base (and unique) stats, then every affix with its tier and the tier's value range at this item level
    lines = Object.entries(itemStats({ ...item, affixes: [] })).map(([k, v]) => statLine(k, v, 'implicit-line'));
    const bc = ITEM_BASES[item.baseId]?.baseCrit; // weapons: the base crit chance of attacks made with it
    if (bc) lines.unshift(`<div class="stat-line implicit-line"><span>Base Critical Chance</span><span>${pct(bc)}</span></div>`);
    const bs = ITEM_BASES[item.baseId]?.baseSpeed; // weapons: the base attack speed (100% = normal)
    if (bs) lines.unshift(`<div class="stat-line implicit-line"><span>Base Attack Speed</span><span>${pct(bs, 0)}</span></div>`);
    // prefixes and suffixes in their own groups, each with how many of the possible slots are used
    // socketed gems already applied: tier changes (Keystone), switched-off affixes (Sacrifice), bonuses and the Mirror copy
    const plan = affixPlan(item);
    const groups = ['prefix', 'suffix'].map(type => [type, plan.filter(a => a.type === type)]);
    for (const [type, list] of groups) {
      if (!list.length) continue;
      lines.push(`<div class="affix-group affix-${type}">${type === 'prefix' ? 'Prefixes' : 'Suffixes'} <span class="faint">${list.filter(a => !a.mirror).length}/${AFFIX_LIMITS[type] ?? 3}</span></div>`);
      for (const a of list) {
      const def = AFFIXES[a.stat];
      const [lo, hi] = tierRange(a.stat, a.eff ?? a.tier, item.level);
      const fmtV = v => (PCT_STATS.has(a.stat) ? (v * 100).toFixed(1) + '%' : fmt(v));
      const tierTag = a.eff !== a.tier ? `<span class="tier-tag t${a.tier} dim">T${a.tier}</span><span class="gem-mark">→</span><span class="tier-tag t${a.eff}">T${a.eff}</span>` : `<span class="tier-tag t${a.tier}" title="${type === 'prefix' ? 'Prefix' : 'Suffix'}: ${esc(def.name)}">T${a.tier}</span>`;
      const boost = !a.mirror && Math.abs(a.mult - 1) > 1e-9 ? ` <span class="gem-mark" title="from socketed gems">◆${a.mult > 1 ? '+' : ''}${Math.round((a.mult - 1) * 100)}%</span>` : '';
      if (a.mirror) lines.push(`<div class="stat-line affix-line affix-${type} mirror-line"><span><span class="gem-mark">◆ Mirror</span> ${esc(def.label)}</span><span>${statValue(a.stat, a.value)}</span></div>`);
      else if (a.off) lines.push(`<div class="stat-line affix-line affix-${type} affix-off" title="Switched off by the Sacrifice gem"><span>${tierTag}<s>${esc(def.label)}</s></span><span class="faint">sacrificed</span></div>`);
      else lines.push(`<div class="stat-line affix-line affix-${type}"><span>${tierTag}${esc(def.label)}${boost}</span><span>${statValue(a.stat, a.value)} <span class="faint small">(${fmtV(lo)}–${fmtV(hi)})</span></span></div>`);
      }
    }
  } else lines = Object.entries(item.stats).map(([k, v]) => statLine(k, v));
  if (compareTo) {
    const mine = gearItemStats(item), theirs = gearItemStats(compareTo);
    const keys = [...new Set([...Object.keys(mine), ...Object.keys(theirs)])];
    const diffs = keys.map(k => [k, (mine[k] || 0) - (theirs[k] || 0)]).filter(([, d]) => Math.abs(d) > 1e-6);
    if (diffs.length) lines.push(`<div class="compare-head muted small">Compared to equipped</div>${diffs.map(([k, d]) => `<div class="stat-line small"><span>${esc(STAT_LABELS[k] || k)}</span><span class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : '−'}${PCT_STATS.has(k) ? (Math.abs(d) * 100).toFixed(1) + '%' : fmt(Math.abs(d))}</span></div>`).join('')}`);
  }
  if (item.enchant) lines.push(`<div class="stat-line enchant-line"><span>✨ Enchanted: ${esc(STAT_LABELS[item.enchant.stat] || item.enchant.stat)}</span><span>${statValue(item.enchant.stat, item.enchant.value)}</span></div>`);
  if (item.sockets?.length) {
    for (const g of item.sockets) {
      const gem = g && parseGemKey(g);
      lines.push(gem ? `<div class="socket-line gem-line"><div><i class="sock-dot full" style="--gem:${GEM_KINDS[gem.kind].color}"></i><b>${esc(gemName(gem.kind, gem.tier))}</b>${COMBAT_GEMS.has(GEM_KINDS[gem.kind].effect) ? ' <span class="faint small">(in combat)</span>' : ''}</div><div class="small muted">${esc(gemText(gem.kind, gem.tier))}</div></div>`
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
    ${isSoulbound(item) ? `<div class="soulbound small">🔒 Soulbound until reforged to item level ${item.statRef.level}</div>` : ''}
    <div class="muted small">Requires level ${item.requiredLevel} · ${esc(classes)}</div>
  </div>`;
}

// Generic hover tooltip: elements with data-tip="html" get a floating tooltip.
// It is always kept fully inside the window: placed next to the cursor, flipped to the other side when there is no
// room, then clamped to the edges (also when its content or size changes while it is shown).
let tipEl = null;
const tipPos = { x: 0, y: 0 };
function placeTip() {
  if (!tipEl || tipEl.style.display !== 'block') return;
  const pad = 14, m = 8;
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  let x = tipPos.x + pad, y = tipPos.y + pad;
  if (x + w > vw - m) x = tipPos.x - w - pad; // no room on the right: left of the cursor
  if (y + h > vh - m) y = tipPos.y - h - pad; // no room below: above the cursor
  x = Math.max(m, Math.min(x, vw - w - m));
  y = Math.max(m, Math.min(y, vh - h - m));
  tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
}
export function initTooltips() {
  tipEl = document.createElement('div');
  tipEl.id = 'tooltip';
  document.body.appendChild(tipEl);
  document.addEventListener('mouseover', e => {
    tipPos.x = e.clientX; tipPos.y = e.clientY;
    const t = e.target.closest('[data-tip]');
    if (!t) { tipEl.style.display = 'none'; return; }
    tipEl.innerHTML = t.dataset.tip;
    tipEl.style.display = 'block';
    placeTip();
  });
  document.addEventListener('mousemove', e => { tipPos.x = e.clientX; tipPos.y = e.clientY; placeTip(); });
  // content that grows after showing (images, live updates) or a resized window
  new ResizeObserver(placeTip).observe(tipEl);
  addEventListener('resize', placeTip);
  document.addEventListener('click', () => { tipEl.style.display = 'none'; }, true);
}
// a capped stat in percent; when over the cap, the uncapped value follows in brackets: "75% (92%)"
export function cappedPct(value, raw, digits = 1) {
  if (!(raw > value + 1e-9)) return pct(value, digits);
  return `${pct(value, digits)} <span class="overcap">(${pct(raw, digits)})</span>`;
}
export const capTip = (cap, raw, digits = 1) => `Capped at ${pct(cap, digits)}.${raw > cap + 1e-9 ? ` You have ${pct(raw, digits)}: ${pct(raw - cap, digits)} over the cap is wasted.` : ''}`;
export const tipAttr = html => `data-tip="${esc(html)}"`;

// ---- premium currency helpers
export const premiumTxt = n => `<span class="premium-text">💠 ${fmt(n)}</span>`;
export async function confirmSpend(cost, what) {
  return confirmBox(`Spend ${cost} Ashen Crystal${cost === 1 ? '' : 's'} to ${what}?`, `Spend 💠 ${cost}`);
}
