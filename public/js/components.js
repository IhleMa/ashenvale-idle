// Shared UI fragments.
import { state, chars } from './state.js';
import { portrait, classIcon } from './assets.js';
import { esc } from './ui.js';
import { CLASSES, classTier } from '/shared/data/classes.js';
import { CONFIG } from '/shared/config.js';
import { hasAbilityAction } from '/shared/character.js';

export function charPicker(selectedId) {
  return `<div class="char-picker">${chars().map(c => `
    <button class="char-chip ${c.id === selectedId ? 'active' : ''}" data-pick-char="${c.id}" title="${esc(c.name)}">
      ${portrait(c, 'xs')}
      <span class="chip-text"><b>${esc(c.name)}${c.isMain ? ' <span class="hero-star" title="Hero">★</span>' : ''}</b><small>Lv ${c.level} ${esc(CLASSES[c.classId].name)}</small></span>
      ${hasAbilityAction(c) ? '<span class="dot" title="Unspent skill points"></span>' : ''}
    </button>`).join('')}</div>`;
}

// Binds picker clicks in a container (call once in mount)
export function bindPicker(root, onPick) {
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-pick-char]');
    if (!b) return;
    state.selectedCharId = b.dataset.pickChar;
    onPick();
  });
}

export function charTitle(ch) {
  return classTier(ch.classId, ch.level, ch.isMain)?.title || CLASSES[ch.classId].name;
}

export function roleBadge(role) {
  return `<span class="role-badge role-${role}">${esc(CONFIG.roles[role]?.label || role)}</span>`;
}

export function classBadge(classId) {
  const c = CLASSES[classId];
  return `<span class="class-badge" style="--cc:${c.color}">${classIcon(classId, 'xxs')} ${esc(c.name)}</span>`;
}
