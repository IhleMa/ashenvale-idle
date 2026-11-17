// Centralized asset system.
// Every visual looks itself up by a key like "items/sword" or "enemies/wolf". If an image file with that
// name exists in public/assets/ it is used, otherwise a generated placeholder is shown.
// See public/assets/README.md for the full list of keys.
import { CLASSES } from '/shared/data/classes.js';
import { ABILITIES } from '/shared/data/abilities.js';
import { STATUSES } from '/shared/data/statuses.js';
import { ENEMIES } from '/shared/data/enemies.js';
import { ITEM_BASES, SLOTS } from '/shared/data/items.js';
import { rarityById } from '/shared/config.js';
import { esc } from './ui.js';

let index = {};

export async function loadAssets() {
  try {
    const r = await fetch('/api/assets', { cache: 'no-store' });
    index = (await r.json()).assets || {};
  } catch { index = {}; }
  applyGlobalArt();
  return index;
}

export function assetUrl(...keys) {
  for (const k of keys) {
    if (!k) continue;
    const u = index[k.toLowerCase()];
    if (u) return u;
  }
  return null;
}

export function assetKeys(prefix) {
  return Object.keys(index).filter(k => k.startsWith(prefix));
}

// Optional UI art: assets/ui/background.*, assets/ui/logo.*
function applyGlobalArt() {
  const bg = assetUrl('ui/background');
  document.documentElement.style.setProperty('--app-bg-image', bg ? `url("${bg}")` : 'none');
  const logo = assetUrl('ui/logo');
  document.querySelectorAll('[data-logo]').forEach(el => {
    el.innerHTML = logo ? `<img src="${esc(logo)}" alt="Ashenvale Idle">` : 'Ashenvale <span>Idle</span>';
  });
}

const initials = name => String(name || '?').split(/\s+/).filter(w => /^[A-Za-z]/.test(w)).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';

function render(url, { cls = '', color = '#555', glyph = '?', title = '', extra = '' }) {
  const t = title ? ` title="${esc(title)}"` : '';
  if (url) return `<span class="art ${cls}"${t} ${extra}><img src="${esc(url)}" alt="${esc(title)}" loading="lazy" draggable="false"></span>`;
  return `<span class="art ph ${cls}" style="--ph:${color}"${t} ${extra}><span class="ph-glyph">${esc(glyph)}</span></span>`;
}

// --- Entity helpers --------------------------------------------------------------
export function classIcon(classId, cls = '') {
  const c = CLASSES[classId] || {};
  return render(assetUrl(`classes/${classId}`), { cls: `class-icon ${cls}`, color: c.color, glyph: c.glyph, title: c.name });
}

export function portrait(ch, cls = '') {
  const c = CLASSES[ch.classId] || {};
  const url = assetUrl(ch.portrait ? `portraits/${ch.portrait}` : null, `portraits/${ch.classId}`, `classes/${ch.classId}`);
  return render(url, { cls: `portrait ${cls}`, color: c.color, glyph: c.glyph || initials(ch.name), title: ch.name });
}

const TYPE_GLYPH = { damage: '⚔', heal: '✚', buff: '▲', debuff: '▼', control: '✱', utility: '◆' };
export function abilityIcon(abilityId, cls = '') {
  const a = ABILITIES[abilityId] || {};
  const color = CLASSES[a.classId]?.color || '#8a3b3b';
  return render(assetUrl(`abilities/${abilityId}`), { cls: `ability-icon ${cls}`, color, glyph: TYPE_GLYPH[a.type] || '•', title: a.name });
}

const SLOT_GLYPH = { weapon: '⚔', offhand: '⛨', head: '⛑', chest: '👕', hands: '🧤', feet: '👢', ring: '💍', amulet: '📿' };
export function itemIcon(item, cls = '') {
  const r = rarityById(item.rarity);
  const url = assetUrl(`items/${item.baseId}_${item.rarity}`, `items/${item.baseId}`, `items/slot_${item.slot || ITEM_BASES[item.baseId]?.slot}`);
  return render(url, { cls: `item-icon rarity-${item.rarity} ${cls}`, color: r.color, glyph: SLOT_GLYPH[item.slot || ITEM_BASES[item.baseId]?.slot] || '◆', title: item.name });
}

export function slotIcon(slot, cls = '') {
  return render(assetUrl(`items/slot_${slot}`), { cls: `item-icon empty ${cls}`, color: '#333', glyph: SLOT_GLYPH[slot] || '◆', title: SLOTS[slot]?.label });
}

export function enemyArt(enemyId, cls = '') {
  const e = ENEMIES[enemyId] || { name: enemyId, tags: [] };
  const color = e.boss ? '#a8322d' : e.tags?.includes('elite') ? '#a86b2d' : e.tags?.includes('caster') ? '#5a3fa8' : '#4d5a4a';
  return render(assetUrl(`enemies/${enemyId}`), { cls: `portrait enemy ${cls}`, color, glyph: initials(e.name), title: e.name });
}

export function statusIcon(statusId, cls = '') {
  const s = STATUSES[statusId] || { name: statusId };
  return render(assetUrl(`statuses/${statusId}`), { cls: `status-icon ${s.type || ''} ${cls}`, color: s.type === 'buff' ? '#2d7a43' : '#8a2d2d', glyph: initials(s.name), title: `${s.name}: ${s.description || ''}` });
}

export function achievementIcon(id, done, cls = '') {
  return render(assetUrl(`achievements/${id}`), { cls: `achievement-icon ${done ? 'done' : ''} ${cls}`, color: done ? '#b8862d' : '#3a3a3a', glyph: '★' });
}

// Background images (zones/encounters) are applied with CSS so the layout never depends on them
export function backgroundStyle(...keys) {
  const url = assetUrl(...keys);
  return url ? `background-image: linear-gradient(rgba(10,8,8,.55), rgba(10,8,8,.85)), url('${esc(url)}');` : '';
}

// --- Town ------------------------------------------------------------------------
import { BUILDINGS, MATERIALS, PROFESSIONS, ELIXIRS } from '/shared/data/town.js';
const BUILDING_GLYPH = { town_hall: '🏰', inn: '🍺', salvage_yard: '🔨', mine: '⛏', herb_garden: '🌿', blacksmith: '⚒', leatherworker: '🪡', tailor: '🧶', jeweler: '💍', enchanter: '✨', alchemy_lab: '⚗' };
export function buildingArt(id, cls = '') {
  return render(assetUrl(`buildings/${id}`), { cls: `building-art ${cls}`, color: '#6b4a32', glyph: BUILDING_GLYPH[id] || '🏠', title: BUILDINGS[id]?.name });
}
export function materialIcon(id, cls = '') {
  const m = MATERIALS[id] || {};
  return render(assetUrl(`materials/${id}`), { cls: `material-icon ${cls}`, color: m.color || '#555', glyph: m.glyph || '?', title: m.name });
}
export function professionIcon(id, cls = '') {
  const pr = PROFESSIONS[id] || {};
  return render(assetUrl(`professions/${id}`), { cls: `profession-icon ${cls}`, color: '#4a3a2a', glyph: pr.glyph || '?', title: pr.name });
}
export function elixirIcon(id, cls = '') {
  const e = ELIXIRS[id] || {};
  return render(assetUrl(`elixirs/${id}`), { cls: `elixir-icon ${cls}`, color: '#3a5a4a', glyph: e.glyph || '⚗', title: e.name });
}
