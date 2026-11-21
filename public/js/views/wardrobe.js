// Wardrobe: cosmetics bought with gold (no power) — name colours, titles and portrait frames.
// Hovering a card tries it on in the preview; everything worn is shown to other players.
import { morphed } from '../morph.js';
import { state, hero } from '../state.js';
import { act } from '../net.js';
import { esc, fmt, run, toast, tipAttr, confirmBox, nameHtml, nameStyle, framed, borderStyle } from '../ui.js';
import { portrait } from '../assets.js';
import { COSMETICS, COSMETIC_KINDS, COSMETIC_TIERS, ownsCosmetic } from '/shared/data/cosmetics.js';
import { ACHIEVEMENTS } from '/shared/data/achievements.js';

let tab = 'color';
let trying = null; // { kind, id } being tried on (kept across re-renders)
const worn = () => state.player?.cosmetics?.equipped || {};

function previewHtml(trial = {}) {
  const p = state.player, h = hero(), eq = { ...worn(), ...trial };
  const inner = `${h ? framed(portrait(h, 'xl'), p.name, eq.frame || null) : ''}
    <div class="pv-name">${nameHtml(p.name, { colorId: eq.color || null, titleId: eq.title || null })}</div>
    <div class="muted small">${h ? `${esc(h.name)} · Lv ${h.level}` : ''}</div>`;
  const bst = borderStyle(eq.border || null);
  return bst ? `<div class="${bst.cls}" style="${bst.style}"><div class="cos-border-inner">${inner}</div></div>` : inner;
}

function sample(kind, c) {
  const p = state.player, h = hero();
  if (kind === 'color') { const st = nameStyle(c.id); return `<span class="pname ${st.cls}" style="${st.style}">${esc(p.name)}</span>`; }
  if (kind === 'title') return `<span>${esc(p.name)} <span class="ptitle">${esc(c.name)}</span></span>`;
  if (kind === 'border') { const st = borderStyle(c.id); return `<div class="${st.cls} cos-border-mini" style="${st.style}"><div class="cos-border-inner"><b>${esc(p.name)}</b><div class="muted small">${h ? esc(h.name) : ''}</div></div></div>`; }
  return h ? framed(portrait(h, 'md'), p.name, c.id) : '';
}

function cardHtml(kind, c) {
  const p = state.player;
  const own = ownsCosmetic(p, kind, c.id), on = worn()[kind] === c.id;
  const ach = c.achievement && ACHIEVEMENTS[c.achievement];
  let btn;
  if (on) btn = `<button class="btn tiny" data-unwear="${kind}" ${tipAttr('Click to take it off')}>✓ Worn</button>`;
  else if (own) btn = `<button class="btn tiny primary" data-wear="${kind}" data-id="${c.id}">Wear</button>`;
  else if (c.achievement) btn = `<span class="muted small">🏆 Earn “${esc(ach?.name || c.achievement)}”</span>`;
  else btn = `<button class="btn tiny ${p.gold >= c.price ? 'primary' : ''}" data-buy="${kind}" data-id="${c.id}" ${p.gold >= c.price ? '' : 'disabled'}>Buy · ◉ ${fmt(c.price)}</button>`;
  return `<div class="cos-card ${on ? 'worn' : ''}" data-try="${kind}" data-id="${c.id}" ${ach && !own ? tipAttr(esc(ach.description || '')) : ''}>
    <div class="row between"><b>${esc(c.name)}</b><span class="cos-tier cos-tier-${esc(c.tier || 'basic')}">${esc(COSMETIC_TIERS[c.tier] || c.tier || '')}</span></div>
    <div class="cos-sample">${sample(kind, c)}</div>
    <div class="row between">${own && !on ? '<span class="muted small">Owned</span>' : '<span></span>'}${btn}</div>
  </div>`;
}

export const wardrobeView = {
  id: 'wardrobe', label: 'Wardrobe', icon: '👑',
  mount(root) {
    root.addEventListener('click', async e => {
      const t = e.target.closest('button');
      if (!t) return;
      const d = t.dataset;
      if (d.tab) { tab = d.tab; this.render(root); return; }
      if (d.buy) {
        const c = COSMETICS[d.buy][d.id];
        if (!await confirmBox(`Buy the ${COSMETIC_KINDS[d.buy].label.toLowerCase()} “${c.name}” for ${fmt(c.price)} gold? Cosmetics change only how you look.`, 'Buy')) return;
        if (await run(act('cosmetic_buy', { kind: d.buy, id: d.id })) !== undefined) toast(`👑 ${c.name} is yours — and you're wearing it.`, 'success');
        return;
      }
      if (d.wear) { await run(act('cosmetic_equip', { kind: d.wear, id: d.id })); return; }
      if (d.unwear) { await run(act('cosmetic_equip', { kind: d.unwear, id: null })); return; }
    });
    // try on: hovering a card shows it in the preview (no re-render)
    root.addEventListener('mouseover', e => {
      const card = e.target.closest('[data-try]');
      const next = card ? { kind: card.dataset.try, id: card.dataset.id } : null;
      if (JSON.stringify(next) === JSON.stringify(trying)) return;
      trying = next;
      const pv = root.querySelector('[data-preview]');
      if (pv) pv.innerHTML = previewHtml(trying ? { [trying.kind]: trying.id } : {});
    });
    root.addEventListener('mouseleave', () => { trying = null; const pv = root.querySelector('[data-preview]'); if (pv) pv.innerHTML = previewHtml(); });
  },
  render(root) {
    const p = state.player;
    const list = Object.values(COSMETICS[tab] || {}).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const owned = k => Object.values(COSMETICS[k] || {}).filter(c => ownsCosmetic(p, k, c.id)).length;
    morphed(root).innerHTML = `<div class="wardrobe-layout">
      <section class="panel wardrobe-preview">
        <h3>👑 Wardrobe</h3>
        <div data-preview>${previewHtml(trying ? { [trying.kind]: trying.id } : {})}</div>
        <p class="muted small">Hover a cosmetic to try it on. What you wear is shown to other players: in chat, rankings, groups, the arena, combat and when they inspect you (the profile border goes around your inspect window). Cosmetics give no power.</p>
        ${p.stats?.cosmeticGold ? `<p class="small">Spent on cosmetics: <b>◉ ${fmt(p.stats.cosmeticGold)}</b></p>` : ''}
      </section>
      <section class="panel">
        <div class="row gap wrap tabs">${Object.entries(COSMETIC_KINDS).map(([k, v]) => `<button class="btn small ${tab === k ? 'primary' : 'ghost'}" data-tab="${k}">${esc(v.plural)} <span class="muted small">${owned(k)}/${Object.keys(COSMETICS[k] || {}).length}</span></button>`).join('')}</div>
        <div class="cos-grid" style="margin-top:12px">${list.map(c => cardHtml(tab, c)).join('') || '<p class="muted">Nothing here yet.</p>'}</div>
      </section>
    </div>`;
  },
};
