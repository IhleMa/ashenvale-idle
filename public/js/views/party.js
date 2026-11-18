// Party management: presets, member order (position), roles and combined statistics.
import { classLabel } from '/shared/data/subclasses.js';
import { state, chars } from '../state.js';
import { act } from '../net.js';
import { esc, fmt, run, tipAttr } from '../ui.js';
import { portrait } from '../assets.js';
import { roleBadge, classBadge, charTitle } from '../components.js';
import { CONFIG } from '/shared/config.js';
import { computeStats, powerRating } from '/shared/stats.js';
import { partyBonuses } from '/shared/party.js';
import { CLASSES } from '/shared/data/classes.js';
import { busyWith } from '/shared/expeditions.js';
import { BUILDINGS } from '/shared/data/town.js';
import { EXPEDITIONS } from '/shared/data/expeditions.js';

function busyLabel(p, c) {
  const b = busyWith(p, c.id);
  if (!b) return '';
  return b.type === 'work' ? `Working at the ${BUILDINGS[b.buildingId]?.name}` : `On expedition: ${EXPEDITIONS[b.destId]?.name}`;
}

let editingIndex = null;

export const partyView = {
  id: 'party', label: 'Party', icon: '⚑',
  mount(root) {
    root.addEventListener('click', async e => {
      const p = state.player;
      const t = e.target.closest('button');
      if (!t) return;
      const d = t.dataset;
      const idx = editingIndex ?? p.activeParty;
      const members = [...p.parties[idx].members];
      if (d.tab) { editingIndex = Number(d.tab); this.render(root); return; }
      if ('activate' in d) { await run(act('activate_party', { index: idx }), `${p.parties[idx].name} is now fighting.`); return; }
      if ('rename' in d) {
        const name = prompt('Party name', p.parties[idx].name);
        if (name) await run(act('rename_party', { index: idx, name }));
        return;
      }
      if (d.add) {
        if (members.length >= CONFIG.party.size) return;
        await run(act('set_party', { index: idx, members: [...members, d.add] }));
      }
      if (d.remove) await run(act('set_party', { index: idx, members: members.filter(m => m !== d.remove) }));
      if (d.move) {
        const i = members.indexOf(d.move), j = i + Number(d.dir);
        if (j < 0 || j >= members.length) return;
        [members[i], members[j]] = [members[j], members[i]];
        await run(act('set_party', { index: idx, members }));
      }
    });
    root.addEventListener('change', async e => {
      if (e.target.matches('[data-role-for]')) await run(act('set_role', { charId: e.target.dataset.roleFor, role: e.target.value }));
    });
  },
  render(root) {
    const p = state.player;
    const idx = editingIndex ?? p.activeParty;
    const party = p.parties[idx];
    const members = party.members.map(id => p.characters[id]).filter(Boolean);
    const bonus = partyBonuses(members);
    const stats = members.map(c => computeStats(c));
    const roles = new Set(members.map(m => m.role));
    const bench = chars().filter(c => !party.members.includes(c.id));
    root.innerHTML = `
      <div class="tabs">${p.parties.map((pt, i) => `<button class="tab ${i === idx ? 'active' : ''}" data-tab="${i}">${esc(pt.name)}${i === p.activeParty ? ' <span class="live-dot" title="Active">●</span>' : ''}</button>`).join('')}</div>
      <div class="party-layout">
        <section class="panel">
          <div class="panel-head"><h3>${esc(party.name)} <button class="icon-btn small" data-rename title="Rename">✎</button></h3>
            ${idx === p.activeParty ? '<span class="tag live">Active — fighting now</span>' : `<button class="btn primary small" data-activate>Make active</button>`}</div>
          <p class="muted small">Position matters: characters at the front draw more attention from enemies at the start of each fight. Put your tank first. Changes apply from the next fight.</p>
          <div class="party-slots">
            ${members.map((c, i) => `<div class="party-member">
              <span class="pos">${i + 1}</span>
              ${portrait(c, 'md')}
              <div class="grow">
                <b>${c.isMain ? '<span class="hero-star">★</span> ' : ''}${esc(c.name)}</b> <span class="muted small">Lv ${c.level} · ${esc(charTitle(c))}</span>
                <div class="row gap small">${classBadge(c.classId)}
                  <select data-role-for="${c.id}" class="small-select">${Object.entries(CONFIG.roles).map(([id, r]) => `<option value="${id}" ${c.role === id ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select>
                  <span class="muted">HP ${fmt(stats[i].maxHp)} · Power ${fmt(powerRating(stats[i]))}</span>
                </div>
              </div>
              <div class="loadout-btns">
                <button class="icon-btn small" data-move="${c.id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} title="Move forward">▲</button>
                <button class="icon-btn small" data-move="${c.id}" data-dir="1" ${i === members.length - 1 ? 'disabled' : ''} title="Move back">▼</button>
                ${c.isMain ? '<span class="icon-btn small ghost" title="Your hero always fights">🔒</span>' : `<button class="icon-btn small" data-remove="${c.id}" title="Remove">✕</button>`}
              </div>
            </div>`).join('')}
            ${Array.from({ length: CONFIG.party.size - members.length }, () => `<div class="party-member empty"><span class="muted">Empty slot — add a character from your roster</span></div>`).join('')}
          </div>
        </section>
        <section class="panel">
          <h3>Party overview</h3>
          <div class="stat-grid">
            <div class="stat-row"><span>Total health</span><b>${fmt(stats.reduce((s, x) => s + x.maxHp, 0))}</b></div>
            <div class="stat-row"><span>Party power</span><b>${fmt(stats.reduce((s, x) => s + powerRating(x), 0))}</b></div>
            <div class="stat-row"><span>Average level</span><b>${members.length ? Math.round(members.reduce((s, c) => s + c.level, 0) / members.length) : 0}</b></div>
          </div>
          <h4>Roles</h4>
          <div class="role-coverage">${Object.keys(CONFIG.roles).map(r => `<span class="role-check ${roles.has(r) ? 'ok' : ''}">${roles.has(r) ? '✓' : '○'} ${roleBadge(r)}</span>`).join('')}</div>
          ${!roles.has('healer') ? '<div class="notice small">No healer: your party cannot recover health during fights.</div>' : ''}
          ${!roles.has('tank') ? '<div class="notice small">No tank: enemies will attack whoever hurts them most.</div>' : ''}
          <h4>Active bonuses</h4>
          ${bonus.list.length ? `<ul class="bonus-list">${bonus.list.map(b => `<li><b>${esc(b.name)}</b><br><span class="muted small">${esc(b.description)}</span></li>`).join('')}</ul>` : '<p class="muted small">Build a balanced party (Tank + Healer + Damage) with different classes to unlock synergy bonuses.</p>'}
        </section>
        <section class="panel">
          <h3>Roster</h3>
          <div class="bench">${bench.length ? bench.map(c => `<div class="bench-row">${portrait(c, 'sm')}<div class="grow"><b>${esc(c.name)}</b><div class="muted small">Lv ${c.level} ${esc(classLabel(c.classId, c.subclass))} · ${esc(CONFIG.roles[c.role].label)}</div></div>
            ${busyLabel(p, c) ? `<span class="small warn-text">${esc(busyLabel(p, c))}</span>` : `<button class="btn tiny" data-add="${c.id}" ${members.length >= CONFIG.party.size ? 'disabled' : ''}>Add</button>`}</div>`).join('') : '<p class="muted small">Everyone is already in this party. <a href="#/recruitment">Recruit more companions.</a></p>'}</div>
        </section>
      </div>`;
  },
};
