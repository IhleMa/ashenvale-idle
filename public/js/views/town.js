// Town (garrison): buildings, construction, workers, salvage, crafting, enchanting, alchemy.
// Gathering happens through expeditions (views/expeditions.js).
import { morphed } from '../morph.js';
import { classLabel } from '/shared/data/subclasses.js';
import { state, hero } from '../state.js';
import { act } from '../net.js';
import { esc, fmt, run, toast, tipAttr, itemTooltipHtml, duration, bar, confirmBox, statValue, premiumTxt, confirmSpend } from '../ui.js';
import { speedUpCost } from '/shared/premium.js';
import { buildingArt, materialIcon, professionIcon, elixirIcon, itemIcon, portrait } from '../assets.js';
import { CONFIG, rarityIndex } from '/shared/config.js';
import { BUILDINGS, BUILDING_IDS, MATERIALS, MATERIAL_IDS, PROFESSIONS, ELIXIRS, QUALITIES, ITEM_MATERIAL, CRAFT_BUILDING_OF_TYPE, ENCHANT_STATS_BY_LEVEL, professionXpToNext, CRAFT_LEVEL_CAP, buildingEffects } from '/shared/data/town.js';
import { ITEM_BASES, SLOTS, STAT_LABELS } from '/shared/data/items.js';
import { CLASSES } from '/shared/data/classes.js';
import * as T from '/shared/town.js';
import { itemTextMatch } from './inventory.js';

// salvage yard filters (kept while the page is open)
const salv = { text: '', slot: 'all', rarity: 'all', maxLevel: '', sort: 'rarity-asc', hideLocked: false };
const SALV_SORTS = [['rarity-asc', 'Rarity: lowest first'], ['rarity-desc', 'Rarity: highest first'], ['level-asc', 'Level: lowest first'], ['level-desc', 'Level: highest first'], ['slot', 'Slot'], ['yield', 'Most materials first']];
function salvageItems(p, level, enchanter) {
  let items = p.inventory.filter(i => (salv.slot === 'all' || i.slot === salv.slot)
    && (salv.rarity === 'all' || (salv.rarity === 'special' ? (i.unique || i.set) : salv.rarity.startsWith('<=') ? rarityIndex(i.rarity) <= rarityIndex(salv.rarity.slice(2)) : i.rarity === salv.rarity))
    && (salv.maxLevel === '' || i.level <= Number(salv.maxLevel))
    && !(salv.hideLocked && i.locked));
  const total = it => Object.values(T.salvageYield(it, level, enchanter)).reduce((a, b) => a + b, 0);
  const by = {
    'rarity-asc': (a, b) => rarityIndex(a.rarity) - rarityIndex(b.rarity) || a.level - b.level,
    'rarity-desc': (a, b) => rarityIndex(b.rarity) - rarityIndex(a.rarity) || b.level - a.level,
    'level-asc': (a, b) => a.level - b.level || rarityIndex(a.rarity) - rarityIndex(b.rarity),
    'level-desc': (a, b) => b.level - a.level || rarityIndex(b.rarity) - rarityIndex(a.rarity),
    slot: (a, b) => (SLOTS[a.slot]?.label || a.slot).localeCompare(SLOTS[b.slot]?.label || b.slot) || b.level - a.level,
    yield: (a, b) => total(b) - total(a),
  }[salv.sort] || (() => 0);
  return items.sort(by);
}
// the text search only hides cells, so typing keeps the focus
function applySalvText(root) {
  const p = state.player;
  let n = 0;
  for (const cell of root.querySelectorAll('.salvage-grid [data-salv]')) {
    const it = p.inventory.find(i => i.uid === cell.dataset.salv);
    const show = !!it && itemTextMatch(it, salv.text);
    cell.style.display = show ? '' : 'none';
    if (show) n++;
  }
  const c = root.querySelector('[data-salv-count]');
  if (c) c.textContent = `${n} shown`;
}

const ui = { selected: 'town_hall', salvageSel: new Set(), craftBase: null, craftLevel: null, craftQuality: 'standard', enchantChar: null, enchantStat: 'str' };
let timer = null;
const now = () => Date.now() + (state.timeOffset || 0);

// ------------------------------------------------------------------ small fragments
function costHtml(p, cost) {
  const parts = [];
  if (cost.gold) parts.push(`<span class="cost ${p.gold >= cost.gold ? '' : 'short'}"><span class="gold-text">◉</span> ${fmt(cost.gold)}</span>`);
  for (const [k, v] of Object.entries(cost.mats || {})) {
    const have = Math.floor(p.town.materials[k] || 0);
    parts.push(`<span class="cost ${have >= v ? '' : 'short'}" ${tipAttr(`${esc(MATERIALS[k].name)}: you have ${fmt(have)}`)}>${materialIcon(k, 'xxs')} ${fmt(v)}</span>`);
  }
  return `<span class="costs">${parts.join('')}</span>`;
}
function matsList(mats) {
  return Object.entries(mats).map(([k, v]) => `<span class="cost">${materialIcon(k, 'xxs')} ${fmt(v)}</span>`).join(' ') || '<span class="muted">nothing</span>';
}
const skipCost = endsAt => speedUpCost(endsAt - now(), state.premiumRate || 10);
function speedBtn(kind, id, endsAt) {
  return `<button class="btn tiny premium-btn" data-speed-${kind}="${id}" data-speed-end="${endsAt}" ${tipAttr('Finish instantly with Ashen Crystals')}>⚡ <span data-speed-cost>${skipCost(endsAt)}</span> 💠</button>`;
}
function countdown(endsAt) { return `<span data-ends="${endsAt}">${duration(Math.max(0, (endsAt - now()) / 1000))}</span>`; }

function profBadge(ch) {
  if (!ch?.profession) return '';
  const pr = PROFESSIONS[ch.profession.id];
  return `<span class="prof-badge" ${tipAttr(`${esc(pr.name)} skill ${ch.profession.level}`)}>${professionIcon(ch.profession.id, 'xxs')} ${esc(pr.name)} ${ch.profession.level}</span>`;
}

// ------------------------------------------------------------------ building cards
function cardHtml(p, id) {
  const def = BUILDINGS[id];
  const b = p.town.buildings[id];
  const w = b.worker ? p.characters[b.worker] : null;
  let status = '';
  if (b.upgrade) {
    const total = b.upgrade.endsAt - b.upgrade.startedAt;
    status = `<div class="build-progress" data-progress-start="${b.upgrade.startedAt}" data-progress-end="${b.upgrade.endsAt}">${bar(0, 1, 'build', '')}<small>🏗 Lv ${b.upgrade.to} in ${countdown(b.upgrade.endsAt)}</small></div>`;
    void total;
  } else if (id === 'expedition_camp') {
    const ex = p.expeditions || [];
    status = `<small class="muted">${ex.length} underway${ex.some(x => x.endsAt <= now()) ? ' · <span class="up">rewards ready</span>' : ''}</small>`;
  }
  const needsWorker = def.profession && b.level > 0 && !T.worker(p, id);
  return `<button class="building-card ${ui.selected === id ? 'active' : ''} ${b.level ? '' : 'unbuilt'}" data-building="${id}">
    ${buildingArt(id, 'md')}
    <span class="bc-body">
      <b>${esc(def.name)}</b>
      <span class="bc-level">${b.level ? `Level ${b.level}` : 'Not built'}${b.level >= def.maxLevel ? ' · max' : ''}</span>
      ${def.profession ? `<span class="bc-worker">${w ? `${portrait(w, 'xxs')} ${esc(w.name)}` : needsWorker ? '<span class="warn-text">⚠ No worker</span>' : `<span class="faint">${esc(PROFESSIONS[def.profession].name)}</span>`}</span>` : ''}
      ${status}
    </span>
  </button>`;
}

// ------------------------------------------------------------------ detail panel
function upgradeHtml(p, id) {
  const def = BUILDINGS[id];
  const b = p.town.buildings[id];
  if (b.upgrade) return `<div class="notice good row between wrap gap"><span>🏗 Upgrading to level ${b.upgrade.to} — ready in ${countdown(b.upgrade.endsAt)}</span>${speedBtn('build', id, b.upgrade.endsAt)}</div>`;
  if (b.level >= def.maxLevel) return '<div class="muted small">Maximum level reached.</div>';
  const to = b.level + 1;
  const cost = T.upgradeCost(id, to);
  const blocker = T.upgradeBlocker(p, id);
  return `<div class="upgrade-box">
    <div class="row between wrap gap"><b>${b.level ? `Upgrade to level ${to}` : 'Construct'}</b><span class="muted small">⏱ ${duration(T.buildSeconds(id, to))}</span></div>
    ${costHtml(p, cost)}
    <div class="muted small">Level ${to}: ${buildingEffects(def.id, to).map(esc).join(' · ')}</div>
    <div class="row end"><button class="btn primary small" data-upgrade="${id}" ${blocker ? 'disabled' : ''}>${b.level ? 'Upgrade' : 'Build'}</button></div>
    ${blocker ? `<div class="warn-text small">${esc(blocker)}</div>` : ''}
  </div>`;
}

function workerHtml(p, id) {
  const def = BUILDINGS[id];
  if (!def.profession) return '';
  const prof = PROFESSIONS[def.profession];
  const b = p.town.buildings[id];
  const w = b.worker ? p.characters[b.worker] : null;
  const eligible = Object.values(p.characters).filter(c => !c.isMain && c.profession?.id === def.profession && !(p.expeditions || []).some(x => x.charIds.includes(c.id)));
  const inParty = c => p.parties.some(pt => pt.members.includes(c.id));
  const elsewhere = c => Object.entries(p.town.buildings).find(([bid, bb]) => bb.worker === c.id && bid !== id);
  return `<div class="worker-box">
    <h4>Worker · ${professionIcon(def.profession, 'xxs')} ${esc(prof.name)}</h4>
    ${w ? `<div class="row gap">${portrait(w, 'sm')}<div class="grow"><b>${esc(w.name)}</b> <span class="muted small">Lv ${w.level} ${esc(classLabel(w.classId, w.subclass))}</span>
        <div class="small">${esc(prof.name)} skill <b>${w.profession.level}</b></div>${bar(w.profession.xp, professionXpToNext(w.profession.level), 'xp thin', '')}</div>
        <button class="btn tiny ghost" data-unassign="${id}">Remove</button></div>`
      : `<p class="small ${b.level ? 'warn-text' : 'muted'}">A companion with ${esc(prof.name)} must work here before you can use it.</p>`}
    <p class="faint small">Workers live in town: they leave your party and can't fight while assigned.</p>
    ${eligible.length ? `<div class="row gap wrap">${eligible.filter(c => c.id !== b.worker).map(c => `<button class="btn tiny" data-assign="${id}" data-char="${c.id}" ${b.level ? '' : 'disabled'} ${elsewhere(c) ? tipAttr(`Currently working at the ${esc(BUILDINGS[elsewhere(c)[0]].name)}`) : ''}>${esc(c.name)} (${c.profession.level})${elsewhere(c) ? ' ↺' : ''}${inParty(c) ? ' ⚔' : ''}</button>`).join('')}</div>
      ${eligible.some(inParty) ? '<p class="faint small">⚔ = currently in a party (will be removed from it)</p>' : ''}`
      : `<p class="muted small">None of your companions knows ${esc(prof.name)}. <a href="#/recruitment">Recruit one at the Inn</a> — every recruit has a profession.</p>`}
  </div>`;
}

function itemsOfType(p, type) {
  const list = p.inventory.filter(i => !type || ITEM_MATERIAL[i.baseId] === type).map(i => ({ item: i, charId: '' }));
  for (const ch of Object.values(p.characters)) for (const it of Object.values(ch.equipment)) if (it && (!type || ITEM_MATERIAL[it.baseId] === type)) list.push({ item: it, charId: ch.id, owner: ch.name });
  return list;
}

// Reforge: pick a character (or the inventory), then see its gear slot by slot
const typeOf = it => ITEM_MATERIAL[it.baseId] || 'metal';
function reforgeHtml(p, id, def, cap, w) {
  const canHere = it => typeOf(it) === def.type && it.level < cap;
  const chars = Object.values(p.characters).sort((a, c) => (c.isMain ? 1 : 0) - (a.isMain ? 1 : 0) || c.level - a.level);
  const countFor = ch => Object.values(ch.equipment).filter(it => it && canHere(it)).length;
  const invItems = p.inventory.filter(canHere).sort((a, c) => a.level - c.level);
  if (!ui.reforgeChar || (ui.reforgeChar !== 'inv' && !p.characters[ui.reforgeChar])) ui.reforgeChar = (chars.find(c => countFor(c)) || chars[0])?.id || 'inv';
  const chip = (key, art, name, n) => `<button class="reforge-chip ${ui.reforgeChar === key ? 'active' : ''}" data-reforge-pick="${key}">${art}<span>${name}</span>${n ? `<b class="count">${n}</b>` : ''}</button>`;
  const picker = `<div class="reforge-picker">${chars.map(c => chip(c.id, portrait(c, 'xs'), `${c.isMain ? '★ ' : ''}${esc(c.name)} <small class="muted">Lv ${c.level}</small>`, countFor(c))).join('')}
    ${chip('inv', '🎒', 'Inventory', invItems.length)}</div>`;
  const row = (it, charId, slotLabel) => {
    const base = `<span class="reforge-slot">${esc(slotLabel)}</span>`;
    if (!it) return `<div class="reforge-row empty">${base}<span class="muted small grow">Empty</span></div>`;
    const name = `<span class="grow" ${tipAttr(itemTooltipHtml(it))}>${itemIcon(it, 'xs')} <span class="rarity-text rarity-${it.rarity}">${esc(it.name)}</span> <span class="muted small">ilvl ${it.level}</span></span>`;
    if (typeOf(it) !== def.type) {
      const other = BUILDINGS[CRAFT_BUILDING_OF_TYPE[typeOf(it)]];
      return `<div class="reforge-row other">${base}${name}<span class="muted small">${other ? `at the ${esc(other.name)}` : 'not here'}</span></div>`;
    }
    if (it.level >= cap) return `<div class="reforge-row done">${base}${name}<span class="muted small">✓ up to date (max ${cap})</span></div>`;
    return `<div class="reforge-row">${base}${name}<span class="small up">→ ${cap}</span>${costHtml(p, T.reforgeCost(it, cap))}<button class="btn tiny primary" data-reforge="${it.uid}" data-char="${charId}" ${w ? '' : 'disabled'}>Reforge</button></div>`;
  };
  let body;
  if (ui.reforgeChar === 'inv') {
    body = invItems.length ? invItems.map(it => row(it, '', SLOTS[it.slot]?.label || '')).join('') : `<p class="muted small">No ${def.type} items below item level ${cap} in your inventory.</p>`;
  } else {
    const ch = p.characters[ui.reforgeChar];
    body = Object.keys(SLOTS).map(slot => row(ch.equipment[slot], ch.id, SLOTS[slot].label)).join('');
  }
  return `<h4>Reforge</h4>
    <p class="muted small">Raise ${def.type} gear to item level ${cap} (your hero's level and this building's limit), keeping rarity, stats, enchantment and gems.${w ? '' : ' <b>Assign a worker first.</b>'}</p>
    ${picker}<div class="reforge-list">${body}</div>`;
}

// Enchanting: pick the enchantment, then a character (or the inventory) and enchant its gear slot by slot
function enchantHtml(p, b) {
  const w = T.worker(p, 'enchanter');
  const stats = ENCHANT_STATS_BY_LEVEL(b.level);
  if (!stats.includes(ui.enchantStat)) ui.enchantStat = stats[0];
  const st = ui.enchantStat;
  const valueFor = it => T.enchantValue(st, it.level, b.level, w?.profession.level || 0);
  const chars = Object.values(p.characters).sort((a, c) => (c.isMain ? 1 : 0) - (a.isMain ? 1 : 0) || c.level - a.level);
  const unenchanted = ch => Object.values(ch.equipment).filter(it => it && !it.enchant).length;
  const invItems = [...p.inventory].sort((a, c) => c.level - a.level);
  if (!ui.enchantChar || (ui.enchantChar !== 'inv' && !p.characters[ui.enchantChar])) ui.enchantChar = chars[0]?.id || 'inv';
  const chip = (key, art, name, n) => `<button class="reforge-chip ${ui.enchantChar === key ? 'active' : ''}" data-enchant-pick="${key}" ${n ? `title="${n} without an enchantment"` : ''}>${art}<span>${name}</span>${n ? `<b class="count">${n}</b>` : ''}</button>`;
  const statPicker = `<div class="enchant-stats">${stats.map(x => `<button class="enchant-stat ${x === st ? 'active' : ''}" data-enchant-stat-pick="${x}">${esc(STAT_LABELS[x])}</button>`).join('')}</div>`;
  const picker = `<div class="reforge-picker">${chars.map(c => chip(c.id, portrait(c, 'xs'), `${c.isMain ? '★ ' : ''}${esc(c.name)} <small class="muted">Lv ${c.level}</small>`, unenchanted(c))).join('')}
    ${chip('inv', '🎒', 'Inventory', 0)}</div>`;
  const row = (it, charId, slotLabel) => {
    const base = `<span class="reforge-slot">${esc(slotLabel)}</span>`;
    if (!it) return `<div class="reforge-row empty">${base}<span class="muted small grow">Empty</span></div>`;
    const name = `<span class="grow" ${tipAttr(itemTooltipHtml(it))}>${itemIcon(it, 'xs')} <span class="rarity-text rarity-${it.rarity}">${esc(it.name)}</span> <span class="muted small">ilvl ${it.level}</span></span>`;
    const now = it.enchant ? `<span class="small enchant-now">✨ ${esc(STAT_LABELS[it.enchant.stat])} ${statValue(it.enchant.stat, it.enchant.value)}</span>` : '<span class="small muted">no enchantment</span>';
    const v = valueFor(it);
    const same = it.enchant?.stat === st && it.enchant.value >= v;
    return `<div class="reforge-row enchant-row ${same ? 'done' : ''}"><div class="er-line">${base}${name}</div>
      <div class="er-line"><span class="reforge-slot"></span>${now}<span class="small up">→ ${esc(STAT_LABELS[st])} ${statValue(st, v)}</span><span class="grow"></span>${costHtml(p, T.enchantCost(it.level, it.rarity))}<button class="btn tiny primary" data-enchant-uid="${it.uid}" data-char="${charId}" ${w ? '' : 'disabled'} ${same ? 'title="Already has this enchantment at this strength"' : ''}>${it.enchant ? 'Replace' : 'Enchant'}</button></div></div>`;
  };
  let body;
  if (ui.enchantChar === 'inv') body = invItems.length ? invItems.map(it => row(it, '', SLOTS[it.slot]?.label || '')).join('') : '<p class="muted small">Your inventory is empty.</p>';
  else { const ch = p.characters[ui.enchantChar]; body = Object.keys(SLOTS).map(slot => row(ch.equipment[slot], ch.id, SLOTS[slot].label)).join(''); }
  return `<h4>Enchant</h4>
    ${w ? '' : '<div class="notice small">Assign a worker with Enchanting first.</div>'}
    <p class="muted small">Adds one permanent bonus stat to an item; enchanting again replaces it. The strength depends on the item's level, this building's level and your enchanter's skill. Choose the enchantment:</p>
    ${statPicker}
    ${picker}<div class="reforge-list">${body}</div>`;
}

function specificHtml(p, id) {
  const def = BUILDINGS[id];
  const b = p.town.buildings[id];
  const h = hero();
  if (id === 'town_hall') {
    return `<h4>Your town</h4><div class="stat-grid">${BUILDING_IDS.filter(x => x !== 'town_hall').map(x => `<div class="stat-row"><span>${esc(BUILDINGS[x].name)}</span><b>${p.town.buildings[x].level || '—'}</b></div>`).join('')}</div>`;
  }
  if (id === 'inn') {
    const recruits = Object.values(p.characters).filter(c => !c.isMain);
    return `<h4>Rooms</h4><p>${recruits.length} / ${T.rosterLimit(p)} companions housed · ${T.recruitOffers(p)} recruits offered at a time. <a href="#/recruitment">Go to Recruitment →</a></p>
      <h4>Professions in your roster</h4>
      <div class="row gap wrap">${Object.entries(PROFESSIONS).map(([pid, pr]) => { const n = recruits.filter(c => c.profession?.id === pid).length; return `<span class="prof-count ${n ? '' : 'none'}">${professionIcon(pid, 'xxs')} ${esc(pr.name)} <b>${n}</b></span>`; }).join('')}</div>`;
  }
  if (b.level < 1) return '<p class="muted">Construct this building to use it.</p>';
  if (id === 'salvage_yard') {
    const items = salvageItems(p, b.level, !!T.worker(p, 'enchanter'));
    const shown = items.filter(i => itemTextMatch(i, salv.text));
    const sel = [...ui.salvageSel].map(uid => p.inventory.find(i => i.uid === uid)).filter(Boolean);
    const preview = {};
    for (const it of sel) for (const [k, v] of Object.entries(T.salvageYield(it, b.level, !!T.worker(p, 'enchanter')))) preview[k] = (preview[k] || 0) + v;
    return `<h4>Salvage equipment</h4>
      <p class="muted small">Select items to break down. Locked items 🔒 are protected. Uncommon+ items also give arcane materials${T.worker(p, 'enchanter') ? ' (+25% thanks to your enchanter)' : ''}.</p>
      <div class="row gap wrap small salv-filters">
        <input type="search" data-salv-text value="${esc(salv.text)}" placeholder="Search: name or stat">
        <select data-salv-f="slot"><option value="all">All slots</option>${Object.entries(SLOTS).map(([k, s]) => `<option value="${k}" ${salv.slot === k ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select>
        <select data-salv-f="rarity"><option value="all">All rarities</option>${CONFIG.rarities.map(r => `<option value="${r.id}" ${salv.rarity === r.id ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}${CONFIG.rarities.slice(1, -1).map(r => `<option value="<=${r.id}" ${salv.rarity === '<=' + r.id ? 'selected' : ''}>${esc(r.label)} or lower</option>`).join('')}<option value="special" ${salv.rarity === 'special' ? 'selected' : ''}>Uniques & set items</option></select>
        <label class="inline">level ≤ <input type="number" min="1" class="af-min" data-salv-f="maxLevel" value="${esc(salv.maxLevel)}" placeholder="any"></label>
        <select data-salv-f="sort">${SALV_SORTS.map(([v, l]) => `<option value="${v}" ${salv.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <label class="inline"><input type="checkbox" data-salv-f="hideLocked" ${salv.hideLocked ? 'checked' : ''}> hide locked</label>
        <span class="muted" data-salv-count>${shown.length} shown</span>
        <button class="btn tiny" data-salv-all ${tipAttr('Select every unlocked item that is shown')}>Select shown</button>
      </div>
      <div class="salvage-grid">${items.map(i => `<button class="item-cell ${ui.salvageSel.has(i.uid) ? 'active' : ''} ${i.locked ? 'locked' : ''}" data-salv="${i.uid}" ${tipAttr(itemTooltipHtml(i) + `<div class='muted small'>Salvages into: ${esc(Object.entries(T.salvageYield(i, b.level, !!T.worker(p, 'enchanter'))).map(([k, v]) => `${v} ${MATERIALS[k].name}`).join(', '))}</div>`)}>${itemIcon(i, 'sm')}${i.locked ? '<span class="lock">🔒</span>' : ''}<span class="ilvl">${i.level}</span></button>`.replace('<button ', itemTextMatch(i, salv.text) ? '<button ' : '<button style="display:none" ')).join('') || `<p class="muted">${p.inventory.length ? 'No item matches these filters.' : 'Your inventory is empty.'}</p>`}</div>
      <div class="row between wrap gap"><span class="small">${sel.length} selected → ${matsList(preview)}</span>
        <span class="row gap"><button class="btn tiny ghost" data-salv-clear>Clear</button><button class="btn small primary" data-salv-go ${sel.length ? '' : 'disabled'}>Salvage selected</button></span></div>
      <div class="row gap wrap small" style="margin-top:8px"><span class="muted">Salvage all unlocked:</span>${CONFIG.rarities.slice(0, 4).map(r => `<button class="btn tiny ghost" data-salv-rarity="${r.id}">≤ ${esc(r.label)}</button>`).join('')}</div>
      <label class="inline small" style="margin-top:8px">Auto-loot (items below your auto threshold / when inventory is full):
        <select data-autoloot><option value="sell" ${p.settings.autoLootAction !== 'salvage' ? 'selected' : ''}>Sell for gold</option><option value="salvage" ${p.settings.autoLootAction === 'salvage' ? 'selected' : ''}>Salvage into materials</option></select></label>`;
  }
  if (id === 'expedition_camp') {
    return `<h4>Expeditions</h4><p>${(p.expeditions || []).length} of ${[0, 1, 2, 3, 4, 5][b.level]} expedition slots in use. Ore, herbs, gems and arcane materials are brought back by recruits you send out.</p>
      <a class="btn primary small" href="#/expeditions">Open Expeditions →</a>`;
  }
  if (def.kind === 'craft') {
    const w = T.worker(p, id);
    const cap = T.craftLevelCap(p, id, h.level);
    const bases = T.craftableBases(def.type);
    if (!ui.craftBase || ITEM_MATERIAL[ui.craftBase] !== def.type) ui.craftBase = bases[0].id;
    const lvl = Math.min(cap, ui.craftLevel || cap);
    const qualities = Object.entries(QUALITIES).filter(([, q]) => q.building <= b.level);
    if (!QUALITIES[ui.craftQuality] || QUALITIES[ui.craftQuality].building > b.level) ui.craftQuality = 'standard';
    const cost = T.craftCost(ui.craftBase, lvl, ui.craftQuality);
    const base = ITEM_BASES[ui.craftBase];
    return `<h4>Craft</h4>
      ${w ? '' : '<div class="notice small">Assign a worker to start crafting.</div>'}
      <div class="recipe-grid">${bases.map(bs => `<button class="recipe ${bs.id === ui.craftBase ? 'active' : ''}" data-recipe="${bs.id}">${itemIcon({ baseId: bs.id, slot: bs.slot, rarity: 'common', name: bs.name }, 'sm')}<span>${esc(bs.name)}<small>${esc(SLOTS[bs.slot].label)}</small></span></button>`).join('')}</div>
      <div class="craft-form">
        <label class="inline small">Item level <input type="number" data-craft-level min="1" max="${cap}" value="${lvl}"> <span class="muted">max ${cap}${cap < h.level ? ` (building level ${b.level} → up to ${CRAFT_LEVEL_CAP[b.level]})` : ''}</span></label>
        <label class="inline small">Quality <select data-craft-quality>${qualities.map(([qid, q]) => `<option value="${qid}" ${qid === ui.craftQuality ? 'selected' : ''}>${esc(q.label)} (${q.minRarity}+)</option>`).join('')}</select></label>
        <div class="small muted">${esc(base.name)} · ${base.classes ? base.classes.map(c => CLASSES[c].name).join(', ') : 'all classes'} · rarity is rolled — a skilled worker (${w ? w.profession.level : 0}) and a better building raise the odds</div>
        <div class="row between wrap gap">${costHtml(p, cost)}<button class="btn primary" data-craft="${id}" ${w ? '' : 'disabled'}>Craft</button></div>
      </div>
      ${reforgeHtml(p, id, def, cap, w)}`;
  }
  if (id === 'enchanter') return enchantHtml(p, b);
  if (id === 'alchemy_lab') {
    const w = T.worker(p, id);
    const mins = T.elixirMinutes(b.level, w?.profession.level || 0);
    return `<h4>Elixirs</h4>
      ${w ? '' : '<div class="notice small">Assign a worker with Alchemy first.</div>'}
      <p class="muted small">Each brew empowers your party for ${mins} minutes — in solo fights, co-op and offline progress. Brew again to extend (up to 8 hours).</p>
      <div class="elixir-list">${Object.entries(ELIXIRS).map(([eid, e]) => {
        const exp = p.town.elixirs[eid] || 0;
        const active = exp > now();
        const locked = e.level > b.level;
        return `<div class="elixir ${active ? 'active' : ''} ${locked ? 'locked' : ''}">${elixirIcon(eid, 'sm')}
          <div class="grow"><b>${esc(e.name)}</b> ${active ? `<span class="tag live">${countdown(exp)}</span>` : ''}<div class="small muted">${esc(e.description)}</div>
          ${locked ? `<div class="small faint">Requires Alchemy Lab level ${e.level}</div>` : costHtml(p, T.elixirCost(eid, h.level))}</div>
          <button class="btn small ${active ? '' : 'primary'}" data-brew="${eid}" ${locked || !w ? 'disabled' : ''}>${active ? 'Extend' : 'Brew'}</button></div>`;
      }).join('')}</div>`;
  }
  return '';
}

function detailHtml(p, id) {
  const def = BUILDINGS[id];
  const b = p.town.buildings[id];
  return `<div class="panel building-detail">
    <div class="row gap">${buildingArt(id, 'lg')}<div class="grow"><h2>${esc(def.name)} <span class="muted small">${b.level ? `Level ${b.level}/${def.maxLevel}` : 'Not built'}</span></h2>
      <p class="muted small">${esc(def.description)}</p>
      ${b.level ? `<div class="effects">${buildingEffects(def.id, b.level).map(e => `<span class="chip">${esc(e)}</span>`).join(' ')}</div>` : ''}</div></div>
    ${upgradeHtml(p, id)}
    ${workerHtml(p, id)}
    <div class="building-specific">${specificHtml(p, id)}</div>
  </div>`;
}

function resourcesHtml(p) {
  const elixirs = Object.entries(p.town.elixirs).filter(([, exp]) => exp > now());
  return `<div class="panel town-resources">
    <div class="res-list">${MATERIAL_IDS.filter(m => MATERIALS[m].group !== 'shard' && (MATERIALS[m].group !== 'zone' || (p.town.materials[m] || 0) >= 1)).map(m => `<span class="res" ${tipAttr(`<b>${esc(MATERIALS[m].name)}</b><br>${esc(MATERIALS[m].description)}`)}>${materialIcon(m, 'xs')}<b>${fmt(Math.floor(p.town.materials[m] || 0))}</b></span>`).join('')}</div>
    <div class="row gap wrap">
      <span class="res" ${tipAttr('Ashen Crystals: finish constructions and expeditions instantly')}>${premiumTxt(p.premium || 0)}</span>
      ${elixirs.map(([eid, exp]) => `<span class="active-elixir" ${tipAttr(esc(ELIXIRS[eid].description))}>${elixirIcon(eid, 'xxs')} ${countdown(exp)}</span>`).join('')}
      <a class="btn small" href="#/expeditions">🧭 Expeditions</a>
      <a class="btn small" href="#/gems">💎 Gems · ${fmt(MATERIAL_IDS.filter(m => MATERIALS[m].group === 'shard').reduce((n, m) => n + Math.floor(p.town.materials[m] || 0), 0))} shards</a>
    </div>
  </div>`;
}

// ------------------------------------------------------------------ view
export const townView = {
  id: 'town', label: 'Town', icon: '🏰',
  mount(root) {
    const rerender = () => this.render(root);
    root.addEventListener('click', async e => {
      const p = state.player;
      const t = e.target.closest('button');
      if (!t) return;
      const d = t.dataset;
      if (d.building) { ui.selected = d.building; ui.salvageSel.clear(); rerender(); return; }
      if (d.upgrade) { await run(act('town_upgrade', { buildingId: d.upgrade }), 'Construction started!'); return; }
      if (d.speedBuild) {
        const cost = skipCost(Number(d.speedEnd));
        if ((p.premium || 0) < cost) return toast(`You need ${cost} Ashen Crystals (you have ${p.premium || 0}).`, 'error');
        if (await confirmSpend(cost, `finish the ${BUILDINGS[d.speedBuild].name} now`)) await run(act('town_speedup', { buildingId: d.speedBuild, maxCost: cost }));
        return;
      }
      if (d.assign) { await run(act('town_assign', { buildingId: d.assign, charId: d.char }), 'Worker assigned.'); return; }
      if (d.unassign) { await run(act('town_assign', { buildingId: d.unassign, charId: null })); return; }
      if (d.salv) {
        const it = p.inventory.find(i => i.uid === d.salv);
        if (it?.locked) return toast('That item is locked.', 'error');
        ui.salvageSel.has(d.salv) ? ui.salvageSel.delete(d.salv) : ui.salvageSel.add(d.salv);
        rerender(); return;
      }
      if ('salvClear' in d) { ui.salvageSel.clear(); rerender(); return; }
      if ('salvAll' in d) {
        const b = p.town.buildings.salvage_yard;
        for (const i of salvageItems(p, b?.level || 1, !!T.worker(p, 'enchanter'))) if (!i.locked && itemTextMatch(i, salv.text)) ui.salvageSel.add(i.uid);
        rerender(); return;
      }
      if ('salvGo' in d) {
        const r = await run(act('salvage_items', { itemUids: [...ui.salvageSel] }));
        if (r) { ui.salvageSel.clear(); toast(`Salvaged ${r.count} item(s): ${Object.entries(r.materials).map(([k, v]) => `${v} ${MATERIALS[k].name}`).join(', ')}`, 'success'); }
        return;
      }
      if (d.salvRarity) {
        const label = CONFIG.rarities.find(r => r.id === d.salvRarity).label;
        if (!await confirmBox(`Salvage every unlocked item of ${label} rarity or below?`, 'Salvage')) return;
        const r = await run(act('salvage_by_rarity', { maxRarity: d.salvRarity }));
        if (r) { ui.salvageSel.clear(); toast(`Salvaged ${r.count} item(s): ${Object.entries(r.materials).map(([k, v]) => `${v} ${MATERIALS[k].name}`).join(', ')}`, 'success'); }
        return;
      }
      if (d.recipe) { ui.craftBase = d.recipe; rerender(); return; }
      if (d.reforgePick) { ui.reforgeChar = d.reforgePick; rerender(); return; }
      if (d.craft) {
        const r = await run(act('craft_item', { buildingId: d.craft, baseId: ui.craftBase, level: Number(root.querySelector('[data-craft-level]').value), quality: ui.craftQuality }));
        if (r) toast(`Crafted ${r.item.name} (${CONFIG.rarities.find(x => x.id === r.item.rarity).label})!`, 'success');
        return;
      }
      if (d.reforge) { const r = await run(act('reforge_item', { buildingId: ui.selected, itemUid: d.reforge, charId: d.char || null })); if (r) toast(`${r.item.name} reforged to item level ${r.item.level}.`, 'success'); return; }
      if (d.enchantPick) { ui.enchantChar = d.enchantPick; rerender(); return; }
      if (d.enchantStatPick) { ui.enchantStat = d.enchantStatPick; rerender(); return; }
      if (d.enchantUid) {
        const r = await run(act('enchant_item', { itemUid: d.enchantUid, charId: d.char || null, stat: ui.enchantStat }));
        if (r) toast(`${r.item.name} enchanted: +${STAT_LABELS[r.item.enchant.stat]}`, 'success');
        return;
      }
      if (d.brew) { const r = await run(act('brew_elixir', { elixirId: d.brew })); if (r) toast(`${ELIXIRS[d.brew].name} active for ${duration((r.expiresAt - now()) / 1000)}.`, 'success'); }
    });
    root.addEventListener('input', e => {
      if (e.target.matches('[data-salv-text]')) { salv.text = e.target.value; applySalvText(root); }
    });
    root.addEventListener('change', async e => {
      const t = e.target;
      if (t.matches('[data-craft-level]')) { ui.craftLevel = Number(t.value) || null; rerender(); }
      else if (t.matches('[data-craft-quality]')) { ui.craftQuality = t.value; rerender(); }
      else if (t.matches('[data-salv-f]')) { const k = t.dataset.salvF; salv[k] = t.type === 'checkbox' ? t.checked : t.value; rerender(); }
      else if (t.matches('[data-autoloot]')) await run(act('set_settings', { autoLootAction: t.value }), 'Auto-loot updated.');
    });
    // live countdowns and progress bars
    timer = setInterval(() => {
      const p = state.player;
      if (!p?.town) return;
      root.querySelectorAll('[data-ends]').forEach(el => { el.textContent = duration(Math.max(0, (Number(el.dataset.ends) - now()) / 1000)); });
      root.querySelectorAll('[data-speed-end]').forEach(el => { const c = el.querySelector('[data-speed-cost]'); if (c) c.textContent = skipCost(Number(el.dataset.speedEnd)); });
      root.querySelectorAll('[data-progress-end]').forEach(el => {
        const s = Number(el.dataset.progressStart), en = Number(el.dataset.progressEnd);
        const f = el.querySelector('.fill');
        if (f) f.style.width = `${Math.min(100, ((now() - s) / Math.max(1, en - s)) * 100)}%`;
      });
    }, 1000);
  },
  unmount() { clearInterval(timer); },
  render(root) {
    const p = state.player;
    if (!p?.town) return;
    const groups = [
      ['Core', BUILDING_IDS.filter(id => BUILDINGS[id].kind === 'core')],
      ['Crafting', BUILDING_IDS.filter(id => BUILDINGS[id].kind === 'craft')],
      ['Arcane', BUILDING_IDS.filter(id => BUILDINGS[id].kind === 'special')],
    ];
    const builds = Object.values(p.town.buildings).filter(b => b.upgrade).length;
    morphed(root).innerHTML = `
      ${resourcesHtml(p)}
      <div class="town-layout">
        <div class="town-buildings">
          <div class="muted small">Constructions: ${builds} / ${[0, 1, 1, 2, 2, 3][T.bLevel(p, 'town_hall')]} · Buildings can be upgraded up to the Town Hall level.</div>
          ${groups.map(([label, ids]) => `<h4>${label}</h4><div class="building-grid">${ids.map(id => cardHtml(p, id)).join('')}</div>`).join('')}
        </div>
        <div class="town-detail">${detailHtml(p, ui.selected)}</div>
      </div>`;
  },
};

export { rarityIndex };
