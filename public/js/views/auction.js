// Auction House: browse/buy, sell, manage listings, mailbox.
import { featureLock } from '/shared/unlocks.js';
import { state, chars } from '../state.js';
import { act } from '../net.js';
import { esc, fmt, run, toast, tipAttr, itemTooltipHtml, duration, confirmBox, premiumTxt } from '../ui.js';
import { itemIcon, materialIcon } from '../assets.js';
import { CONFIG } from '/shared/config.js';
import { SLOTS, itemSellValue } from '/shared/data/items.js';
import { MATERIALS, MATERIAL_IDS } from '/shared/data/town.js';
import { CLASSES } from '/shared/data/classes.js';

const ui = { tab: 'browse', q: { kind: 'all', query: '', slot: '', rarity: '', usableBy: '', sort: 'newest', page: 0, minLevel: '', maxLevel: '' }, sellItem: null, sellMat: 'ore', sellQty: 10, price: '', hours: 24 };
let results = null;
let mine = null;
let searchTimer = null;
const now = () => Date.now() + (state.timeOffset || 0);

const goldTxt = n => `<span class="gold-text">◉ ${fmt(n)}</span>`;

async function search(root) {
  try { results = await act('ah_search', ui.q); } catch (e) { toast(e.message, 'error'); }
  renderBody(root);
}
async function loadMine(root) {
  try { mine = await act('ah_mine'); } catch (e) { toast(e.message, 'error'); }
  renderBody(root);
}

function listingName(l) {
  if (l.kind === 'material') return `${materialIcon(l.material, 'sm')}<span><b>${fmt(l.qty)}× ${esc(MATERIALS[l.material].name)}</b><small class="muted">${goldTxt(l.unitPrice)} each</small></span>`;
  const it = l.item;
  return `${itemIcon(it, 'sm')}<span ${tipAttr(itemTooltipHtml(it))}><b class="rarity-text rarity-${it.rarity} ${it.unique ? 'unique-name' : ''} ${it.set ? 'set-name' : ''}">${esc(it.name)}</b><small class="muted">ilvl ${it.level} · ${esc(SLOTS[it.slot]?.label || '')}${it.classes ? ' · ' + it.classes.map(c => CLASSES[c].name).join('/') : ''}</small></span>`;
}

function browseHtml() {
  const q = ui.q;
  const p = state.player;
  const rows = results?.rows || [];
  return `
    <div class="ah-filters row gap wrap">
      <input data-q="query" placeholder="Search name or seller…" value="${esc(q.query)}">
      <select data-q="kind">${[['all', 'Everything'], ['items', 'Equipment'], ['materials', 'Materials']].map(([v, l]) => `<option value="${v}" ${q.kind === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select data-q="slot"><option value="">Any slot</option>${Object.entries(SLOTS).map(([id, s]) => `<option value="${id}" ${q.slot === id ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select>
      <select data-q="rarity"><option value="">Any rarity</option><option value="special" ${q.rarity === 'special' ? 'selected' : ''}>Uniques & sets</option>${CONFIG.rarities.slice(1).map(r => `<option value="${r.id}" ${q.rarity === r.id ? 'selected' : ''}>${esc(r.label)}+</option>`).join('')}</select>
      <select data-q="usableBy"><option value="">Usable by anyone</option>${chars().map(c => `<option value="${c.id}" ${q.usableBy === c.id ? 'selected' : ''}>Usable by ${esc(c.name)}</option>`).join('')}</select>
      <input data-q="minLevel" type="number" min="1" max="60" placeholder="min lvl" value="${esc(q.minLevel)}">
      <input data-q="maxLevel" type="number" min="1" max="60" placeholder="max lvl" value="${esc(q.maxLevel)}">
      <select data-q="sort">${[['newest', 'Newest'], ['price', 'Price ↑'], ['priceDesc', 'Price ↓'], ['level', 'Item level'], ['ending', 'Ending soon']].map(([v, l]) => `<option value="${v}" ${q.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </div>
    ${results ? `<div class="muted small">${results.total} listing${results.total === 1 ? '' : 's'}</div>` : '<p class="muted">Loading…</p>'}
    <table class="ah-table">
      <thead><tr><th>Item</th><th>Seller</th><th>Time left</th><th class="num">Recent avg.</th><th class="num">Price</th><th></th></tr></thead>
      <tbody>${rows.map(l => `<tr class="${l.mine ? 'mine' : ''}">
        <td><span class="ah-item">${listingName(l)}</span></td>
        <td>${esc(l.sellerName)}${l.mine ? ' <span class="tag">YOU</span>' : ''}</td>
        <td class="muted">${duration(Math.max(0, (l.expiresAt - now()) / 1000))}</td>
        <td class="num muted">${l.avg ? goldTxt(l.avg) + (l.kind === 'material' ? '/ea' : '') : '—'}</td>
        <td class="num"><b>${goldTxt(l.price)}</b></td>
        <td class="num">${l.mine ? '' : `<button class="btn tiny primary" data-buy="${l.id}" ${p.gold < l.price ? 'disabled title="Not enough gold"' : ''}>Buy</button>`}</td>
      </tr>`).join('') || '<tr><td colspan="6" class="muted">No listings match.</td></tr>'}</tbody>
    </table>
    ${results && results.total > results.pageSize ? `<div class="row gap center-row"><button class="btn tiny" data-page="-1" ${results.page === 0 ? 'disabled' : ''}>‹ Prev</button><span class="small muted">Page ${results.page + 1} / ${Math.ceil(results.total / results.pageSize)}</span><button class="btn tiny" data-page="1" ${(results.page + 1) * results.pageSize >= results.total ? 'disabled' : ''}>Next ›</button></div>` : ''}`;
}

function sellHtml() {
  const p = state.player;
  const items = p.inventory.filter(i => !i.locked).sort((a, b) => (b.unique || b.set ? 1 : 0) - (a.unique || a.set ? 1 : 0) || b.level - a.level);
  const sel = p.inventory.find(i => i.uid === ui.sellItem) || null;
  const matHave = Math.floor(p.town?.materials?.[ui.sellMat] || 0);
  const price = Number(ui.price) || 0;
  const fee = Math.max(1, Math.round(price * (state.ahFee ?? 2) / 100));
  return `<div class="ah-sell">
    <div>
      <h4>Equipment <span class="muted small">(unlocked items in your inventory)</span></h4>
      <div class="item-grid ah-sell-grid">${items.map(i => `<button class="item-cell ${i.uid === ui.sellItem ? 'active' : ''} ${i.unique ? 'unique' : ''} ${i.set ? 'set' : ''}" data-sell-item="${i.uid}" ${tipAttr(itemTooltipHtml(i))}>${itemIcon(i, 'sm')}<span class="ilvl">${i.level}</span></button>`).join('') || '<p class="muted small">Nothing to sell. Equipped and locked items can\'t be listed.</p>'}</div>
      <h4>…or materials</h4>
      <div class="row gap wrap">
        <select data-sell-mat>${MATERIAL_IDS.map(m => `<option value="${m}" ${ui.sellMat === m ? 'selected' : ''}>${esc(MATERIALS[m].name)} (${fmt(Math.floor(p.town?.materials?.[m] || 0))})</option>`).join('')}</select>
        <label class="inline small">Amount <input type="number" data-sell-qty min="1" max="${matHave}" value="${Math.min(ui.sellQty, Math.max(1, matHave))}"></label>
        <button class="btn small ${ui.sellItem ? '' : 'primary'}" data-sell-mode-mat>Sell materials</button>
      </div>
    </div>
    <div class="panel ah-sell-form">
      <h4>Create listing</h4>
      ${sel ? `<div class="row gap">${itemIcon(sel, 'md')}<div>${itemTooltipHtml(sel)}<div class="small muted">Vendor value: ${goldTxt(itemSellValue(sel))}</div></div></div>`
        : `<div class="row gap">${materialIcon(ui.sellMat, 'md')}<div><b>${fmt(Math.min(ui.sellQty, matHave))}× ${esc(MATERIALS[ui.sellMat].name)}</b><div class="small muted">You have ${fmt(matHave)}</div></div></div>`}
      <label class="inline">Buyout price <input type="number" data-price min="1" step="1" value="${esc(ui.price)}" placeholder="gold"></label>
      <label class="inline">Duration <select data-hours>${[12, 24, 48].map(h => `<option value="${h}" ${ui.hours === h ? 'selected' : ''}>${h} hours</option>`).join('')}</select></label>
      <div class="small muted">Listing fee: ${goldTxt(fee)} (${state.ahFee ?? 2}%, not refunded) · sales tax ${state.ahTax ?? 5}% is taken when it sells. Unsold items return by mail.</div>
      <button class="btn primary" data-list ${price >= 1 && (sel || matHave > 0) ? '' : 'disabled'}>List for ${goldTxt(price)}</button>
    </div>
  </div>`;
}

function mineHtml() {
  if (!mine) return '<p class="muted">Loading…</p>';
  return `<table class="ah-table"><thead><tr><th>Item</th><th>Time left</th><th class="num">Price</th><th></th></tr></thead>
    <tbody>${mine.map(l => `<tr><td><span class="ah-item">${listingName(l)}</span></td><td class="muted">${l.expiresAt > now() ? duration((l.expiresAt - now()) / 1000) : 'expired'}</td>
      <td class="num">${goldTxt(l.price)}</td><td class="num"><button class="btn tiny ghost danger" data-cancel="${l.id}">Cancel</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">You have no active auctions.</td></tr>'}</tbody></table>`;
}

function mailHtml() {
  const mail = [...(state.player.mailbox || [])].reverse();
  return `<div class="row between"><span class="muted small">Gold from sales, expired auctions, gifts and loot that didn't fit in your bags arrive here.</span>${mail.length ? '<button class="btn small primary" data-collect-all>Collect all</button>' : ''}</div>
    <div class="mail-list">${mail.map(m => `<div class="mail">
      <div class="grow"><b>${esc(m.from)}</b> <span class="muted small">${new Date(m.at).toLocaleString()}</span><div class="small">${esc(m.note || '')}</div>
        <div class="row gap wrap small">${m.item ? `<span ${tipAttr(itemTooltipHtml(m.item))}>${itemIcon(m.item, 'xs')} <span class="rarity-text rarity-${m.item.rarity} ${m.item.unique ? 'unique-name' : ''} ${m.item.set ? 'set-name' : ''}">${esc(m.item.name)}</span></span>` : ''}
        ${m.gold ? goldTxt(m.gold) : ''}${m.premium ? ' ' + premiumTxt(m.premium) : ''}${m.materials ? Object.entries(m.materials).map(([k, v]) => `<span class="cost">${materialIcon(k, 'xxs')} ${fmt(v)}</span>`).join('') : ''}</div></div>
      <button class="btn small" data-collect="${m.id}">Collect</button></div>`).join('') || '<p class="muted">Your mailbox is empty.</p>'}</div>`;
}

function renderBody(root) {
  const host = root.querySelector('.ah-body');
  if (!host) return;
  const lock = ui.tab !== 'mail' && featureLock(state.player, 'auction');
  host.innerHTML = (lock ? `<div class="sync-note">🔒 Buying and selling on the Auction House unlocks at <b>hero level ${lock}</b>. Your mailbox works already.</div>` : '')
    + (ui.tab === 'browse' ? browseHtml() : ui.tab === 'sell' ? sellHtml() : ui.tab === 'mine' ? mineHtml() : mailHtml());
}

export const auctionView = {
  id: 'auction', label: 'Auction House', icon: '⚖',
  mount(root) {
    root.innerHTML = `<section class="panel">
      <div class="panel-head"><h3>Auction House</h3><span class="gold-text">◉ ${fmt(state.player.gold)}</span></div>
      <div class="tabs ah-tabs">${[['browse', 'Browse'], ['sell', 'Sell'], ['mine', 'My auctions'], ['mail', 'Mailbox']].map(([id, l]) => `<button class="tab ${ui.tab === id ? 'active' : ''}" data-tab="${id}">${l}<span class="tab-badge" data-mailcount></span></button>`).join('')}</div>
      <div class="ah-body"></div></section>`;
    const reload = () => { if (ui.tab === 'browse') search(root); else if (ui.tab === 'mine') loadMine(root); else renderBody(root); };
    root.addEventListener('click', async e => {
      const t = e.target.closest('button');
      if (!t) return;
      const d = t.dataset;
      if (d.tab) { ui.tab = d.tab; root.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b === t)); reload(); return; }
      if (d.page) { ui.q.page = Math.max(0, ui.q.page + Number(d.page)); search(root); return; }
      if (d.buy) {
        const l = results.rows.find(x => x.id === d.buy);
        const name = l.kind === 'material' ? `${l.qty}× ${MATERIALS[l.material].name}` : l.item.name;
        if (!await confirmBox(`Buy ${name} for ${fmt(l.price)} gold?`, 'Buy')) return;
        const r = await run(act('ah_buy', { id: d.buy }));
        if (r) toast(`Bought ${r.what}!`, 'success');
        search(root); return;
      }
      if (d.sellItem) { ui.sellItem = ui.sellItem === d.sellItem ? null : d.sellItem; renderBody(root); return; }
      if ('sellModeMat' in d) { ui.sellItem = null; renderBody(root); return; }
      if ('list' in d) {
        const payload = ui.sellItem ? { itemUid: ui.sellItem } : { material: ui.sellMat, qty: ui.sellQty };
        const r = await run(act('ah_list', { ...payload, price: Number(ui.price), hours: ui.hours }));
        if (r) { toast(`Listed! Fee paid: ${r.fee} gold.`, 'success'); ui.sellItem = null; ui.price = ''; }
        return;
      }
      if (d.cancel && await confirmBox('Cancel this auction? The listing fee is not refunded.', 'Cancel auction')) { await run(act('ah_cancel', { id: d.cancel })); loadMine(root); return; }
      if (d.collect || 'collectAll' in d) { const r = await run(act('collect_mail', d.collect ? { id: d.collect } : {})); if (r?.skipped) toast(`${r.skipped} item(s) stayed in the mailbox — your inventory is full.`, 'error'); }
    });
    root.addEventListener('change', e => {
      const t = e.target;
      if (t.dataset.q) { ui.q[t.dataset.q] = t.value; ui.q.page = 0; if (t.dataset.q !== 'query') search(root); return; }
      if (t.matches('[data-sell-mat]')) { ui.sellMat = t.value; ui.sellItem = null; renderBody(root); }
      if (t.matches('[data-hours]')) ui.hours = Number(t.value);
    });
    root.addEventListener('input', e => {
      const t = e.target;
      if (t.dataset.q === 'query') { ui.q.query = t.value; ui.q.page = 0; clearTimeout(searchTimer); searchTimer = setTimeout(() => search(root), 300); }
      if (t.matches('[data-price]')) { ui.price = t.value; const b = root.querySelector('[data-list]'); if (b) { b.disabled = !(Number(t.value) >= 1); b.innerHTML = `List for <span class="gold-text">◉ ${fmt(Number(t.value) || 0)}</span>`; } }
      if (t.matches('[data-sell-qty]')) ui.sellQty = Math.max(1, Number(t.value) || 1);
    });
    reload();
  },
  render(root) {
    const g = root.querySelector('.panel-head .gold-text');
    if (g) g.textContent = `◉ ${fmt(state.player.gold)}`;
    const n = (state.player.mailbox || []).length;
    const mb = root.querySelector('[data-tab="mail"] .tab-badge');
    if (mb) mb.textContent = n ? ` (${n})` : '';
    if (ui.tab === 'mail' || ui.tab === 'sell') renderBody(root);
    if (ui.tab === 'mine') loadMine(root);
  },
};
