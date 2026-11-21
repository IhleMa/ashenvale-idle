// Recruitment: tavern offers and roster management.
import { morphed } from '../morph.js';
import { state, chars } from '../state.js';
import { act } from '../net.js';
import { esc, fmt, run, tipAttr, duration, confirmBox } from '../ui.js';
import { portrait } from '../assets.js';
import { classBadge, roleBadge } from '../components.js';
import { CONFIG } from '/shared/config.js';
import { CLASSES, TRAITS } from '/shared/data/classes.js';
import { computeStats, powerRating } from '/shared/stats.js';
import { createCharacter } from '/shared/character.js';
import { rosterLimit } from '/shared/town.js';
import { busyWith } from '/shared/expeditions.js';
import { BUILDINGS as TOWN_BUILDINGS } from '/shared/data/town.js';
import { EXPEDITIONS } from '/shared/data/expeditions.js';
import { PROFESSIONS } from '/shared/data/town.js';
import { professionIcon } from '../assets.js';

let timer = null;

export const recruitmentView = {
  id: 'recruitment', label: 'Recruitment', icon: '🍺',
  mount(root) {
    root.addEventListener('click', async e => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.recruit) await run(act('recruit', { offerId: t.dataset.recruit }));
      if ('refresh' in t.dataset) await run(act('refresh_recruits'), 'New recruits have arrived.');
      if (t.dataset.dismiss) {
        const c = state.player.characters[t.dataset.dismiss];
        if (await confirmBox(`Dismiss ${c.name}? Their equipment returns to your inventory.`, 'Dismiss')) await run(act('dismiss', { charId: c.id }));
      }
      if (t.dataset.view) { state.selectedCharId = t.dataset.view; location.hash = '#/character'; }
    });
    timer = setInterval(() => {
      const el = root.querySelector('[data-refresh-timer]');
      if (el) el.textContent = refreshText();
    }, 1000);
  },
  unmount() { clearInterval(timer); },
  render(root) {
    const p = state.player;
    const h = p.characters[p.heroId];
    const roster = chars().filter(c => !c.isMain);
    const refreshCost = CONFIG.recruitment.refreshCostPerLevel * h.level;
    morphed(root).innerHTML = `
      <section class="panel">
        <div class="panel-head"><h3>The Ashen Tankard — Recruits for hire</h3>
          <div class="row gap"><span class="muted small" data-refresh-timer>${refreshText()}</span><button class="btn small" data-refresh>Refresh now (${fmt(refreshCost)}g)</button></div></div>
        ${p.stats.recruited === 0 ? '<div class="notice good">Your first companion is free! Pick a class that covers what your hero lacks — a healer or a tank is a great start.</div>' : ''}
        <div class="recruit-grid">${p.recruitment.offers.map(o => offerCard(o, p)).join('') || '<p class="muted">No recruits right now. Check back soon.</p>'}</div>
      </section>
      <section class="panel">
        <div class="panel-head"><h3>Your roster <span class="muted small">${roster.length}/${rosterLimit(p)} · <a href="#/town">upgrade the Inn for more rooms</a></span></h3></div>
        <div class="roster-list">${roster.length ? roster.map(c => {
          const inParty = p.parties.some(pt => pt.members.includes(c.id));
          const busy = busyWith(p, c.id);
          const busyTxt = busy ? (busy.type === 'work' ? ` · working at the ${TOWN_BUILDINGS[busy.buildingId]?.name}` : ` · on expedition (${EXPEDITIONS[busy.destId]?.name})`) : '';
          return `<div class="bench-row">${portrait(c, 'sm')}<div class="grow"><b>${esc(c.name)}</b> ${classBadge(c.classId)} ${roleBadge(c.role)}
            <div class="muted small">${c.profession ? `${professionIcon(c.profession.id, 'xxs')} ${esc(PROFESSIONS[c.profession.id].name)} ${c.profession.level} · ` : ''}Lv ${c.level} · ${c.trait ? esc(TRAITS[c.trait].name) : ''} · Power ${fmt(powerRating(computeStats(c)))}${inParty ? ' · in a party' : ''}<span class="warn-text">${esc(busyTxt)}</span></div></div>
            <button class="btn tiny" data-view="${c.id}">View</button><button class="btn tiny danger ghost" data-dismiss="${c.id}">Dismiss</button></div>`;
        }).join('') : '<p class="muted">No companions yet.</p>'}</div>
      </section>`;
  },
};

function refreshText() {
  const p = state.player;
  if (!p) return '';
  const left = CONFIG.recruitment.refreshSeconds - (Date.now() - p.recruitment.refreshedAt) / 1000;
  return left > 0 ? `Free refresh in ${duration(left)}` : 'Free refresh available on next visit';
}

function offerCard(o, p) {
  const cls = CLASSES[o.classId];
  const preview = createCharacter({ id: 'x', name: o.name, classId: o.classId, level: o.level, trait: o.trait, portrait: o.portrait });
  const s = computeStats(preview);
  const cost = p.recruitment.costs[o.offerId];
  const full = Object.values(p.characters).filter(c => !c.isMain).length >= rosterLimit(p);
  return `<div class="recruit-card" style="--cc:${cls.color}">
    ${portrait(preview, 'lg')}
    <div class="recruit-body">
      <b class="recruit-name">${esc(o.name)}</b>
      <div>${classBadge(o.classId)} ${roleBadge(cls.role)}</div>
      <div class="muted small">Level ${o.level} · <span ${tipAttr(esc(TRAITS[o.trait].description))}>${esc(TRAITS[o.trait].name)}</span></div>
      ${o.profession ? `<div class="prof-badge">${professionIcon(o.profession.id, 'xxs')} ${esc(PROFESSIONS[o.profession.id].name)} ${o.profession.level}</div>` : ''}
      <div class="mini-stats small"><span>HP ${fmt(s.maxHp)}</span><span>Power ${fmt(powerRating(s))}</span></div>
      <p class="small muted">${esc(cls.description)}</p>
    </div>
    <button class="btn primary wide" data-recruit="${o.offerId}" ${p.gold < cost || full ? 'disabled' : ''}>${full ? 'Roster full' : cost === 0 ? 'Recruit (free)' : `Recruit · ${fmt(cost)}g`}</button>
  </div>`;
}
