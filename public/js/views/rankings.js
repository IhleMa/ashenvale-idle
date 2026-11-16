// Rankings / leaderboards. Click a player to inspect them.
import { state } from '../state.js';
import { act } from '../net.js';
import { esc, fmt, toast } from '../ui.js';
import { portrait, classIcon } from '../assets.js';
import { classBadge } from '../components.js';
import { openInspect } from '../inspect.js';
import { CLASSES, CLASS_IDS } from '/shared/data/classes.js';

const CATEGORIES = [
  ['level', 'Hero level'], ['power', 'Party power'], ['heroPower', 'Hero power'], ['kills', 'Enemies slain'],
  ['bossKills', 'Bosses slain'], ['coopWins', 'Co-op victories'], ['achievements', 'Achievements'], ['progress', 'World progress'],
];
const ui = { category: 'level', classId: '', search: '' };
let data = null;
let loading = false;
let refreshTimer = null;
let searchTimer = null;

async function load(root) {
  if (loading) return;
  loading = true;
  try { data = await act('get_rankings', { category: ui.category, classId: ui.classId || null, search: ui.search }); }
  catch (e) { toast(e.message, 'error'); }
  loading = false;
  renderTable(root);
}

function renderTable(root) {
  const host = root.querySelector('.rank-table-host');
  if (!host) return;
  if (!data) { host.innerHTML = '<p class="muted pad">Loading…</p>'; return; }
  const mine = data.mine;
  const label = CATEGORIES.find(c => c[0] === data.category)?.[1];
  host.innerHTML = `
    ${mine ? `<div class="my-rank">Your rank: <b>#${mine.rank}</b> of ${data.total} · ${esc(label)}: <b>${typeof mine.value === 'number' ? fmt(mine.value) : esc(mine.value)}</b></div>` : ''}
    <table class="rank-table">
      <thead><tr><th>#</th><th>Player</th><th>Hero</th><th class="hide-sm">Party</th><th class="num">${esc(label)}</th><th></th></tr></thead>
      <tbody>${data.rows.map(r => `<tr class="${r.id === state.player?.id ? 'me' : ''} ${r.rank <= 3 ? 'top top' + r.rank : ''}" data-inspect="${esc(r.name)}">
        <td class="rank-no">${r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}</td>
        <td><span class="conn-dot ${r.online ? 'on' : ''}" title="${r.online ? 'Online' : 'Offline'}"></span> <b>${esc(r.name)}</b>${r.inGroup ? ' <span class="tag" title="In a group">GROUP</span>' : ''}</td>
        <td><span class="row gap">${portrait(r.hero, 'xs')}<span>${esc(r.hero.name)} <span class="muted small">Lv ${r.hero.level} ${esc(CLASSES[r.hero.classId].name)}</span></span></span></td>
        <td class="hide-sm">${r.partyClasses.map(c => classIcon(c, 'xxs')).join(' ')}</td>
        <td class="num"><b>${typeof r.value === 'number' ? fmt(r.value) : esc(r.value)}</b></td>
        <td class="num"><button class="btn tiny ghost">Inspect</button></td>
      </tr>`).join('') || '<tr><td colspan="6" class="muted">No players found.</td></tr>'}</tbody>
    </table>`;
}

export const rankingsView = {
  id: 'rankings', label: 'Rankings', icon: '🏆',
  mount(root) {
    root.innerHTML = `
      <section class="panel">
        <div class="panel-head"><h3>Rankings</h3>
          <div class="row gap wrap">
            <select data-class><option value="">All classes</option>${CLASS_IDS.map(c => `<option value="${c}">${esc(CLASSES[c].name)}</option>`).join('')}</select>
            <input data-search placeholder="Find player or hero…" maxlength="30">
          </div></div>
        <div class="tabs rank-tabs">${CATEGORIES.map(([id, l]) => `<button class="tab ${ui.category === id ? 'active' : ''}" data-cat="${id}">${l}</button>`).join('')}</div>
        <div class="rank-table-host"></div>
        <p class="faint small">Click any player to inspect their hero, build, party and group. Rankings update every 30 seconds.</p>
      </section>`;
    root.querySelector('[data-class]').value = ui.classId;
    root.querySelector('[data-search]').value = ui.search;
    root.addEventListener('click', e => {
      const cat = e.target.closest('[data-cat]');
      if (cat) {
        ui.category = cat.dataset.cat;
        root.querySelectorAll('[data-cat]').forEach(b => b.classList.toggle('active', b === cat));
        load(root);
        return;
      }
      const row = e.target.closest('[data-inspect]');
      if (row) openInspect(row.dataset.inspect);
    });
    root.addEventListener('change', e => { if (e.target.matches('[data-class]')) { ui.classId = e.target.value; load(root); } });
    root.addEventListener('input', e => {
      if (!e.target.matches('[data-search]')) return;
      ui.search = e.target.value.trim();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => load(root), 300);
    });
    load(root);
    refreshTimer = setInterval(() => load(root), 30_000);
  },
  unmount() { clearInterval(refreshTimer); data = null; },
  render() { /* table refreshes itself; player state changes don't affect it */ },
};
