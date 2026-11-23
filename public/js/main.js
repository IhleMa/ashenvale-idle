// App entry: authentication, layout, routing and global message handling.
import { featureLock, FEATURE_LABELS } from '/shared/unlocks.js';
import { MATERIALS } from '/shared/data/town.js';
import { classLabel, subclassesOf } from '/shared/data/subclasses.js';
import { bus, state, hero } from './state.js';
import { connect, disconnect, apiPost, getToken, setToken, act } from './net.js';
import { loadAssets, portrait } from './assets.js';
import { esc, fmt, toast, modal, run, initTooltips, duration, bar, framed, heroNameHtml } from './ui.js';
import { xpToNext, CONFIG } from '/shared/config.js';
import { initPwa } from './pwa.js';
import { initTutorial, renderTutorial, isViewVisible, visibleKey } from './tutorial.js';
import { CLASSES } from '/shared/data/classes.js';
import { replaceContent, CONTENT } from '/shared/content.js';
import { parseGemKey, gemName } from '/shared/gems.js';
import { hasAbilityAction } from '/shared/character.js';
import { combatView } from './views/combat.js';
import { characterView } from './views/character.js';
import { abilitiesView } from './views/abilities.js';
import { skilltreeView } from './views/skilltree.js';
import { partyView } from './views/party.js';
import { recruitmentView } from './views/recruitment.js';
import { multiplayerView } from './views/multiplayer.js';
import { progressionView } from './views/progression.js';
import { wardrobeView } from './views/wardrobe.js';
import { rankingsView } from './views/rankings.js';
import { townView } from './views/town.js';
import { expeditionsView } from './views/expeditions.js';
import { auctionView } from './views/auction.js';
import { adminView } from './views/admin.js';
import { questsView, questsReady } from './views/quests.js';
import { riftsView } from './views/rifts.js';
import { pinnacleView } from './views/pinnacle.js';
import { bestiaryView } from './views/bestiary.js';
import { wikiView } from './views/wiki.js';
import { arenaView } from './views/arena.js';
import { gemsView } from './views/gems.js';
import { createView } from './views/create.js';

const VIEWS = [combatView, riftsView, pinnacleView, questsView, characterView, skilltreeView, abilitiesView, partyView, recruitmentView, townView, expeditionsView, gemsView, auctionView, multiplayerView, arenaView, rankingsView, bestiaryView, wikiView, progressionView, wardrobeView, adminView];
const viewEl = () => document.getElementById('view');
let current = null;
let root = null; // per-view container (listeners attached to it die with it)

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

// pages appear one by one during the tutorial; freshly unlocked ones get a NEW mark until visited
const newViews = new Set();
let navKey = null;
let navReady = false;
// pages locked by hero level (the Auction House page stays open: its mailbox always works, only trading is locked)
const pageLock = id => (id === 'auction' ? 0 : featureLock(state.player, id));
// menu state: visible pages (tutorial) + pages still locked by hero level (config.featureUnlocks)
function navStateKey() {
  return `${visibleKey()}|${VIEWS.filter(v => pageLock(v.id)).map(v => v.id).join(',')}`;
}
// placeholder page for a feature that isn't unlocked yet
const lockedViews = new Map();
function lockedView(v) {
  if (!lockedViews.has(v.id)) lockedViews.set(v.id, {
    id: v.id, label: v.label, icon: v.icon,
    render(root) {
      const need = pageLock(v.id);
      const h = hero();
      root.innerHTML = `<section class="panel locked-feature"><div class="lock-big">🔒</div><h2>${v.icon} ${esc(v.label)}</h2>
        <p>${esc(FEATURE_LABELS[v.id] || v.label)} unlocks at <b>hero level ${need}</b>. ${h ? `${esc(h.name)} is level ${h.level} — ${need - h.level} level${need - h.level === 1 ? '' : 's'} to go.` : ''}</p>
        ${h ? bar(h.level, need, 'xp', `Level ${h.level} / ${need}`) : ''}</section>`;
    },
  });
  return lockedViews.get(v.id);
}

function renderNav() {
  const nav = document.getElementById('sidebar');
  const key = navStateKey();
  const ready = !!state.player?.characters?.[state.player?.heroId];
  if (navKey && navReady && key !== navKey) {
    const [vis, locks] = navKey.split('|');
    const before = new Set(vis === '*' ? VIEWS.map(v => v.id) : vis.split(','));
    const lockedBefore = new Set((locks || '').split(',').filter(Boolean));
    for (const v of VIEWS) {
      if (!isViewVisible(v.id) || pageLock(v.id)) continue;
      if (!before.has(v.id) || lockedBefore.has(v.id)) {
        newViews.add(v.id);
        if (lockedBefore.has(v.id)) toast(`🔓 New feature unlocked: ${v.label}!`, 'success', 8000);
      }
    }
  }
  navKey = key;
  navReady = ready; // "new"/unlock messages only compare two states that both had the player's data
  nav.innerHTML = VIEWS.filter(v => (!v.adminOnly || state.isAdmin) && isViewVisible(v.id)).map(v => {
    const lock = pageLock(v.id);
    return `<a href="#/${v.id}" data-view="${v.id}" class="${newViews.has(v.id) ? 'nav-new' : ''} ${current?.id === v.id ? 'active' : ''} ${lock ? 'nav-locked' : ''}" ${lock ? `title="Unlocks at hero level ${lock}"` : ''}><span class="nav-icon">${v.icon}</span><span class="nav-label">${v.label}</span>${lock ? `<span class="nav-lock">🔒 ${lock}</span>` : `<span class="nav-badge" data-badge="${v.id}"></span>`}</a>`;
  }).join('');
}

function route() {
  if (!state.player) return;
  if (!state.player.heroId) { mount(createView); return; }
  let id = (location.hash.match(/^#\/(\w+)/) || [])[1] || 'combat';
  if (id === 'inventory') id = 'character'; // the inventory is part of the Character page
  let v = VIEWS.find(x => x.id === id && (!x.adminOnly || state.isAdmin) && isViewVisible(x.id)) || combatView;
  if (pageLock(v.id)) v = lockedView(v);
  if (newViews.delete(v.id)) document.querySelector(`#sidebar a[data-view="${v.id}"]`)?.classList.remove('nav-new');
  mount(v);
  renderTutorial();
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

// Re-render the active view when state changes. Views update by morphing (see morph.js): only what changed is touched, so typing, open dropdowns, scroll
// positions and hover state survive any update — there is nothing to wait for.
function requestRender() {
  if (!current) return;
  if (current.render && root) current.render(root);
}
export { requestRender };

function renderTopbar() {
  const p = state.player;
  if (!p) return;
  // short form in the bar ("1.2M"), the exact amount in the tooltip
  const exact = n => Math.floor(n || 0).toLocaleString('en-US');
  const g = document.getElementById('topbar-gold'), c = document.getElementById('topbar-premium');
  g.textContent = fmt(p.gold);
  g.dataset.tip = `<b>${exact(p.gold)}</b> gold`;
  c.textContent = fmt(p.premium || 0);
  c.dataset.tip = `<b>${exact(p.premium)}</b> Ashen Crystals<br><span class="muted small">Finish constructions and expeditions instantly</span>`;
  const h = hero();
  const el = document.getElementById('topbar-hero');
  if (!h) { el.innerHTML = ''; return; }
  const cls = CLASSES[h.classId];
  el.innerHTML = `${framed(portrait(h, 'xs'), state.player.name)}<div><div class="name">${heroNameHtml(h.name, state.player.name)} <span class="muted">Lv ${h.level} ${esc(classLabel(h.classId, h.subclass))}${h.ascensions ? ' 🌟' : ''}</span></div>${bar(h.xp, xpToNext(h.level), 'xp thin', '')}</div>`;
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
  const qr = questsReady(p);
  setBadge('quests', qr ? String(qr) : '');
  // ascension available: badge on Character + a one-time toast when the hero hits the cap
  const canAsc = !!(CONFIG.ascension?.enabled && h.level >= CONFIG.levelCap && subclassesOf(h.classId).length > (h.subclass ? 1 : 0));
  setBadge('character', canAsc ? '🌟' : '');
  const ascKey = `asc-notice:${h.id}:${h.ascensions || 0}`;
  if (canAsc && lastHeroLevel !== null && lastHeroLevel < CONFIG.levelCap) {
    try { if (!localStorage.getItem(ascKey)) { localStorage.setItem(ascKey, '1'); toast(`🌟 ${h.name} reached level ${CONFIG.levelCap} and can now ascend! Open the Character page.`, 'success', 9000); } } catch {}
  }
  lastHeroLevel = h.level;
}
let lastHeroLevel = null;
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
// an admin changed game content: fetch it and redraw — no page reload
bus.on('msg:content_update', async m => {
  try {
    const res = await fetch('/api/content', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    replaceContent(await res.json());
    buildId = m.buildId || buildId;
    bus.emit('content:updated', m);
    renderTopbar();
    requestRender();
  } catch { reloadSoon('The game content was updated — refreshing…'); }
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
// ---- 💡 suggestions: players send ideas / bug reports; admins read and answer them in the admin panel
const SUGG_STATUS = { new: ['Sent', ''], read: ['Read', 'tag'], planned: ['Planned', 'tag hero'], done: ['Done ✓', 'tag hero'], declined: ['Declined', 'tag'] };
async function showSuggestions() {
  const m = modal(`<h2>💡 Suggestions</h2>
    <p class="muted small">Ideas, balance feedback or bugs — the admins read every suggestion.</p>
    <form class="suggest-form">
      <select name="category">${[['feature', 'Feature idea'], ['balance', 'Balance'], ['bug', 'Bug report'], ['ui', 'Interface'], ['other', 'Other']].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <textarea name="text" rows="6" maxlength="1500" placeholder="What would you like to see? The more detail, the better." required></textarea>
      <div class="row between"><span class="muted small" data-count>0 / 1500</span><button class="btn primary" type="submit">Send suggestion</button></div>
    </form>
    <h3 class="small" style="margin-top:14px">Your suggestions</h3><div class="suggest-mine muted small">Loading…</div>`, { wide: true });
  const loadMine = async () => {
    const host = m.el.querySelector('.suggest-mine');
    try {
      const r = await act('my_suggestions');
      host.classList.toggle('muted', !r.list.length);
      host.innerHTML = r.list.length ? r.list.map(s => `<div class="ann suggest-item"><div class="ann-meta"><span class="${SUGG_STATUS[s.status]?.[1] || ''}">${SUGG_STATUS[s.status]?.[0] || esc(s.status)}</span> <span class="muted">${esc(r.categories[s.category] || s.category)} · ${new Date(s.at).toLocaleString()}</span></div>
        <div class="ann-text">${esc(s.text)}</div>${s.reply ? `<div class="suggest-reply"><b>Admin:</b> ${esc(s.reply)}</div>` : ''}</div>`).join('') : 'Nothing sent yet.';
    } catch (e) { host.textContent = e.message; }
  };
  const form = m.el.querySelector('.suggest-form'), ta = form.elements.text;
  ta.addEventListener('input', () => { m.el.querySelector('[data-count]').textContent = `${ta.value.length} / 1500`; });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (await run(act('suggest', { category: form.elements.category.value, text: ta.value }), 'Thank you! Your suggestion was sent.') !== undefined) { ta.value = ''; ta.dispatchEvent(new Event('input')); loadMine(); }
  });
  loadMine();
  setTimeout(() => ta.focus(), 50);
}
document.getElementById('topbar-suggest').addEventListener('click', showSuggestions);

// ---- patch notes (content/patchnotes.json, newest first); "seen" is remembered per browser
const NOTES_KEY = 'ashenvale.patchnotesSeen';
const patchEntries = () => CONTENT.patchnotes?.entries || [];
const notesSeen = () => { try { return localStorage.getItem(NOTES_KEY); } catch { return null; } };
function updateNotesBadge() {
  const newest = patchEntries()[0]?.id;
  const isNew = !!newest && notesSeen() !== newest;
  document.getElementById('topbar-notes-badge').hidden = !isNew;
  document.getElementById('topbar-notes').classList.toggle('has-new', isNew);
}
function showPatchNotes() {
  const list = patchEntries(), seen = notesSeen();
  const seenIdx = list.findIndex(e => e.id === seen);
  const fmtDate = d => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const body = list.length ? list.map((e, i) => `<div class="ann patch ${seenIdx === -1 ? (seen ? 'new' : '') : i < seenIdx ? 'new' : ''}">
      <div class="ann-meta">${(seenIdx === -1 ? !!seen : i < seenIdx) ? '<span class="tag">NEW</span> ' : ''}<span class="muted">${esc(fmtDate(e.date))}</span></div>
      ${e.title ? `<h3 class="patch-title">${esc(e.title)}</h3>` : ''}
      ${(e.sections || []).map(s => `${s.heading ? `<h4>${esc(s.heading)}</h4>` : ''}<ul>${(s.items || []).map(t => `<li>${esc(t)}</li>`).join('')}</ul>`).join('')}
    </div>`).join('') : '<p class="muted">No patch notes yet.</p>';
  modal(`<h2>📜 Patch notes</h2><div class="ann-list">${body}</div><div class="row end"><button class="btn primary" data-close>Close</button></div>`, {
    onClose: () => { if (list[0]) { try { localStorage.setItem(NOTES_KEY, list[0].id); } catch {} } updateNotesBadge(); },
  });
}
document.getElementById('topbar-notes').addEventListener('click', showPatchNotes);
bus.on('content:updated', updateNotesBadge);
updateNotesBadge();
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
  if (navStateKey() !== navKey) { renderNav(); route(); }
  renderTopbar();
  if (first || hadHero !== !!m.player.heroId) route(); else requestRender();
  renderTutorial();
});
bus.on('msg:toast', m => toast(m.text, m.kind));
bus.on('msg:cosmetics', m => { state.cosmetics = m.map || {}; requestRender(); });
bus.on('msg:cosmetic', m => { if (m.cosmetics) state.cosmetics[m.name] = m.cosmetics; else delete state.cosmetics[m.name]; requestRender(); renderTopbar(); });
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
    ${Object.keys(s.materials || {}).length ? `<h3>Zone materials</h3><p>${Object.entries(s.materials).map(([k, v]) => `<span class="cost">${esc(MATERIALS[k]?.glyph || '')} ${fmt(v)} ${esc(MATERIALS[k]?.name || k)}</span>`).join(' ')}</p>` : ''}
    ${Object.keys(s.gems || {}).length ? `<h3>Gems found</h3><p>${Object.entries(s.gems).map(([k, v]) => { const g = parseGemKey(k); return g ? `<span class="cost">💎 ${v > 1 ? v + '× ' : ''}${esc(gemName(g.kind, g.tier))}</span>` : ''; }).join(' ')}</p>` : ''}
    ${lv ? `<h3>Level ups</h3><ul>${lv}</ul>` : ''}
    ${found ? `<h3>Notable loot</h3><ul>${found}</ul>` : ''}
    ${s.achievements.length ? `<h3>Achievements</h3><ul>${s.achievements.map(a => `<li>★ ${esc(a)}</li>`).join('')}</ul>` : ''}
    <div class="row end"><button class="btn primary" data-close>Continue</button></div>`);
}

window.addEventListener('hashchange', route);

// ------------------------------------------------------------------ boot
initTooltips();
initPwa();
initTutorial({ currentView: () => current?.id || null, viewLabel: id => VIEWS.find(v => v.id === id)?.label || id });
loadAssets().then(() => {
  // views that were rendered before artwork loaded get refreshed
  if (current) requestRender();
});
if (getToken()) startGame(); else showAuth();
