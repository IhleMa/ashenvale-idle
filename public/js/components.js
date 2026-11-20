// Shared UI fragments.
import { state, chars } from './state.js';
import { portrait, classIcon } from './assets.js';
import { esc, run, toast, confirmBox, promptBox, tipAttr } from './ui.js';
import { act } from './net.js';
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

// ---------------------------------------------------------------- builds (saved skill tree + loadout + rules)
const BUILD_SLOTS = 3;
// the character still matches a saved build: same nodes, loadout, plan and rules of the abilities it has
// (rules of abilities that aren't learned right now don't count — they stay around from other builds)
const sameBuild = (ch, b) => b && b.allocated.length === ch.tree.allocated.length && b.allocated.every(n => ch.tree.allocated.includes(n))
  && b.loadout.join() === ch.loadout.join() && (b.plan || []).join() === (ch.tree.plan || []).join()
  && Object.keys(ch.abilities || {}).every(a => !b.rules?.[a] || JSON.stringify(b.rules[a]) === JSON.stringify(ch.rules?.[a]));
export function buildsBar(ch) {
  const builds = ch.builds || [];
  return `<div class="builds-bar"><span class="builds-label" ${tipAttr('Save the skill tree, ability loadout and ability rules, and switch between them for free.')}>Builds</span>${Array.from({ length: BUILD_SLOTS }, (_, i) => {
    const b = builds[i];
    const active = ch.activeBuild === i && b;
    const changed = active && !sameBuild(ch, b);
    if (!b) return `<div class="build-slot empty"><span class="muted small">Empty slot</span><button class="btn tiny" data-build-save="${i}">Save current</button></div>`;
    return `<div class="build-slot ${active ? 'active' : ''}">
      <button class="build-name" data-build-rename="${i}" ${tipAttr(`${b.points} skill points · ${b.loadout.length} abilities${b.subclass && b.subclass !== (ch.subclass || null) ? '<br>Saved with another ascendancy' : ''}<br>Click to rename`)}>${esc(b.name)}${active ? (changed ? ' <span class="warn-text small">● changed</span>' : ' <span class="up small">✓ active</span>') : ''}</button>
      <div class="row gap">${active && !changed ? '' : `<button class="btn tiny primary" data-build-load="${i}">Load</button>`}<button class="btn tiny" data-build-save="${i}">${active && changed ? 'Save changes' : 'Overwrite'}</button><button class="btn tiny ghost" data-build-delete="${i}" title="Delete">✕</button></div>
    </div>`;
  }).join('')}</div>`;
}
// binds the builds bar in a view (call once in mount); getChar returns the shown character
export function bindBuilds(root, getChar) {
  root.addEventListener('click', async e => {
    const t = e.target.closest('[data-build-save],[data-build-load],[data-build-rename],[data-build-delete]');
    if (!t) return;
    const ch = getChar();
    if (!ch) return;
    const d = t.dataset;
    if (d.buildSave != null) {
      const slot = Number(d.buildSave), old = ch.builds?.[slot];
      if (old && ch.activeBuild !== slot && !(await confirmBox(`Overwrite "${old.name}" with the current tree and abilities?`, 'Overwrite'))) return;
      const name = old ? old.name : await promptBox('Name this build', `Build ${slot + 1}`, 'Save');
      if (name == null) return;
      await run(act('build_save', { charId: ch.id, slot, name }), 'Build saved.');
    } else if (d.buildLoad != null) {
      const r = await run(act('build_load', { charId: ch.id, slot: Number(d.buildLoad) }));
      if (r) toast(`Loaded "${r.name}"${r.missing ? ` — ${r.missing} node(s) didn't fit and were left out` : ''}.`, r.missing ? 'info' : 'success');
    } else if (d.buildRename != null) {
      const b = ch.builds?.[Number(d.buildRename)];
      const name = await promptBox('Rename build', b?.name || '', 'Rename');
      if (name) await run(act('build_rename', { charId: ch.id, slot: Number(d.buildRename), name }));
    } else if (d.buildDelete != null) {
      const b = ch.builds?.[Number(d.buildDelete)];
      if (await confirmBox(`Delete the build "${b?.name}"? Your current tree and abilities stay as they are.`, 'Delete')) await run(act('build_delete', { charId: ch.id, slot: Number(d.buildDelete) }));
    }
  });
}
