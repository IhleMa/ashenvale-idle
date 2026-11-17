// App entry: authentication, layout, routing and global message handling.
import { bus, state, hero } from './state.js';
import { connect, disconnect, apiPost, getToken, setToken, act } from './net.js';
import { loadAssets, portrait } from './assets.js';
import { esc, fmt, toast, modal, initTooltips, duration, bar } from './ui.js';
import { xpToNext } from '/shared/config.js';
import { CLASSES } from '/shared/data/classes.js';
import { hasAbilityAction } from '/shared/character.js';
import { combatView } from './views/combat.js';
import { characterView } from './views/character.js';
import { abilitiesView } from './views/abilities.js';
import { skilltreeView } from './views/skilltree.js';
import { partyView } from './views/party.js';
import { recruitmentView } from './views/recruitment.js';
import { inventoryView } from './views/inventory.js';
import { multiplayerView } from './views/multiplayer.js';
import { progressionView } from './views/progression.js';
import { rankingsView } from './views/rankings.js';
import { townView } from './views/town.js';
import { expeditionsView } from './views/expeditions.js';
import { auctionView } from './views/auction.js';
import { adminView } from './views/admin.js';
import { createView } from './views/create.js';

const VIEWS = [combatView, characterView, skilltreeView, abilitiesView, partyView, recruitmentView, townView, expeditionsView, inventoryView, auctionView, multiplayerView, rankingsView, progressionView, adminView];
const viewEl = () => document.getElementById('view');
let current = null;
let root = null; // per-view container (listeners attached to it die with it)
let pendingRender = false;

// ------------------------------------------------------------------ auth screen
let authMode = 'login';
function showAuth() {
  document.getElementById('game').hidden = true;
  document.getElementById('auth').hidden = false;
}
document.querySelectorAll('[data-auth-tab]').forEach(btn => btn.addEventListener('click', () => {
  authMode = btn.dataset.authTab;
  document.querySelectorAll('[data-auth-tab]').forEach(b => b.classList.toggle('active', b === btn));
  document.getElementById('auth-submit').textContent = authMode === 'login' ? 'Log in' : 'Create account';
  document.querySelector('#auth-form [name=password]').autocomplete = authMode === 'login' ? 'current-password' : 'new-password';
}));
document.getElementById('auth-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  const err = document.getElementById('auth-error');
  err.textContent = '';
  try {
    const r = await apiPost(authMode === 'login' ? '/api/login' : '/api/register', { username: f.get('username'), password: f.get('password') });
    setToken(r.token);
    startGame();
  } catch (ex) { err.textContent = ex.message; }
});

export async function logout() {
  const token = getToken();
  disconnect();
  setToken(null);
  try { await apiPost('/api/logout', { token }); } catch { /* ignore */ }
  location.hash = '';
  location.reload();
}

// ------------------------------------------------------------------ game shell
function startGame() {
  document.getElementById('auth').hidden = true;
  document.getElementById('game').hidden = false;
  renderNav();
  connect();
}

function renderNav() {
  const nav = document.getElementById('sidebar');
  nav.innerHTML = VIEWS.filter(v => !v.adminOnly || state.isAdmin).map(v => `<a href="#/${v.id}" data-view="${v.id}"><span class="nav-icon">${v.icon}</span><span class="nav-label">${v.label}</span><span class="nav-badge" data-badge="${v.id}"></span></a>`).join('');
}

function route() {
  if (!state.player) return;
  if (!state.player.heroId) { mount(createView); return; }
  const id = (location.hash.match(/^#\/(\w+)/) || [])[1] || 'combat';
  const v = VIEWS.find(x => x.id === id && (!x.adminOnly || state.isAdmin)) || combatView;
  mount(v);
}

function mount(v) {
  if (current && current !== v) current.unmount?.();
  const changed = current !== v;
  current = v;
  document.querySelectorAll('#sidebar a').forEach(a => a.classList.toggle('active', a.dataset.view === v.id));
  document.getElementById('sidebar').classList.remove('open');
  document.body.dataset.view = v.id;
  if (changed) {
    viewEl().innerHTML = '';
    viewEl().scrollTop = 0;
    root = document.createElement('div');
    root.className = `view-root view-${v.id}`;
    viewEl().appendChild(root);
    v.mount?.(root);
  }
  v.render(root);
}

// Re-render the active view when state changes, but never while the player is typing in it
function requestRender() {
  if (!current) return;
  const a = document.activeElement;
  if (a && root?.contains(a) && /INPUT|TEXTAREA/.test(a.tagName) && !['button', 'checkbox', 'range'].includes(a.type)) {
    pendingRender = true;
    return;
  }
  pendingRender = false;
  if (current.render && root) current.render(root);
}
document.addEventListener('focusout', () => setTimeout(() => { if (pendingRender) requestRender(); }, 50));
export { requestRender };

function renderTopbar() {
  const p = state.player;
  if (!p) return;
  document.getElementById('topbar-gold').textContent = fmt(p.gold);
  document.getElementById('topbar-premium').textContent = fmt(p.premium || 0);
  const h = hero();
  const el = document.getElementById('topbar-hero');
  if (!h) { el.innerHTML = ''; return; }
  const cls = CLASSES[h.classId];
  el.innerHTML = `${portrait(h, 'xs')}<div><div class="name">${esc(h.name)} <span class="muted">Lv ${h.level} ${esc(cls.name)}</span></div>${bar(h.xp, xpToNext(h.level), 'xp thin', '')}</div>`;
  // badges for unspent points
  const treePts = Object.values(p.characters).filter(hasAbilityAction).length;
  setBadge('skilltree', treePts ? '!' : '');
  setBadge('multiplayer', state.invites.length ? String(state.invites.length) : '');
  setBadge('recruitment', p.stats.recruited === 0 ? '!' : '');
  const t = Date.now() + (state.timeOffset || 0);
  const townReady = p.town && Object.values(p.town.buildings).some(b => b.upgrade && b.upgrade.endsAt <= t);
  setBadge('town', townReady ? '✓' : '');
  const expReady = (p.expeditions || []).filter(x => x.endsAt <= t).length;
  setBadge('expeditions', expReady ? String(expReady) : '');
  setBadge('auction', (p.mailbox || []).length ? String(p.mailbox.length) : '');
}
function setBadge(id, text) {
  const b = document.querySelector(`[data-badge="${id}"]`);
  if (b) { b.textContent = text; b.hidden = !text; }
}

document.getElementById('menu-toggle').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));

// ------------------------------------------------------------------ server messages
// ------------------------------------------------------------------ connection banner & live updates
let buildId = null;
let wasOnline = false;
function banner(html, kind = 'info') {
  const el = document.getElementById('status-banner');
  if (!html) { el.hidden = true; return; }
  el.className = `status-banner ${kind}`;
  el.innerHTML = html;
  el.hidden = false;
}
function reloadSoon(reason) {
  banner(`${reason} <button class="btn tiny" onclick="location.reload()">Refresh now</button>`, 'good');
  const tryReload = () => {
    const a = document.activeElement;
    // don't throw away something the player is typing — wait until they're done
    if (a && /INPUT|TEXTAREA/.test(a.tagName) && a.value) return setTimeout(tryReload, 2000);
    location.reload();
  };
  setTimeout(tryReload, 1500);
}
let motdShown = false;
bus.on('msg:welcome', m => {
  if (m.premium) state.premiumRate = m.premium.minutesPerCrystal;
  if (m.auction) { state.ahFee = m.auction.feePct; state.ahTax = m.auction.taxPct; }
  if (!!m.isAdmin !== !!state.isAdmin) { state.isAdmin = !!m.isAdmin; renderNav(); route(); }
  if (m.motd && !motdShown) { motdShown = true; modal(`<h2>📜 Message of the day</h2><p class="motd">${esc(m.motd)}</p><div class="row end"><button class="btn primary" data-close>OK</button></div>`); }
  if (buildId && m.buildId && m.buildId !== buildId) return reloadSoon('The game was updated — refreshing…');
  buildId = m.buildId;
});
bus.on('msg:client_update', m => {
  if (m.force || (m.buildId && m.buildId !== buildId)) reloadSoon('A new version of the game is available — refreshing…');
});
// ---- persistent announcements: delivered on connect (incl. ones posted while offline) and live
function annHtml(a, isNew) {
  const when = new Date(a.at).toLocaleString();
  return `<div class="ann ${isNew ? 'new' : ''}"><div class="ann-meta">${isNew ? '<span class="tag">NEW</span> ' : ''}<b>${esc(a.from || 'Server')}</b> · <span class="muted">${esc(when)}</span></div><div class="ann-text">${esc(a.text)}</div></div>`;
}
let annModal = null;
function updateAnnBadge() {
  const b = document.getElementById('topbar-ann-badge');
  const n = state.unseenAnn.size;
  b.textContent = n; b.hidden = !n;
  document.getElementById('topbar-ann').classList.toggle('has-new', n > 0);
}
function ackAnnouncements() {
  if (!state.unseenAnn.size) return;
  const upTo = Math.max(...state.announcements.map(a => a.at));
  state.unseenAnn.clear();
  updateAnnBadge();
  act('ack_announcements', { upTo }).catch(() => {});
}
function showAnnouncements(onlyUnseen) {
  annModal?.close();
  const list = onlyUnseen ? state.announcements.filter(a => state.unseenAnn.has(a.id)) : state.announcements;
  const body = list.length ? list.map(a => annHtml(a, state.unseenAnn.has(a.id))).join('') : '<p class="muted">No current announcements.</p>';
  annModal = modal(`<h2>📢 ${onlyUnseen ? 'New announcement' + (list.length > 1 ? 's' : '') : 'Server announcements'}</h2><div class="ann-list">${body}</div>
    <div class="row end">${onlyUnseen && state.announcements.length > list.length ? '<button class="btn ghost" data-ann-all>Show all</button>' : ''}<button class="btn primary" data-close>Got it</button></div>`,
    { onClose: () => { annModal = null; ackAnnouncements(); } });
  annModal.el.querySelector('[data-ann-all]')?.addEventListener('click', () => showAnnouncements(false));
}
document.getElementById('topbar-ann').addEventListener('click', () => showAnnouncements(false));
bus.on('msg:announcements', m => {
  state.announcements = m.list || [];
  state.unseenAnn = new Set(m.unseen || []);
  updateAnnBadge();
  if (state.unseenAnn.size) setTimeout(() => showAnnouncements(true), 300);
});
bus.on('msg:announcement', m => {
  const a = m.announcement;
  if (!a) return;
  state.announcements = [a, ...state.announcements.filter(x => x.id !== a.id)];
  state.unseenAnn.add(a.id);
  updateAnnBadge();
  showAnnouncements(true);
  if (current?.id === 'admin') requestRender();
});
bus.on('msg:announcement_removed', m => {
  state.announcements = state.announcements.filter(a => a.id !== m.id);
  state.unseenAnn.delete(m.id);
  updateAnnBadge();
  if (current?.id === 'admin') requestRender();
});
bus.on('kicked', reason => banner(`${esc(reason || 'You were disconnected.')} <button class="btn tiny" onclick="location.reload()">Reconnect</button>`, 'warn'));
bus.on('msg:server_restart', () => banner('⟳ The server is restarting for an update. You will reconnect automatically — your progress is saved.', 'warn'));

bus.on('connection', s => {
  state.connection = s;
  if (s === 'online') { if (wasOnline || !document.getElementById('status-banner').hidden) banner(null); wasOnline = true; }
  else if (s === 'restarting') banner('⟳ The server is restarting for an update. Reconnecting automatically…', 'warn');
  else if (s === 'offline' && wasOnline) banner('Connection lost — reconnecting…', 'warn');
  const el = document.getElementById('conn-status');
  el.className = `conn ${s}`;
  el.title = s === 'online' ? 'Connected' : s === 'connecting' ? 'Connecting…' : 'Disconnected — reconnecting';
});
bus.on('logout', () => { state.player = null; showAuth(); });
bus.on('msg:state', m => {
  const first = !state.player;
  const hadHero = !!state.player?.heroId;
  state.player = m.player;
  if (m.player.serverTime) state.timeOffset = m.player.serverTime - Date.now();
  renderTopbar();
  if (first || hadHero !== !!m.player.heroId) route(); else requestRender();
});
bus.on('msg:toast', m => toast(m.text, m.kind));
bus.on('msg:group', m => { state.group = m.group; if (current?.id === 'multiplayer') requestRender(); renderTopbar(); });
bus.on('msg:invites', m => { state.invites = m.invites; renderTopbar(); if (current?.id === 'multiplayer') requestRender(); });
bus.on('msg:online', m => { state.online = m.players; if (current?.id === 'multiplayer') requestRender(); });
bus.on('msg:offline', m => showOfflineSummary(m.summary));
bus.on('activity', html => { document.getElementById('topbar-activity').innerHTML = html; });

function showOfflineSummary(s) {
  const lv = s.levels.map(l => `<li>${esc(l.name)}: level ${l.from} → <b>${l.to}</b></li>`).join('');
  const found = s.found.map(i => `<li class="rarity-text rarity-${i.rarity}">${esc(i.name)}</li>`).join('');
  modal(`<h2>Welcome back!</h2>
    <p class="muted">While you were away for <b>${duration(s.seconds)}</b>, your party kept fighting in <b>${esc(s.zone)}</b>.</p>
    <div class="summary-grid">
      <div><span class="big-num">${fmt(s.wins)}</span><span>victories</span></div>
      <div><span class="big-num">${fmt(s.kills)}</span><span>enemies slain</span></div>
      <div><span class="big-num xp-text">${fmt(s.xp)}</span><span>experience</span></div>
      <div><span class="big-num gold-text">${fmt(s.gold)}</span><span>gold</span></div>
      <div><span class="big-num">${fmt(s.itemsKept)}</span><span>items kept${s.itemsSold ? ` (${fmt(s.itemsSold)} sold)` : ''}</span></div>
    </div>
    ${lv ? `<h3>Level ups</h3><ul>${lv}</ul>` : ''}
    ${found ? `<h3>Notable loot</h3><ul>${found}</ul>` : ''}
    ${s.achievements.length ? `<h3>Achievements</h3><ul>${s.achievements.map(a => `<li>★ ${esc(a)}</li>`).join('')}</ul>` : ''}
    <div class="row end"><button class="btn primary" data-close>Continue</button></div>`);
}

window.addEventListener('hashchange', route);

// ------------------------------------------------------------------ boot
initTooltips();
loadAssets().then(() => {
  // views that were rendered before artwork loaded get refreshed
  if (current) requestRender();
});
if (getToken()) startGame(); else showAuth();
