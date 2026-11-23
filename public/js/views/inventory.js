// Inventory panel (shown on the Character page): browse, compare, equip (also by drag & drop), lock and sell loot.
import { state, chars, bus } from '../state.js';
import { act } from '../net.js';
import { esc, fmt, run, itemTooltipHtml, tipAttr, rarityLabel, confirmBox, toast, modal, promptBox } from '../ui.js';
import { itemIcon } from '../assets.js';
import { CONFIG, rarityIndex } from '/shared/config.js';
import { SLOTS, canEquip, itemSellValue } from '/shared/data/items.js';
import { CLASSES } from '/shared/data/classes.js';
import { MATERIALS } from '/shared/data/town.js';
import { salvageYield } from '/shared/town.js';
import { maxSockets } from '/shared/data/items.js';
import { openSockets } from './gems.js';
import { statOptions, tierOptions } from './auction.js';
import { AFFIXES, PCT_STATS } from '/shared/data/items.js';
import { gearItemStats } from '/shared/gems.js';
import { FILTER_ACTIONS } from '/shared/lootfilter.js';
import { filterHtml, logHtml, inventoryVerdicts, handleFilterClick, handleFilterChange, filterIsDirty } from './lootfilter.js';

let filterSlot = 'all';
let filterRarity = 'all';
let sortBy = 'rarity';
let selectedUid = null;
let compareCharId = null;

// ---- Highlight: mark every item that has a stat (with a minimum value and/or affix tier) or matches a text search.
// Kept in this browser between visits. Typing only toggles classes on the cells, so the input never loses focus.
const HL_KEY = 'ashenvale.invHighlight';
const hl = (() => { try { return { text: '', rows: [], mode: 'all', only: false, ...JSON.parse(localStorage.getItem(HL_KEY) || '{}') }; } catch { return { text: '', rows: [], mode: 'all', only: false }; } })();
const saveHl = () => { try { localStorage.setItem(HL_KEY, JSON.stringify(hl)); } catch {} };
const hlRows = () => hl.rows.filter(r => r.stat);
const hlActive = () => !!(hl.text.trim() || hlRows().length);
const statLabel = k => AFFIXES[k]?.label || k;
// every word must appear in the item's name, rarity, slot or one of its stats (also used by the salvage yard)
export function itemTextMatch(it, text, stats = gearItemStats(it)) {
  const words = String(text || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [it.name, it.rarity, SLOTS[it.slot]?.label, ...Object.keys(stats).filter(k => stats[k]).map(statLabel)].join(' ').toLowerCase();
  return words.every(w => hay.includes(w));
}
export function hlMatch(it) {
  const stats = gearItemStats(it);
  if (!itemTextMatch(it, hl.text, stats)) return false;
  const rows = hlRows();
  if (!rows.length) return true;
  const ok = r => {
    const v = stats[r.stat] || 0;
    if (!v) return false;
    if (r.min !== '' && r.min != null && v < (PCT_STATS.has(r.stat) ? Number(r.min) / 100 : Number(r.min)) - 1e-9) return false;
    if (r.tier && !(it.affixes || []).some(a => a.stat === r.stat && a.tier <= Number(r.tier))) return false;
    return true;
  };
  return hl.mode === 'any' ? rows.some(ok) : rows.every(ok);
}
const hlClass = it => !hlActive() ? '' : hlMatch(it) ? 'hl' : hl.only ? 'hl-dim hl-hide' : 'hl-dim';
// re-mark the cells in place (no re-render)
function applyHighlight(root) {
  const panel = root.querySelector('.inv-panel');
  if (!panel) return;
  let n = 0;
  for (const cell of panel.querySelectorAll('.item-cell[data-item]')) {
    const it = state.player.inventory.find(i => i.uid === cell.dataset.item);
    cell.classList.remove('hl', 'hl-dim', 'hl-hide');
    const c = it ? hlClass(it) : '';
    if (c) cell.classList.add(...c.split(' '));
    if (c === 'hl') n++;
  }
  const cnt = panel.querySelector('[data-hl-count]');
  if (cnt) cnt.textContent = hlActive() ? `${n} match${n === 1 ? '' : 'es'}` : '';
}
// ---- saved filters: slot/rarity/sort + highlight under a name, applied with one click (kept on the account)
const filterState = () => ({ slot: filterSlot, rarity: filterRarity, sort: sortBy, hl: { text: hl.text, rows: hl.rows.filter(r => r.stat).map(r => ({ ...r })), mode: hl.mode, only: hl.only } });
const normFilter = f => JSON.stringify([f.slot, f.rarity, f.sort, f.hl.text, f.hl.mode, !!f.hl.only, f.hl.rows.map(r => [r.stat, String(r.min ?? ''), String(r.tier ?? '')])]);
const sameFilter = (a, b) => normFilter(a) === normFilter(b);
function presetsHtml(p) {
  const list = p.settings.invPresets || [];
  const now = filterState();
  return `<div class="row gap wrap small inv-presets"><span class="muted">Saved:</span>
    ${list.map((f, i) => `<span class="inv-preset ${sameFilter({ slot: f.slot, rarity: f.rarity, sort: f.sort, hl: f.hl }, now) ? 'active' : ''}"><button class="btn tiny" data-preset="${i}" ${tipAttr(presetTip(f))}>${esc(f.name)}</button><button class="btn tiny ghost" data-preset-del="${i}" title="Delete">✕</button></span>`).join('') || '<span class="faint">none yet</span>'}
    ${list.length < 12 ? `<button class="btn tiny ghost" data-preset-save ${tipAttr('Save the current slot, rarity, sorting and highlight as a filter you can apply with one click')}>＋ Save current</button>` : ''}
    ${list.length || hlActive() || filterSlot !== 'all' || filterRarity !== 'all' ? '<button class="btn tiny ghost" data-preset-reset title="Show everything again">Reset</button>' : ''}
  </div>`;
}
function presetTip(f) {
  const parts = [];
  if (f.slot !== 'all') parts.push(f.slot === 'usable' ? 'usable by the selected character' : SLOTS[f.slot]?.label || f.slot);
  if (f.rarity !== 'all') parts.push(f.rarity === 'special' ? 'uniques & sets' : CONFIG.rarities.find(r => r.id === f.rarity)?.label || f.rarity);
  if (f.hl.text) parts.push(`“${f.hl.text}”`);
  for (const r of f.hl.rows) parts.push(`${statLabel(r.stat)}${r.min !== '' ? ` ≥ ${r.min}${PCT_STATS.has(r.stat) ? '%' : ''}` : ''}${r.tier ? ` (T${r.tier}+)` : ''}`);
  return esc(parts.join(' · ') || 'everything') + (f.hl.only ? '<br><span class="muted">only matches shown</span>' : '');
}
async function savePresets(list) { await run(act('set_settings', { invPresets: list })); }

function highlightHtml(items) {
  const n = hlActive() ? items.filter(hlMatch).length : 0;
  return `<div class="hl-bar">
    <div class="row gap wrap small">
      <input type="search" class="hl-text" data-hl-text value="${esc(hl.text)}" placeholder="✨ Highlight: name or stat, e.g. crit fire">
      <button class="btn tiny" data-hl-add title="Highlight items with a stat, optionally with a minimum value or affix tier">＋ Stat</button>
      ${hl.rows.length > 1 ? `<label class="inline">must have <select data-hl-mode><option value="all" ${hl.mode !== 'any' ? 'selected' : ''}>all</option><option value="any" ${hl.mode === 'any' ? 'selected' : ''}>any</option></select></label>` : ''}
      <label class="inline"><input type="checkbox" data-hl-only ${hl.only ? 'checked' : ''}> only show matches</label>
      <span class="muted" data-hl-count>${hlActive() ? `${n} match${n === 1 ? '' : 'es'}` : ''}</span>
      ${hlActive() || hl.rows.length ? '<button class="btn tiny ghost" data-hl-clear>Clear</button>' : ''}
    </div>
    ${hl.rows.map((r, i) => `<div class="row gap wrap small hl-row">
      <select data-hl="stat" data-i="${i}"><option value="">Choose a stat…</option>${statOptions(r.stat)}</select>
      <label class="inline">at least <input type="number" step="any" min="0" class="af-min" data-hl="min" data-i="${i}" value="${esc(r.min ?? '')}" placeholder="any">${r.stat && PCT_STATS.has(r.stat) ? ' %' : ''}</label>
      <select data-hl="tier" data-i="${i}">${tierOptions(r.tier, 'Any tier')}</select>
      <button class="btn tiny ghost danger" data-hl-del="${i}" title="Remove">✕</button></div>`).join('')}
  </div>`;
}

// Loot filter editor and the filtered-loot log open in a modal (tabs inside), so the page layout stays as it is.
// after = called when the modal closes (to refresh the badges on the inventory)
export function openLootFilter(which = 'filter', after = null) {
  let t = which;
  const unsub = bus.on('msg:state', () => setTimeout(() => draw(false), 0));
  const m = modal('<div class="lf-modal"></div>', { wide: true, onClose: () => { unsub?.(); after?.(); } });
  const host = m.el.querySelector('.lf-modal');
  function draw(force) {
    if (!host.isConnected) return;
    // never rebuild while the player types or picks in the editor
    if (!force && host.contains(document.activeElement) && document.activeElement.matches('input, select, textarea')) return;
    const p = state.player;
    host.innerHTML = `<div class="tabs">${[['filter', `🧹 Loot filter ${p.lootFilter?.enabled ? '<span class="tag done">ON</span>' : '<span class="tag">OFF</span>'}${filterIsDirty() ? ' •' : ''}`], ['log', `📜 Filtered loot${(p.lootLog || []).length ? ` <span class="muted small">${p.lootLog.length}</span>` : ''}`]].map(([id, l]) => `<button class="tab ${t === id ? 'active' : ''}" data-lf-tab="${id}">${l}</button>`).join('')}</div>`
      + (t === 'filter' ? filterHtml() : logHtml());
  }
  host.addEventListener('click', async e => {
    const tb = e.target.closest('[data-lf-tab]');
    if (tb) { t = tb.dataset.lfTab; draw(true); return; }
    await handleFilterClick(e, () => draw(true));
  });
  host.addEventListener('change', e => handleFilterChange(e, () => draw(true)));
  draw(true);
  return m;
}

// The inventory lives on the Character page, next to the equipment (see views/character.js):
// - hovering an item compares it with what the selected character wears in that slot (or says it can't use it)
// - items can be dragged onto the equipment slots (swapping with what is there) and equipped gear dragged back
// - the loot filter and the filtered-loot log open in the same panel, which then spans the full width
export const invTab = () => 'items'; // loot filter and log are in a modal now
let dragging = false;
export const isDragging = () => dragging;

// why a character can't use an item ('' if it can)
export function unusableReason(item, ch) {
  if (!ch || canEquip(item, ch)) return '';
  if (item.classes && !item.classes.includes(ch.classId)) return `${CLASSES[ch.classId].name}s can't use this`;
  return `Requires level ${item.requiredLevel}`;
}
// the item's tooltip as the selected character sees it: compared with its gear, or marked as unusable
export function invTooltip(item, ch) {
  const why = unusableReason(item, ch);
  if (!ch || why) return itemTooltipHtml(item) + (ch ? `<div class="unusable-note">✖ ${esc(ch.name)}: ${esc(why)}</div>` : '');
  const eq = ch.equipment[item.slot];
  return itemTooltipHtml(item, eq || null, ch) + (eq ? '' : `<div class="small up">Empty slot on ${esc(ch.name)} — drag to equip</div>`);
}

export function inventoryPanelHtml(ch) {
  const p = state.player;
  const tabs = `<div class="panel-head inv-head"><h3>🎒 Inventory <span class="muted small">${p.inventory.length}/${CONFIG.inventory.limit}</span></h3>
    <div class="row gap"><button class="btn tiny" data-lf-open="filter">🧹 Loot filter ${p.lootFilter?.enabled ? '<span class="tag done">ON</span>' : '<span class="tag">OFF</span>'}${filterIsDirty() ? ' •' : ''}</button>
    <button class="btn tiny ghost" data-lf-open="log">📜 Filtered${(p.lootLog || []).length ? ` <span class="muted small">${p.lootLog.length}</span>` : ''}</button></div></div>`;
  const verdicts = inventoryVerdicts(p);
  let items = [...p.inventory];
  if (filterSlot === 'usable') items = items.filter(i => ch && canEquip(i, ch));
  else if (filterSlot !== 'all') items = items.filter(i => i.slot === filterSlot);
  if (filterRarity === 'special') items = items.filter(i => i.unique || i.set);
  else if (filterRarity !== 'all') items = items.filter(i => i.rarity === filterRarity);
  items.sort(sortBy === 'level' ? (a, b) => b.level - a.level || rarityIndex(b.rarity) - rarityIndex(a.rarity)
    : sortBy === 'slot' ? (a, b) => a.slot.localeCompare(b.slot) || b.level - a.level
      : (a, b) => rarityIndex(b.rarity) - rarityIndex(a.rarity) || b.level - a.level);
  const sel = p.inventory.find(i => i.uid === selectedUid) || null;
  return `<section class="panel inv-panel" data-inv-drop>
    ${tabs}
    <div class="row gap wrap small inv-filters">
      <select data-f-slot><option value="all">All slots</option><option value="usable" ${filterSlot === 'usable' ? 'selected' : ''}>Usable by ${esc(ch?.name || '…')}</option>${Object.entries(SLOTS).map(([id, s]) => `<option value="${id}" ${filterSlot === id ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select>
      <select data-f-rarity><option value="all">All rarities</option><option value="special" ${filterRarity === 'special' ? 'selected' : ''}>Uniques & set items</option>${CONFIG.rarities.map(r => `<option value="${r.id}" ${filterRarity === r.id ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select>
      <select data-f-sort>${[['rarity', 'Sort: rarity'], ['level', 'Sort: level'], ['slot', 'Sort: slot']].map(([v, l]) => `<option value="${v}" ${sortBy === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </div>
    ${presetsHtml(p)}
    ${highlightHtml(items)}
    ${p.inventory.length >= CONFIG.inventory.limit ? `<div class="notice small">Inventory full — new loot is ${p.settings.autoLootAction === 'salvage' ? 'salvaged' : 'sold'} automatically. Set up the <a href="#" data-lf-open="filter">loot filter</a> to decide what to keep.</div>` : ''}
    <div class="item-grid">${items.map(i => {
      const no = !!unusableReason(i, ch);
      const v = verdicts.get(i.uid);
      return `<button class="item-cell ${hlClass(i)} ${i.uid === selectedUid ? 'active' : ''} ${i.unique ? 'unique' : ''} ${i.set ? 'set' : ''} ${no ? 'unusable' : ''}" data-item="${i.uid}" draggable="${no ? 'false' : 'true'}" ${tipAttr(invTooltip(i, ch))}>${itemIcon(i, 'md')}${i.locked ? '<span class="lock">🔒</span>' : ''}${no ? '<span class="no-use">✖</span>' : ''}${v && v.action !== 'keep' ? `<span class="lf-badge" title="Loot filter: ${FILTER_ACTIONS[v.action].label}">${FILTER_ACTIONS[v.action].icon}</span>` : ''}<span class="ilvl">${i.level}</span></button>`;
    }).join('') || '<p class="muted pad">No items match.</p>'}</div>
    <div class="row gap wrap small sell-bar">
      <span class="muted">Quick sell:</span>${CONFIG.rarities.slice(0, 4).map(r => `<button class="btn tiny ghost" data-sell-rarity="${r.id}">≤ ${esc(r.label)}</button>`).join('')}
      <span class="grow"></span>
      <button class="btn tiny" data-lf-open="filter">🧹 ${p.lootFilter?.enabled ? `${p.lootFilter.rules.filter(r => r.enabled).length} rule(s)` : 'Loot filter: off'}</button>
    </div>
    ${sel ? `<div class="item-detail">${detailHtml(sel, p, verdicts.get(sel.uid), ch)}</div>` : '<p class="muted small">Drag an item onto an equipment slot to equip it (it swaps with what is there), or click it for details. Drag equipped gear back here to unequip it.</p>'}
  </section>`;
}

// events of the inventory panel and drag & drop (root = the Character page); getChar = the selected character
export function bindInventory(root, rerender, getChar) {
  root.addEventListener('click', async e => {
    const lo = e.target.closest('[data-lf-open]');
    if (lo) { e.preventDefault(); openLootFilter(lo.dataset.lfOpen, () => rerender(true)); return; }
    if (!e.target.closest('.inv-panel')) return;
    if (e.target.closest('[data-sockets]') && selectedUid) { openSockets(selectedUid); return; }
    const t = e.target.closest('[data-item], button');
    if (!t) return;
    const d = t.dataset;
    if (d.preset) {
      const f = state.player.settings.invPresets?.[Number(d.preset)];
      if (!f) return;
      filterSlot = f.slot; filterRarity = f.rarity; sortBy = f.sort;
      Object.assign(hl, { text: f.hl.text, rows: f.hl.rows.map(r => ({ ...r })), mode: f.hl.mode, only: f.hl.only });
      saveHl(); rerender(); return;
    }
    if (d.presetDel) {
      const list = [...(state.player.settings.invPresets || [])];
      const [f] = list.splice(Number(d.presetDel), 1);
      if (f && await confirmBox(`Delete the saved filter “${f.name}”?`, 'Delete')) await savePresets(list);
      return;
    }
    if ('presetSave' in d) {
      const name = await promptBox('Name for this filter', hl.text || (filterSlot !== 'all' ? SLOTS[filterSlot]?.label : '') || '', 'Save');
      if (!name?.trim()) return;
      const list = [...(state.player.settings.invPresets || [])];
      const i = list.findIndex(x => x.name.toLowerCase() === name.trim().toLowerCase());
      const f = { name: name.trim(), ...filterState() };
      if (i >= 0) list[i] = f; else list.push(f);
      await savePresets(list);
      return;
    }
    if ('presetReset' in d) { filterSlot = 'all'; filterRarity = 'all'; Object.assign(hl, { text: '', rows: [], mode: 'all', only: false }); saveHl(); rerender(); return; }
    if ('hlAdd' in d) { if (hl.rows.length < 6) hl.rows.push({ stat: '', min: '', tier: '' }); saveHl(); rerender(); return; }
    if (d.hlDel) { hl.rows.splice(Number(d.hlDel), 1); saveHl(); rerender(); return; }
    if ('hlClear' in d) { Object.assign(hl, { text: '', rows: [], mode: 'all' }); saveHl(); rerender(); return; }
    if (d.item) { selectedUid = selectedUid === d.item ? null : d.item; rerender(); return; }
    if (d.equipTo) { await run(act('equip', { charId: d.equipTo, itemUid: selectedUid }), 'Equipped.'); selectedUid = null; return; }
    if ('sell' in d) { const r = await run(act('sell_item', { itemUid: selectedUid })); if (r) { selectedUid = null; } return; }
    if ('lock' in d) { await run(act('toggle_lock', { itemUid: selectedUid })); return; }
    if ('salvage' in d) {
      const r = await run(act('salvage_items', { itemUids: [selectedUid] }));
      if (r) { selectedUid = null; toast(`Salvaged into ${Object.entries(r.materials).map(([k, v]) => `${v} ${MATERIALS[k].name}`).join(', ') || 'nothing'}.`, 'success'); }
      return;
    }
    if (d.sellRarity) {
      const label = CONFIG.rarities.find(r => r.id === d.sellRarity).label;
      if (await confirmBox(`Sell all unlocked items of ${label} rarity and below?`, 'Sell')) {
        const r = await run(act('sell_by_rarity', { maxRarity: d.sellRarity }));
        if (r) toast(`Sold ${r.count} items for ${fmt(r.gold)} gold.`, 'success');
      }
    }
  });
  root.addEventListener('change', async e => {
    if (!e.target.closest('.inv-panel')) return;
    const t = e.target;
    if (t.matches('[data-f-slot]')) filterSlot = t.value;
    else if (t.matches('[data-f-rarity]')) filterRarity = t.value;
    else if (t.matches('[data-f-sort]')) sortBy = t.value;
    else if (t.matches('[data-compare]')) compareCharId = t.value;
    else if (t.matches('[data-hl-mode]')) { hl.mode = t.value; saveHl(); applyHighlight(root); return; }
    else if (t.matches('[data-hl-only]')) { hl.only = t.checked; saveHl(); applyHighlight(root); return; }
    else if (t.matches('[data-hl="stat"]')) { hl.rows[Number(t.dataset.i)].stat = t.value; saveHl(); rerender(); return; }
    else if (t.matches('[data-hl="tier"]')) { hl.rows[Number(t.dataset.i)].tier = t.value; saveHl(); applyHighlight(root); return; }
    else return;
    rerender();
  });

  // typing in the highlight search or a minimum value updates the marks live
  root.addEventListener('input', e => {
    const t = e.target;
    if (!t.closest?.('.inv-panel')) return;
    if (t.matches('[data-hl-text]')) hl.text = t.value;
    else if (t.matches('[data-hl="min"]')) hl.rows[Number(t.dataset.i)].min = t.value;
    else return;
    saveHl(); applyHighlight(root);
  });

  // ---- drag & drop: inventory item → equipment slot (equip/swap), equipped item → inventory (unequip)
  let drag = null; // { kind: 'item', uid, slot } | { kind: 'equipped', slot }
  const clearMarks = () => root.querySelectorAll('.drop-ok, .drop-bad, .drag-src').forEach(x => x.classList.remove('drop-ok', 'drop-bad', 'drag-src'));
  root.addEventListener('dragstart', e => {
    const ch = getChar();
    const cell = e.target.closest('.item-cell[data-item]');
    const eq = e.target.closest('.equip-slot[data-slot]');
    if (cell) {
      const it = state.player.inventory.find(i => i.uid === cell.dataset.item);
      if (!it || !ch) return;
      drag = { kind: 'item', uid: it.uid, slot: it.slot };
      // light up the matching slot
      root.querySelector(`.equip-slot[data-slot="${it.slot}"]`)?.classList.add(canEquip(it, ch) ? 'drop-ok' : 'drop-bad');
    } else if (eq && ch?.equipment[eq.dataset.slot]) {
      drag = { kind: 'equipped', slot: eq.dataset.slot };
      root.querySelector('.inv-panel')?.classList.add('drop-ok');
    } else return;
    dragging = true;
    (cell || eq).classList.add('drag-src');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', drag.uid || drag.slot); } catch {}
    const tip = document.getElementById('tooltip'); if (tip) tip.style.display = 'none';
  });
  root.addEventListener('dragover', e => {
    if (!drag) return;
    const slot = e.target.closest('.equip-slot[data-slot]');
    if (drag.kind === 'item' && slot?.dataset.slot === drag.slot && slot.classList.contains('drop-ok')) e.preventDefault();
    if (drag.kind === 'equipped' && e.target.closest('[data-inv-drop]')) e.preventDefault();
  });
  root.addEventListener('drop', async e => {
    if (!drag) return;
    e.preventDefault();
    const d = drag, ch = getChar();
    drag = null; dragging = false; clearMarks();
    const slot = e.target.closest('.equip-slot[data-slot]');
    if (d.kind === 'item' && slot?.dataset.slot === d.slot) {
      if (await run(act('equip', { charId: ch.id, itemUid: d.uid })) !== undefined && selectedUid === d.uid) selectedUid = null;
    } else if (d.kind === 'equipped' && e.target.closest('[data-inv-drop]')) await run(act('unequip', { charId: ch.id, slot: d.slot }));
    rerender();
  });
  root.addEventListener('dragend', () => { if (dragging) { drag = null; dragging = false; clearMarks(); rerender(); } });
}

function detailHtml(item, p, verdict, ch) {
  const users = chars().filter(c => canEquip(item, c));
  const cmpChar = p.characters[compareCharId] && users.includes(p.characters[compareCharId]) ? p.characters[compareCharId] : users.includes(ch) ? ch : users[0];
  const equipped = cmpChar?.equipment[item.slot] || null;
  return `
    <div class="row gap">${itemIcon(item, 'lg')}<div>${rarityLabel(item.rarity)}<div class="muted small">Sells for ${fmt(itemSellValue(item))}g</div></div></div>
    ${itemTooltipHtml(item, equipped, cmpChar)}
    ${users.length ? `<label class="inline small">Compare with
      <select data-compare>${users.map(c => `<option value="${c.id}" ${c === cmpChar ? 'selected' : ''}>${esc(c.name)} (${esc(CLASSES[c.classId].name)})</option>`).join('')}</select></label>
      ${equipped ? `<div class="small muted">Currently equipped: <span class="rarity-text rarity-${equipped.rarity}">${esc(equipped.name)}</span></div>` : '<div class="small muted">Slot is empty.</div>'}
      <h4>Equip on</h4>
      <div class="row gap wrap">${users.map(c => `<button class="btn small ${c === ch ? 'primary' : ''}" data-equip-to="${c.id}">${esc(c.name)}</button>`).join('')}</div>`
    : '<p class="muted small">None of your characters can use this item yet.</p>'}
    ${verdict ? `<div class="small lf-verdict">🧹 Loot filter: <b>${FILTER_ACTIONS[verdict.action].icon} ${FILTER_ACTIONS[verdict.action].label}</b> <span class="muted">— ${esc(verdict.reason)}</span></div>` : ''}
    <div class="row gap end">
      ${item.sockets?.length || maxSockets(item) ? `<button class="btn small ghost" data-sockets>💎 Sockets${item.sockets?.length ? ` (${item.sockets.filter(Boolean).length}/${item.sockets.length})` : ''}</button>` : ''}
      <button class="btn small ghost" data-lock>${item.locked ? 'Unlock' : 'Lock'}</button>
      <button class="btn small" data-salvage ${item.locked ? 'disabled' : ''} ${tipAttr('Break down into: ' + esc(Object.entries({ ...salvageYield(item, p.town?.buildings?.salvage_yard?.level || 1)}).map(([k, v]) => `${v} ${MATERIALS[k].name}`).join(', ')) + (item.sockets?.some(Boolean) ? '<br>Socketed gems go back to your pouch.' : ''))}>Salvage</button>
      <button class="btn small danger" data-sell ${item.locked ? 'disabled' : ''}>Sell</button>
    </div>`;
}
