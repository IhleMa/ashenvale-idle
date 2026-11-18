// Shared UI fragments.
import { state, chars } from './state.js';
import { portrait, classIcon } from './assets.js';
import { esc } from './ui.js';
import { CLASSES, classTier } from '/shared/data/classes.js';
import { CONFIG } from '/shared/config.js';
import { hasAbilityAction } from '/shared/character.js';
import { SUBCLASSES, classLabel } from '/shared/data/subclasses.js';

export function charPicker(selectedId) {
  return `<div class="char-picker">${chars().map(c => `
    <button class="char-chip ${c.id === selectedId ? 'active' : ''}" data-pick-char="${c.id}" title="${esc(c.name)}">
      ${portrait(c, 'xs')}
      <span class="chip-text"><b>${esc(c.name)}${c.isMain ? ' <span class="hero-star" title="Hero">★</span>' : ''}</b><small>Lv ${c.level} ${esc(classLabel(c.classId, c.subclass))}</small></span>
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
  if (ch.subclass && SUBCLASSES[ch.subclass]?.title && ch.level >= CONFIG.levelCap) return SUBCLASSES[ch.subclass].title;
  return classTier(ch.classId, ch.level, ch.isMain)?.title || CLASSES[ch.classId].name;
}

export function roleBadge(role) {
  return `<span class="role-badge role-${role}">${esc(CONFIG.roles[role]?.label || role)}</span>`;
}

export function classBadge(classId, subclassId = null) {
  const c = CLASSES[classId];
  const sub = subclassId && SUBCLASSES[subclassId];
  return `<span class="class-badge" style="--cc:${sub?.color || c.color}">${classIcon(classId, 'xxs')} ${esc(sub ? sub.name : c.name)}</span>`;
}
