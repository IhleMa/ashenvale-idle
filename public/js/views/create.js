// Hero creation screen.
import { act } from '../net.js';
import { esc, run } from '../ui.js';
import { classIcon, assetKeys, assetUrl } from '../assets.js';
import { CLASSES, CLASS_IDS } from '/shared/data/classes.js';
import { classAbilities, ABILITIES } from '/shared/data/abilities.js';
import { TREE_SPECS } from '/shared/data/skilltree.js';
import { computeStats, ATTRIBUTES } from '/shared/stats.js';
import { createCharacter } from '/shared/character.js';
import { CONFIG } from '/shared/config.js';

let draft = { name: '', classId: 'warrior', portrait: null };

export const createView = {
  id: 'create', label: 'Create', icon: '',
  mount(root) {
    root.addEventListener('click', async e => {
      const c = e.target.closest('[data-class]');
      if (c) { draft.classId = c.dataset.class; draft.portrait = null; this.render(root); return; }
      const p = e.target.closest('[data-portrait]');
      if (p) { draft.portrait = p.dataset.portrait || null; this.render(root); return; }
      if (e.target.closest('[data-create]')) {
        draft.name = root.querySelector('#hero-name').value;
        await run(act('create_hero', draft));
      }
    });
    root.addEventListener('input', e => { if (e.target.id === 'hero-name') draft.name = e.target.value; });
  },
  render(root) {
    const cls = CLASSES[draft.classId];
    const preview = computeStats(createCharacter({ id: 'x', name: 'x', classId: draft.classId, isMain: true, autoTree: false }));
    const portraits = assetKeys('portraits/').map(k => k.slice(10)).filter(k => k.startsWith(draft.classId) || k.startsWith('any') || !CLASS_IDS.some(c => k.startsWith(c)));
    root.innerHTML = `
    <div class="create-screen">
      <h1 class="title">Create your Hero</h1>
      <p class="muted">Your hero is your permanent main character: slightly stronger than any recruit, with an extra ability slot, bonus attribute points and a unique hero-only class title at level 40.</p>
      <div class="class-grid">
        ${CLASS_IDS.map(id => {
          const c = CLASSES[id];
          return `<button class="class-card ${id === draft.classId ? 'active' : ''}" data-class="${id}" style="--cc:${c.color}">
            ${classIcon(id, 'lg')}<b>${esc(c.name)}</b><small>${esc(CONFIG.roles[c.role].label)}</small></button>`;
        }).join('')}
      </div>
      <div class="create-detail panel">
        <div class="create-left">
          <h2 style="color:${cls.color}">${esc(cls.name)}</h2>
          <p>${esc(cls.description)}</p>
          <div class="two-col">
            <div><h4>Strengths</h4><ul class="plus">${cls.strengths.map(s => `<li>${esc(s)}</li>`).join('')}</ul></div>
            <div><h4>Weaknesses</h4><ul class="minus">${cls.weaknesses.map(s => `<li>${esc(s)}</li>`).join('')}</ul></div>
          </div>
          <h4>Abilities</h4>
          <div class="muted small">Starts with <b>${esc(ABILITIES[TREE_SPECS[draft.classId].start].name)}</b>. Learn the rest in the passive skill tree: ${classAbilities(draft.classId).filter(a => a.id !== TREE_SPECS[draft.classId].start).map(a => esc(a.name)).join(' · ')}</div>
          <h4>Skill tree paths</h4>
          <div class="muted small">${TREE_SPECS[draft.classId].branches.map(b => `<b>${esc(b.name)}</b>`).join(' · ')}</div>
        </div>
        <div class="create-right">
          <h4>Starting attributes</h4>
          <div class="attr-preview">${Object.entries(ATTRIBUTES).map(([k, a]) => `<div><span>${a.label}</span><b>${preview.attributes[k]}</b></div>`).join('')}</div>
          <div class="attr-preview">
            <div><span>Health</span><b>${preview.maxHp}</b></div>
            <div><span>Resource</span><b style="color:${cls.resource.color}">${esc(cls.resource.name)}</b></div>
          </div>
        </div>
      </div>
      ${portraits.length ? `<h3>Appearance</h3><div class="portrait-pick">
        <button class="portrait-opt ${!draft.portrait ? 'active' : ''}" data-portrait="">${classIcon(draft.classId, 'md')}</button>
        ${portraits.map(pk => `<button class="portrait-opt ${draft.portrait === pk ? 'active' : ''}" data-portrait="${esc(pk)}"><span class="art portrait md"><img src="${esc(assetUrl('portraits/' + pk))}" alt=""></span></button>`).join('')}
      </div>` : ''}
      <div class="create-name row gap">
        <input id="hero-name" placeholder="Hero name" maxlength="16" value="${esc(draft.name)}">
        <button class="btn primary big" data-create>Begin your journey</button>
      </div>
    </div>`;
  },
};
