// Inventory: browse, compare, equip, lock and sell loot.
import { state, chars } from '../state.js';
import { act } from '../net.js';
import { esc, fmt, run, itemTooltipHtml, tipAttr, rarityLabel, confirmBox, toast } from '../ui.js';
import { itemIcon } from '../assets.js';
import { CONFIG, rarityIndex } from '/shared/config.js';
import { SLOTS, canEquip, itemSellValue } from '/shared/data/items.js';
import { CLASSES } from '/shared/data/classes.js';
import { MATERIALS } from '/shared/data/town.js';
import { salvageYield } from '/shared/town.js';

let filterSlot = 'all';
let filterRarity = 'all';
let sortBy = 'rarity';
let selectedUid = null;
let compareCharId = null;

export const inventoryView = {
  id: 'inventory', label: 'Inventory', icon: '🎒',
  mount(root) {
    root.addEventListener('click', async e => {
      const t = e.target.closest('[data-item], button');
      if (!t) return;
      const d = t.dataset;
      if (d.item) { selectedUid = d.item; this.render(root); return; }
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
      const t = e.target;
      if (t.matches('[data-f-slot]')) filterSlot = t.value;
      else if (t.matches('[data-f-rarity]')) filterRarity = t.value;
      else if (t.matches('[data-f-sort]')) sortBy = t.value;
      else if (t.matches('[data-compare]')) compareCharId = t.value;
      else if (t.matches('[data-autosell]')) { await run(act('set_settings', { autoSellBelow: t.value || null }), 'Auto-sell updated.'); return; }
      else return;
      this.render(root);
    });
  },
  render(root) {
    const p = state.player;
    let items = [...p.inventory];
    if (filterSlot !== 'all') items = items.filter(i => i.slot === filterSlot);
    if (filterRarity !== 'all') items = items.filter(i => i.rarity === filterRarity);
    items.sort(sortBy === 'level' ? (a, b) => b.level - a.level || rarityIndex(b.rarity) - rarityIndex(a.rarity)
      : sortBy === 'slot' ? (a, b) => a.slot.localeCompare(b.slot) || b.level - a.level
        : (a, b) => rarityIndex(b.rarity) - rarityIndex(a.rarity) || b.level - a.level);
    const sel = p.inventory.find(i => i.uid === selectedUid) || null;
    root.innerHTML = `
      <div class="inventory-layout">
        <section class="panel">
          <div class="panel-head"><h3>Inventory <span class="muted small">${p.inventory.length}/${CONFIG.inventory.limit}</span></h3>
            <div class="row gap wrap small">
              <select data-f-slot><option value="all">All slots</option>${Object.entries(SLOTS).map(([id, s]) => `<option value="${id}" ${filterSlot === id ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select>
              <select data-f-rarity><option value="all">All rarities</option>${CONFIG.rarities.map(r => `<option value="${r.id}" ${filterRarity === r.id ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select>
              <select data-f-sort>${[['rarity', 'Sort: rarity'], ['level', 'Sort: level'], ['slot', 'Sort: slot']].map(([v, l]) => `<option value="${v}" ${sortBy === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
            </div></div>
          ${p.inventory.length >= CONFIG.inventory.limit ? '<div class="notice">Inventory full — new loot is sold automatically.</div>' : ''}
          <div class="item-grid">${items.map(i => `<button class="item-cell ${i.uid === selectedUid ? 'active' : ''}" data-item="${i.uid}" ${tipAttr(itemTooltipHtml(i))}>${itemIcon(i, 'md')}${i.locked ? '<span class="lock">🔒</span>' : ''}<span class="ilvl">${i.level}</span></button>`).join('') || '<p class="muted pad">No items match.</p>'}</div>
          <div class="row gap wrap small sell-bar">
            <span class="muted">Quick sell:</span>${CONFIG.rarities.slice(0, 4).map(r => `<button class="btn tiny ghost" data-sell-rarity="${r.id}">≤ ${esc(r.label)}</button>`).join('')}
            <a class="small" href="#/town">Salvage Yard →</a>
            <span class="grow"></span>
            <label class="inline">Auto-${p.settings.autoLootAction === 'salvage' ? 'salvage' : 'sell'} loot up to
              <select data-autosell><option value="">(off)</option>${CONFIG.rarities.slice(0, 4).map(r => `<option value="${r.id}" ${p.settings.autoSellBelow === r.id ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select></label>
          </div>
        </section>
        <section class="panel item-detail">
          ${sel ? detailHtml(sel, p) : '<p class="muted">Select an item to see details, compare it and equip it.</p>'}
        </section>
      </div>`;
  },
};

function detailHtml(item, p) {
  const users = chars().filter(c => canEquip(item, c));
  const cmpChar = p.characters[compareCharId] && users.includes(p.characters[compareCharId]) ? p.characters[compareCharId] : users[0];
  const equipped = cmpChar?.equipment[item.slot] || null;
  return `
    <div class="row gap">${itemIcon(item, 'lg')}<div>${rarityLabel(item.rarity)}<div class="muted small">Sells for ${fmt(itemSellValue(item))}g</div></div></div>
    ${itemTooltipHtml(item, equipped)}
    ${users.length ? `<label class="inline small">Compare with
      <select data-compare>${users.map(c => `<option value="${c.id}" ${c === cmpChar ? 'selected' : ''}>${esc(c.name)} (${esc(CLASSES[c.classId].name)})</option>`).join('')}</select></label>
      ${equipped ? `<div class="small muted">Currently equipped: <span class="rarity-text rarity-${equipped.rarity}">${esc(equipped.name)}</span></div>` : '<div class="small muted">Slot is empty.</div>'}
      <h4>Equip on</h4>
      <div class="row gap wrap">${users.map(c => `<button class="btn small" data-equip-to="${c.id}">${esc(c.name)}</button>`).join('')}</div>`
    : '<p class="muted small">None of your characters can use this item yet.</p>'}
    <div class="row gap end">
      <button class="btn small ghost" data-lock>${item.locked ? 'Unlock' : 'Lock'}</button>
      <button class="btn small" data-salvage ${item.locked ? 'disabled' : ''} ${tipAttr('Break down into: ' + esc(Object.entries(salvageYield(item, p.town?.buildings?.salvage_yard?.level || 1)).map(([k, v]) => `${v} ${MATERIALS[k].name}`).join(', ')))}>Salvage</button>
      <button class="btn small danger" data-sell ${item.locked ? 'disabled' : ''}>Sell</button>
    </div>`;
}
