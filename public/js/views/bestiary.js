// Bestiary: every enemy with its abilities, boss phases, where it lives, tips and kill mastery.
import { state, hero } from '../state.js';
import { esc, fmt, bar, modal, tipAttr } from '../ui.js';
import { enemyArt, statusIcon } from '../assets.js';
import { ENEMIES } from '/shared/data/enemies.js';
import { ZONES, COOP_ENCOUNTERS } from '/shared/data/zones.js';
import { STATUSES } from '/shared/data/statuses.js';
import { describeEnemyAbility, describePhases, enemyTips, enemyLocations, enemyStats, defaultLevel, enemyKind, masteryTiers, masteryLevel, MASTERY } from '/shared/bestiary.js';
import { CONFIG } from '/shared/config.js';

const ui = { selected: null, search: '', filter: 'all', level: null };

// groups in world order: zones, then co-op only enemies
function groups() {
  const used = new Set();
  const out = [];
  for (const z of Object.values(ZONES).sort((a, b) => a.order - b.order)) {
    const ids = [...z.enemies, z.boss].filter(id => !used.has(id));
    ids.forEach(id => used.add(id));
    out.push({ title: z.name, sub: `Lv ${z.levelRange[0]}–${z.levelRange[1]}`, ids });
  }
  const coop = [];
  for (const e of Object.values(COOP_ENCOUNTERS)) for (const w of e.waves) for (const id of w) if (!used.has(id)) { used.add(id); coop.push(id); }
  if (coop.length) out.push({ title: 'Co-op encounters', sub: '', ids: coop });
  return out;
}

const entry = id => state.player?.bestiary?.[id] || null;
const stars = (id, kills) => { const l = masteryLevel(id, kills); return `<span class="stars">${'★'.repeat(l)}<span class="dim">${'★'.repeat(3 - l)}</span></span>`; };

function listHtml() {
  const q = ui.search.toLowerCase();
  const seenCount = Object.keys(state.player?.bestiary || {}).length;
  const total = Object.keys(ENEMIES).length;
  return `<div class="best-list-head">
      <input data-best-search placeholder="Search enemies or abilities…" value="${esc(ui.search)}">
      <select data-best-filter>${[['all', 'All enemies'], ['seen', 'Encountered'], ['unseen', 'Not encountered'], ['boss', 'Bosses & elites']].map(([v, l]) => `<option value="${v}" ${ui.filter === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <div class="muted small">Discovered ${seenCount}/${total}</div>
    </div>
    ${groups().map(g => {
      const ids = g.ids.filter(id => {
        const e = ENEMIES[id], en = entry(id);
        if (ui.filter === 'seen' && !en) return false;
        if (ui.filter === 'unseen' && en) return false;
        if (ui.filter === 'boss' && !e.boss && !e.tags.includes('elite')) return false;
        if (q && !e.name.toLowerCase().includes(q) && !e.tags.some(t => t.includes(q)) && !e.abilities.some(a => describeEnemyAbility(a)?.name.toLowerCase().includes(q))) return false;
        return true;
      });
      if (!ids.length) return '';
      return `<div class="best-group"><div class="best-group-title">${esc(g.title)} <span class="muted small">${esc(g.sub)}</span></div>
        ${ids.map(id => {
          const e = ENEMIES[id], en = entry(id);
          return `<button class="best-row ${ui.selected === id ? 'active' : ''} ${en ? '' : 'unseen'}" data-enemy="${id}">
            ${enemyArt(id, 'xs')}<span class="grow"><span><b>${esc(e.name)}</b>${e.boss ? ' <span class="tag boss">BOSS</span>' : e.tags.includes('elite') ? ' <span class="tag elite">ELITE</span>' : ''}</span>
            <span class="muted small">${en ? `${fmt(en.kills)} slain` : 'not encountered yet'}</span></span>${en ? stars(id, en.kills) : ''}</button>`;
        }).join('')}</div>`;
    }).join('') || '<p class="muted pad">No enemies match.</p>'}`;
}

const statusChip = id => (STATUSES[id] ? `<span class="status-chip" ${tipAttr(`<b>${esc(STATUSES[id].name)}</b><br>${esc(STATUSES[id].description)}`)}>${statusIcon(id, 'xxs')} ${esc(STATUSES[id].name)}</span>` : '');

export function enemyDetailHtml(id, level = null) {
  const e = ENEMIES[id];
  if (!e) return '<p class="muted">Unknown enemy.</p>';
  const h = hero();
  const lvl = Math.max(1, Math.min(CONFIG.levelCap, level || defaultLevel(id, h?.level || 1)));
  const st = enemyStats(id, lvl);
  const en = entry(id);
  const kills = en?.kills || 0;
  const tiers = masteryTiers(id);
  const ml = masteryLevel(id, kills);
  const nextGoal = tiers[ml];
  const abilities = e.abilities.map(a => describeEnemyAbility(a, st));
  const phases = describePhases(e, st);
  const statRows = [
    ['Health', fmt(st.maxHp)], ['Attack power', fmt(st.physPower)], ['Magic power', fmt(st.magPower)], ['Defense', fmt(st.defense)],
    ['Attack speed', st.attackSpeed.toFixed(2)], ['Critical chance', Math.round(st.critChance * 100) + '%'], ['Basic attack', e.basicSchool === 'magical' ? 'Magical' : 'Physical'],
  ];
  return `<div class="best-detail">
    <div class="best-head">${enemyArt(id, 'lg')}
      <div class="grow">
        <h2>${esc(e.name)}</h2>
        <div class="row gap wrap"><span class="tag ${e.boss ? 'boss' : e.tags.includes('elite') ? 'elite' : ''}">${enemyKind(e).toUpperCase()}</span>${e.tags.filter(t => !['boss', 'minion', 'elite', 'world_boss'].includes(t)).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
        <div class="best-mastery">
          ${en ? `<div>${stars(id, kills)} <b>${fmt(kills)}</b> slain · ${ml ? `+${Math.round(MASTERY.bonus[ml - 1] * 100)}% damage against it` : 'no mastery yet'}</div>
            ${nextGoal ? bar(kills, nextGoal, 'thin', `${fmt(kills)} / ${fmt(nextGoal)} for ${'★'.repeat(ml + 1)} (+${Math.round(MASTERY.bonus[ml] * 100)}% damage)`) : '<div class="small gold-text">Mastery complete!</div>'}`
          : `<span class="muted">Not encountered yet — defeat ${tiers[0]} for ★ mastery (+${Math.round(MASTERY.bonus[0] * 100)}% damage against it).</span>`}
        </div>
      </div>
    </div>

    <div class="best-cols">
      <section>
        <h4>Stats <label class="small muted best-level">at level <input type="number" data-best-level min="1" max="${CONFIG.levelCap}" value="${lvl}"></label></h4>
        <div class="best-stats">${statRows.map(([k, v]) => `<div class="stat-row"><span>${k}</span><b>${v}</b></div>`).join('')}</div>
        ${e.enrageAfter ? `<p class="small warn-text">⏱ Enrages after ${e.enrageAfter}s (+50% damage, +30% attack speed).</p>` : ''}
        <h4>Found in</h4>
        <ul class="best-locs">${enemyLocations(id).map(l => `<li>${esc(l.name)}${l.levels ? ` <span class="muted small">Lv ${l.levels[0]}–${l.levels[1]}</span>` : l.minLevel ? ` <span class="muted small">Lv ${l.minLevel}+</span>` : ''}</li>`).join('')}</ul>
      </section>
      <section>
        <h4>Abilities</h4>
        ${abilities.map(a => `<div class="best-ability">
            <div class="row gap"><b>${esc(a.name)}</b><span class="tag">${esc(a.type)}</span>${a.area ? '<span class="tag warn">AREA</span>' : ''}<span class="muted small">every ${a.cooldown}s</span></div>
            <div class="small">${esc(a.text)}</div>
            <div class="muted small">${esc(a.when)}</div>
            ${a.statuses.length ? `<div class="row gap wrap">${a.statuses.map(statusChip).join('')}</div>` : ''}
          </div>`).join('') || '<p class="muted small">Only basic attacks.</p>'}
        ${phases.length ? `<h4>Boss phases</h4>${phases.map(ph => `<div class="best-phase"><span class="tag boss">${ph.hpBelow}% HP</span> <b>${esc(e.name)} ${esc(ph.message)}</b><div class="small muted">${esc(ph.text)}</div></div>`).join('')}` : ''}
      </section>
    </div>
    <section class="best-tips">
      <h4>How to prepare</h4>
      <ul>${enemyTips(id).map(t => `<li>${esc(t)}</li>`).join('')}</ul>
    </section>
  </div>`;
}

// used from the combat screen: click an enemy to look it up
export function openBestiary(enemyId) {
  let level = null;
  const m = modal(`<div class="best-modal">${enemyDetailHtml(enemyId)}</div><div class="row end gap"><a class="btn ghost" href="#/bestiary" data-close data-best-open="${esc(enemyId)}">Open in Bestiary</a><button class="btn primary" data-close>Close</button></div>`, { wide: true });
  m.el.addEventListener('change', e => {
    if (!e.target.matches('[data-best-level]')) return;
    level = Number(e.target.value);
    m.el.querySelector('.best-modal').innerHTML = enemyDetailHtml(enemyId, level);
  });
  m.el.querySelector('[data-best-open]').addEventListener('click', () => { ui.selected = enemyId; ui.level = null; });
}

export const bestiaryView = {
  id: 'bestiary', label: 'Bestiary', icon: '📖',
  mount(root) {
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-enemy]');
      if (b) {
        ui.selected = b.dataset.enemy; ui.level = null;
        root.querySelectorAll('.best-row').forEach(r => r.classList.toggle('active', r === b));
        const host = root.querySelector('.best-detail-host');
        host.innerHTML = enemyDetailHtml(ui.selected);
        if (host.getBoundingClientRect().top < 0 || window.innerWidth < 900) host.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
    });
    root.addEventListener('input', e => {
      if (e.target.matches('[data-best-search]')) {
        ui.search = e.target.value;
        root.querySelector('.best-list').innerHTML = listHtml();
        const inp = root.querySelector('[data-best-search]');
        inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length);
      }
    });
    root.addEventListener('change', e => {
      if (e.target.matches('[data-best-filter]')) { ui.filter = e.target.value; root.querySelector('.best-list').innerHTML = listHtml(); }
      if (e.target.matches('[data-best-level]')) { ui.level = Number(e.target.value); root.querySelector('.best-detail-host').innerHTML = enemyDetailHtml(ui.selected, ui.level); }
    });
  },
  render(root) {
    if (document.activeElement?.matches?.('[data-best-search], [data-best-level]')) return; // don't steal focus while typing
    if (!ui.selected) {
      const z = ZONES[state.player.zone];
      ui.selected = z?.boss || 'wolf';
    }
    const list = root.querySelector('.best-list');
    if (!list) {
      root.innerHTML = `<div class="best-layout">
        <section class="panel best-list">${listHtml()}</section>
        <section class="panel best-detail-host">${enemyDetailHtml(ui.selected, ui.level)}</section>
      </div>`;
      return;
    }
    // live update (kill counts) without losing scroll positions
    const scroll = list.scrollTop;
    list.innerHTML = listHtml();
    list.scrollTop = scroll;
    root.querySelector('.best-detail-host').innerHTML = enemyDetailHtml(ui.selected, ui.level);
  },
};
