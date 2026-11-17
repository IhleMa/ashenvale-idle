// Admin panel (only visible to admins; every action is re-checked on the server).
import { state } from '../state.js';
import { act } from '../net.js';
import { esc, fmt, run, toast, modal, duration, confirmBox, itemTooltipHtml, tipAttr } from '../ui.js';
import { classIcon, itemIcon, materialIcon } from '../assets.js';
import { CLASSES } from '/shared/data/classes.js';
import { MATERIALS, MATERIAL_IDS } from '/shared/data/town.js';
import { ITEM_BASES } from '/shared/data/items.js';
import { UNIQUES, SETS } from '/shared/data/legendaries.js';
import { CONFIG } from '/shared/config.js';

const ui = { tab: 'dashboard', query: '', sort: 'online' };
let overview = null;
let players = null;
let timer = null;
let searchTimer = null;

const ago = ts => (ts ? `${duration((Date.now() - ts) / 1000)} ago` : '—');

async function loadOverview(root) { try { overview = await act('admin_overview'); } catch (e) { toast(e.message, 'error'); } render(root); }
async function loadPlayers(root) { try { players = await act('admin_players', { query: ui.query, sort: ui.sort }); } catch (e) { toast(e.message, 'error'); } render(root); }

function dashboardHtml() {
  if (!overview) return '<p class="muted">Loading…</p>';
  const o = overview;
  return `<div class="admin-cards">
      ${[['Online now', o.online], ['Accounts', o.accounts], ['Uptime', duration(o.uptime)], ['Memory', o.memoryMb + ' MB'], ['Groups', `${o.groups} (${o.coopBattles} fighting)`], ['Auctions', `${o.auction.listings} listed · ${o.auction.sales24h} sold/24h`], ['Build', o.buildId], ['Node', o.node]]
        .map(([l, v]) => `<div class="admin-card"><small>${l}</small><b>${esc(String(v))}</b></div>`).join('')}
    </div>
    <div class="admin-grid">
      <section class="panel">
        <h3>Announcement</h3>
        <p class="muted small">Shows a banner and notification to everyone online right now.</p>
        <textarea data-broadcast rows="3" maxlength="300" placeholder="e.g. Server restart in 5 minutes!"></textarea>
        <div class="row end"><button class="btn primary small" data-send-broadcast>Send to all players</button></div>
        <h3>Online</h3><p class="small">${o.onlineNames.map(esc).join(', ') || '<span class="muted">nobody</span>'}</p>
        <h3>Admins</h3><p class="small">${o.admins.map(esc).join(', ')}</p>
        <p class="faint small">Add admins with the console command <code>admin add &lt;username&gt;</code> or the ADMIN_USERS server variable.</p>
      </section>
      <section class="panel">
        <h3>Server settings</h3>
        <form class="admin-settings">${Object.entries(o.settingDefs).map(([k, d]) => {
          const v = o.settings[k];
          if (d.type === 'boolean') return `<label class="switch"><input type="checkbox" name="${k}" ${v ? 'checked' : ''}><span></span> ${esc(d.label)}</label>`;
          if (d.type === 'text') return `<label>${esc(d.label)}<textarea name="${k}" rows="2" maxlength="500">${esc(v)}</textarea></label>`;
          return `<label class="inline-set">${esc(d.label)}<input type="number" name="${k}" min="${d.min}" max="${d.max}" step="${d.step}" value="${v}"></label>`;
        }).join('')}
        <div class="row end"><button class="btn primary small" type="submit">Save settings</button></div></form>
        <p class="faint small">Rates apply to new fights immediately. 1 = normal.</p>
      </section>
      <section class="panel admin-log">
        <h3>Admin log</h3>
        ${o.log.map(l => `<div class="small"><span class="muted">${new Date(l.at).toLocaleString()}</span> <b>${esc(l.admin)}</b> ${esc(l.action)} <b>${esc(l.target)}</b> <span class="muted">${esc(l.details || '')}</span></div>`).join('') || '<p class="muted small">No admin actions yet.</p>'}
      </section>
    </div>`;
}

function playersHtml() {
  return `<div class="row gap wrap">
      <input data-player-search placeholder="Search username or hero…" value="${esc(ui.query)}">
      <select data-player-sort>${[['online', 'Online / recent'], ['level', 'Hero level'], ['gold', 'Gold'], ['newest', 'Newest'], ['name', 'Name']].map(([v, l]) => `<option value="${v}" ${ui.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <span class="muted small">${players ? `${players.total} accounts` : ''}</span>
    </div>
    <table class="rank-table admin-players"><thead><tr><th>Player</th><th>Hero</th><th class="num">Gold</th><th>Last seen</th><th>Created</th><th>Status</th><th></th></tr></thead>
    <tbody>${(players?.rows || []).map(r => `<tr data-player="${r.id}">
      <td><span class="conn-dot ${r.online ? 'on' : ''}"></span> <b>${esc(r.username)}</b>${r.admin ? ' <span class="tag hero">ADMIN</span>' : ''}</td>
      <td>${r.hero ? `${classIcon(r.hero.classId, 'xxs')} ${esc(r.hero.name)} <span class="muted small">Lv ${r.hero.level}</span>` : '<span class="muted">no hero</span>'}</td>
      <td class="num">${fmt(r.gold)}</td><td class="muted small">${r.online ? 'online' : ago(r.lastActive)}</td><td class="muted small">${new Date(r.createdAt).toLocaleDateString()}</td>
      <td>${r.banned ? `<span class="tag boss" ${tipAttr(esc(r.banned.reason))}>BANNED</span>` : ''}</td>
      <td class="num"><button class="btn tiny">Manage</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">No players.</td></tr>'}</tbody></table>`;
}

function render(root) {
  const host = root.querySelector('.admin-body');
  if (!host) return;
  if (host.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  host.innerHTML = ui.tab === 'dashboard' ? dashboardHtml() : playersHtml();
}

async function openPlayer(id, root) {
  let d;
  try { d = await act('admin_player', { id }); } catch (e) { return toast(e.message, 'error'); }
  const pl = d.player;
  const m = modal(`<h2>${esc(d.username)} ${d.online ? '<span class="tag live">ONLINE</span>' : ''} ${d.banned ? '<span class="tag boss">BANNED</span>' : ''}</h2>
    <div class="muted small">Account created ${new Date(d.createdAt).toLocaleString()} · last seen ${d.online ? 'now' : ago(d.lastActive)}${d.banned ? ` · banned: ${esc(d.banned.reason)}${d.banned.until ? ` (until ${new Date(d.banned.until).toLocaleString()})` : ' (permanent)'}` : ''}</div>
    ${pl ? `<div class="admin-cards small-cards">
      ${[['Gold', fmt(pl.gold)], ['Kills', fmt(pl.stats.kills || 0)], ['Characters', pl.characters.length], ['Inventory', `${pl.inventory.length}/${CONFIG.inventory.limit}`], ['Mailbox', pl.mailbox], ['Auctions', pl.auctions], ['Expeditions', pl.expeditions], ['Zone', pl.zone]].map(([l, v]) => `<div class="admin-card"><small>${l}</small><b>${esc(String(v))}</b></div>`).join('')}
    </div>
    <h4>Characters</h4><div class="small">${pl.characters.map(c => `${classIcon(c.classId, 'xxs')} ${c.isMain ? '★ ' : ''}${esc(c.name)} Lv ${c.level}${c.profession ? ` <span class="muted">(${esc(c.profession.id)} ${c.profession.level})</span>` : ''}`).join(' · ')}</div>
    <h4>Materials</h4><div class="row gap wrap small">${Object.entries(pl.materials).filter(([, v]) => v >= 1).map(([k, v]) => `<span class="cost">${materialIcon(k, 'xxs')} ${fmt(Math.floor(v))}</span>`).join('') || '<span class="muted">none</span>'}</div>
    <h4>Inventory</h4><div class="row gap wrap">${pl.inventory.slice(0, 60).map(i => `<span ${tipAttr(itemTooltipHtml(i))}>${itemIcon(i, 'xs')}</span>`).join('') || '<span class="muted small">empty</span>'}</div>` : '<p class="muted">No game data yet.</p>'}

    <h3>Give</h3>
    <div class="admin-give">
      <label class="inline">Gold <input type="number" data-g-gold min="0" value="0"></label>
      <label class="inline">Material <select data-g-mat><option value="">—</option>${MATERIAL_IDS.map(k => `<option value="${k}">${esc(MATERIALS[k].name)}</option>`).join('')}</select> <input type="number" data-g-matqty min="0" value="0"></label>
      <label class="inline">Item <select data-g-type><option value="">—</option><option value="random">Random item</option><option value="unique">Unique</option><option value="set">Set piece</option></select></label>
      <select data-g-unique><option value="">random unique</option>${Object.values(UNIQUES).map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select>
      <select data-g-set><option value="">random set</option>${Object.values(SETS).map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
      <select data-g-base><option value="">random base</option>${Object.values(ITEM_BASES).map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select>
      <select data-g-rarity><option value="">random rarity</option>${CONFIG.rarities.map(r => `<option value="${r.id}">${esc(r.label)}</option>`).join('')}</select>
      <label class="inline">Level <input type="number" data-g-level min="1" max="60" value="${d.hero?.level || 1}"></label>
      <input data-g-note placeholder="Note (optional)" maxlength="200">
      <button class="btn primary small" data-give>Send gift by mail</button>
    </div>

    <h3>Moderation</h3>
    <div class="row gap wrap">
      ${d.online ? '<button class="btn small" data-kick>Kick</button>' : ''}
      ${d.banned ? '<button class="btn small" data-unban>Unban</button>' : `<input data-ban-reason placeholder="Ban reason" maxlength="200"><select data-ban-hours><option value="24">24 hours</option><option value="168">7 days</option><option value="720">30 days</option><option value="0">Permanent</option></select><button class="btn small danger" data-ban>Ban</button>`}
      <button class="btn small" data-reset-pw>Reset password</button>
      <button class="btn small ghost danger" data-delete>Delete account…</button>
    </div>`, { wide: true });
  m.el.addEventListener('click', async e => {
    const t = e.target.closest('button');
    if (!t) return;
    const q = sel => m.el.querySelector(sel);
    const done = () => { m.close(); loadPlayers(root); };
    if ('give' in t.dataset) {
      const mat = q('[data-g-mat]').value;
      const type = q('[data-g-type]').value;
      const r = await run(act('admin_give', {
        id, gold: Number(q('[data-g-gold]').value) || 0,
        materials: mat ? { [mat]: Number(q('[data-g-matqty]').value) || 0 } : {},
        item: type ? { type, uniqueId: q('[data-g-unique]').value, setId: q('[data-g-set]').value, baseId: q('[data-g-base]').value, rarity: q('[data-g-rarity]').value, level: Number(q('[data-g-level]').value) } : null,
        note: q('[data-g-note]').value || undefined,
      }), 'Gift sent.');
      if (r !== undefined) done();
    }
    if ('kick' in t.dataset) { await run(act('admin_kick', { id }), 'Player kicked.'); done(); }
    if ('unban' in t.dataset) { await run(act('admin_unban', { id }), 'Player unbanned.'); done(); }
    if ('ban' in t.dataset) {
      const reason = q('[data-ban-reason]').value.trim();
      if (!reason) return toast('Enter a reason', 'error');
      if (await confirmBox(`Ban ${d.username}?`, 'Ban')) { await run(act('admin_ban', { id, reason, hours: Number(q('[data-ban-hours]').value) }), 'Player banned.'); done(); }
    }
    if ('resetPw' in t.dataset && await confirmBox(`Reset ${d.username}'s password? They will be logged out.`, 'Reset')) {
      const r = await run(act('admin_reset_password', { id }));
      if (r) modal(`<h3>New password for ${esc(d.username)}</h3><p>Give this to the player so they can log in, then ask them to keep it safe:</p><pre class="pw">${esc(r.password)}</pre><div class="row end"><button class="btn primary" data-close>Done</button></div>`);
    }
    if ('delete' in t.dataset) {
      const confirmName = prompt(`This permanently deletes ${d.username}'s account and all progress.\nType the username to confirm:`);
      if (confirmName === d.username) { await run(act('admin_delete', { id, confirm: confirmName }), 'Account deleted.'); done(); }
    }
  });
}

export const adminView = {
  id: 'admin', label: 'Admin', icon: '🛡', adminOnly: true,
  mount(root) {
    root.innerHTML = `<section class="panel"><div class="panel-head"><h3>🛡 Admin</h3><span class="muted small">Only visible to admins. All actions are logged.</span></div>
      <div class="tabs">${[['dashboard', 'Dashboard'], ['players', 'Players']].map(([id, l]) => `<button class="tab ${ui.tab === id ? 'active' : ''}" data-tab="${id}">${l}</button>`).join('')}</div>
      <div class="admin-body"></div></section>`;
    const reload = () => (ui.tab === 'dashboard' ? loadOverview(root) : loadPlayers(root));
    root.addEventListener('click', async e => {
      const t = e.target.closest('button, tr[data-player]');
      if (!t) return;
      if (t.dataset.tab) { ui.tab = t.dataset.tab; root.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b === t)); reload(); return; }
      if (t.dataset.player) { openPlayer(t.dataset.player, root); return; }
      if ('sendBroadcast' in t.dataset) {
        const ta = root.querySelector('[data-broadcast]');
        if (await run(act('admin_broadcast', { text: ta.value }), 'Announcement sent.') !== undefined) ta.value = '';
      }
    });
    root.addEventListener('submit', async e => {
      if (!e.target.matches('.admin-settings')) return;
      e.preventDefault();
      const changes = {};
      for (const el of e.target.elements) if (el.name) changes[el.name] = el.type === 'checkbox' ? el.checked : el.value;
      if (await run(act('admin_settings', { changes }), 'Settings saved.') !== undefined) { document.activeElement?.blur(); loadOverview(root); }
    });
    root.addEventListener('change', e => { if (e.target.matches('[data-player-sort]')) { ui.sort = e.target.value; loadPlayers(root); } });
    root.addEventListener('input', e => {
      if (!e.target.matches('[data-player-search]')) return;
      ui.query = e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { e.target.blur(); loadPlayers(root); setTimeout(() => { const i = root.querySelector('[data-player-search]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 50); }, 350);
    });
    reload();
    timer = setInterval(() => { if (ui.tab === 'dashboard') loadOverview(root); }, 15000);
  },
  unmount() { clearInterval(timer); },
  render() { /* data is loaded on demand */ },
};

export { CLASSES };
