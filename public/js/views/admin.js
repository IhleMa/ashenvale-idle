// Admin panel (only visible to admins; every action is re-checked on the server).
import { mountAssets } from './admin-assets.js';
import { state } from '../state.js';
import { act } from '../net.js';
import { esc, fmt, run, toast, modal, duration, confirmBox, itemTooltipHtml, tipAttr } from '../ui.js';
import { classIcon, itemIcon, materialIcon } from '../assets.js';
import { CLASSES } from '/shared/data/classes.js';
import { MATERIALS, MATERIAL_IDS } from '/shared/data/town.js';
import { ITEM_BASES } from '/shared/data/items.js';
import { UNIQUES, SETS } from '/shared/data/legendaries.js';
import { CONFIG } from '/shared/config.js';
import { mountContentEditor, contentEditorDirty } from './admin-content.js';
import { mountCurveEditor, curveEditorDirty } from './admin-curve.js';
import { mountBalance } from './admin-balance.js';

const ui = { tab: 'dashboard', query: '', sort: 'online', suggFilter: 'open', suggCat: 'all' };
let sugg = null; // { list, counts }
const SUGG_STATUSES = [['new', 'New'], ['read', 'Read'], ['planned', 'Planned'], ['done', 'Done'], ['declined', 'Declined']];
const SUGG_CATS = { feature: '✨ Feature', balance: '⚖ Balance', bug: '🐞 Bug', ui: '🖥 Interface', other: '💬 Other' };
async function loadSuggestions(root) {
  try { sugg = await act('admin_suggestions'); } catch (e) { return toast(e.message, 'error'); }
  render(root);
  const b = root.querySelector('[data-tab=suggestions] .tab-count');
  if (b) { b.textContent = sugg.counts.new || ''; b.hidden = !sugg.counts.new; }
}
function suggestionsHtml() {
  if (!sugg) return '<p class="muted">Loading…</p>';
  const open = s => s.status === 'new' || s.status === 'read' || s.status === 'planned';
  const rows = sugg.list.filter(s => (ui.suggFilter === 'all' || (ui.suggFilter === 'open' ? open(s) : s.status === ui.suggFilter)) && (ui.suggCat === 'all' || s.category === ui.suggCat));
  const c = sugg.counts;
  return `<div class="row gap wrap">
      <select data-sugg-filter>${[['open', `Open (${(c.new || 0) + (c.read || 0) + (c.planned || 0)})`], ['all', `All (${sugg.list.length})`], ...SUGG_STATUSES.map(([v, l]) => [v, `${l} (${c[v] || 0})`])].map(([v, l]) => `<option value="${v}" ${ui.suggFilter === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select data-sugg-cat><option value="all">All categories</option>${Object.entries(SUGG_CATS).map(([v, l]) => `<option value="${v}" ${ui.suggCat === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button class="btn tiny ghost" data-sugg-refresh>↻ Refresh</button>
    </div>
    <div class="sugg-list">${rows.map(s => `<div class="admin-sugg ${s.status === 'new' ? 'is-new' : ''}" data-sugg="${esc(s.id)}">
      <div class="row between wrap"><div class="small"><b>${esc(s.name)}</b> <span class="muted">${SUGG_CATS[s.category] || esc(s.category)} · ${new Date(s.at).toLocaleString()}</span></div>
        <div class="row gap">${SUGG_STATUSES.map(([v, l]) => `<button class="btn tiny ${s.status === v ? 'primary' : 'ghost'}" data-sugg-status="${v}">${l}</button>`).join('')}<button class="btn tiny danger" data-sugg-del>✕</button></div></div>
      <div class="ann-text">${esc(s.text)}</div>
      <div class="row gap sugg-reply-row"><input data-sugg-reply value="${esc(s.reply || '')}" maxlength="500" placeholder="Reply to the player (they see it under their suggestion)"><button class="btn tiny" data-sugg-save-reply>Save reply</button></div>
    </div>`).join('') || '<p class="muted">No suggestions here.</p>'}</div>`;
}
let overview = null;
let players = null;
let timer = null;
let searchTimer = null;

const ago = ts => (ts ? `${duration((Date.now() - ts) / 1000)} ago` : '—');

async function loadOverview(root) { try { overview = await act('admin_overview'); } catch (e) { toast(e.message, 'error'); } render(root); }
let botData = null;
let botTimer = null;
async function loadBots(root) { try { botData = await act('admin_bots'); } catch (e) { toast(e.message, 'error'); } render(root); }

function botsHtml() {
  if (!botData) return '<p class="muted">Loading…</p>';
  const b = botData;
  const online = b.bots.filter(x => x.online).length;
  const bar = v => `<span class="persona-bar" title="${Math.round(v * 100)}%"><i style="width:${Math.round(v * 100)}%"></i></span>`;
  return `<section class="panel">
    <div class="panel-head"><h3>🤖 Bot players <span class="muted small">${b.bots.length} bots · ${online} online</span></h3>
      <div class="row gap"><button class="btn small ${b.enabled ? 'ghost' : 'primary'}" data-bots-toggle>${b.enabled ? '⏸ Pause all bots' : '▶ Start bots'}</button><button class="btn small ghost" data-bots-refresh>↻</button></div></div>
    <p class="muted small">Bots are real accounts that play through the same actions as everyone else: they create a hero, recruit, gear up, push zones and bosses, build their town, send expeditions, run rifts, claim quests, trade on the Auction House, form co-op groups (and accept your invites) and log in and out on their own schedule. Each has a personality: <b>skill</b> (how good their decisions are), <b>activity</b> (how much they play) and what they like doing. Nobody can log in to a bot account.</p>
    <div class="row gap wrap">Add <select data-bots-count>${[1, 2, 3, 5, 10].map(n => `<option>${n}</option>`).join('')}</select>
      <select data-bots-type><option value="">random personality</option>${Object.entries(b.archetypes).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select>
      <button class="btn small primary" data-bots-add>+ Add bots</button>
      <span class="grow"></span>${b.bots.length ? '<button class="btn small ghost danger" data-bot-remove="all">Remove all</button>' : ''}</div>
    ${b.bots.length ? `<table class="admin-table bots-table"><thead><tr><th></th><th>Bot</th><th>Type</th><th>Hero</th><th>Skill</th><th>Activity</th><th>Gold</th><th>Rift</th><th>Doing</th><th></th></tr></thead><tbody>
      ${b.bots.map(x => `<tr><td><span class="conn-dot ${x.online ? 'on' : ''}"></span></td><td><b>${esc(x.name)}</b></td><td>${esc(x.label || x.archetype)}</td>
        <td>${x.hero ? `Lv ${x.hero.level} ${esc(x.hero.classId)}` : '<span class="muted">—</span>'}</td><td>${bar(x.persona.skill)}</td><td>${bar(x.persona.activity)}</td>
        <td>${fmt(Math.floor(x.gold))}</td><td>${x.rift || '—'}</td><td class="small">${esc(x.online ? x.doing : `offline · back in ${duration(Math.max(0, (x.since - Date.now()) / 1000))}`)}</td>
        <td><button class="btn tiny ghost danger" data-bot-remove="${esc(x.name)}">✕</button></td></tr>`).join('')}</tbody></table>`
      : '<p class="muted pad">No bots yet. Add a few to make the world feel alive — they show up in rankings, the online list, the Auction House and can join your groups.</p>'}
    <p class="faint small">Console: <code>bots</code>, <code>bots add 5 [casual|grinder|trader|crafter|social|tryhard]</code>, <code>bots remove &lt;name|all&gt;</code>, <code>bots on|off</code>. The 🤖 tag next to their names can be turned off in the server settings.</p>
  </section>`;
}

async function loadPlayers(root) { try { players = await act('admin_players', { query: ui.query, sort: ui.sort }); } catch (e) { toast(e.message, 'error'); } render(root); }

function tlsText(t) {
  if (!t || t.mode === 'off') return location.protocol === 'https:' ? 'via proxy' : 'off';
  if (!t.active) return '⚠ not active';
  const days = t.expires ? Math.floor((t.expires - Date.now()) / 86400000) : null;
  return `🔒 ${t.staging ? 'staging · ' : ''}${days != null ? `${days} days left` : 'on'}`;
}
function dashboardHtml() {
  if (!overview) return '<p class="muted">Loading…</p>';
  const o = overview;
  return `<div class="admin-cards">
      ${[['Online now', o.online], ['Accounts', o.accounts], ['Uptime', duration(o.uptime)], ['Memory', o.memoryMb + ' MB'], ['Groups', `${o.groups} (${o.coopBattles} fighting)`], ['Auctions', `${o.auction.listings} listed · ${o.auction.sales24h} sold/24h`], ['HTTPS', tlsText(o.tls)], ['Build', o.buildId], ['Node', o.node]]
        .map(([l, v]) => `<div class="admin-card"><small>${l}</small><b>${esc(String(v))}</b></div>`).join('')}
    </div>
    <div class="admin-grid">
      <section class="panel">
        <h3>Announcement</h3>
        <p class="muted small">Pops up for everyone online right now. Players who are offline see it the next time they log in (until it expires).</p>
        <textarea data-broadcast rows="3" maxlength="500" placeholder="e.g. Server restart in 5 minutes!"></textarea>
        <div class="row end gap"><label class="small">Show to returning players for
          <select data-ann-hours>${[[24, '1 day'], [72, '3 days'], [168, '7 days'], [720, '30 days'], [0, 'until deleted']].map(([h, l]) => `<option value="${h}" ${h === 168 ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <button class="btn primary small" data-send-broadcast>Send to all players</button></div>
        <h3>Active announcements</h3>
        ${(o.announcements || []).map(a => `<div class="admin-ann"><div><div class="small"><b>${esc(a.from)}</b> <span class="muted">${new Date(a.at).toLocaleString()} · ${a.expiresAt ? 'expires in ' + duration((a.expiresAt - Date.now()) / 1000) : 'until deleted'}</span></div><div class="ann-text">${esc(a.text)}</div></div><button class="btn tiny danger" data-del-ann="${esc(a.id)}">Delete</button></div>`).join('') || '<p class="muted small">None.</p>'}
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
    <table class="rank-table admin-players"><thead><tr><th>Player</th><th>Hero</th><th class="num">Gold</th><th class="num">💠</th><th>Last seen</th><th>Created</th><th>Status</th><th></th></tr></thead>
    <tbody>${(players?.rows || []).map(r => `<tr data-player="${r.id}">
      <td><span class="conn-dot ${r.online ? 'on' : ''}"></span> <b>${esc(r.username)}</b>${r.admin ? ' <span class="tag hero">ADMIN</span>' : ''}</td>
      <td>${r.hero ? `${classIcon(r.hero.classId, 'xxs')} ${esc(r.hero.name)} <span class="muted small">Lv ${r.hero.level}</span>` : '<span class="muted">no hero</span>'}</td>
      <td class="num">${fmt(r.gold)}</td><td class="num">${fmt(r.premium || 0)}</td><td class="muted small">${r.online ? 'online' : ago(r.lastActive)}</td><td class="muted small">${new Date(r.createdAt).toLocaleDateString()}</td>
      <td>${r.banned ? `<span class="tag boss" ${tipAttr(esc(r.banned.reason))}>BANNED</span>` : ''}</td>
      <td class="num"><button class="btn tiny">Manage</button></td></tr>`).join('') || '<tr><td colspan="8" class="muted">No players.</td></tr>'}</tbody></table>`;
}

function render(root) {
  const host = root.querySelector('.admin-body');
  if (!host) return;
  if (ui.tab === 'content' || ui.tab === 'curve' || ui.tab === 'balance') return; // these draw themselves
  if (host.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  host.innerHTML = ui.tab === 'dashboard' ? dashboardHtml() : ui.tab === 'bots' ? botsHtml() : ui.tab === 'suggestions' ? suggestionsHtml() : playersHtml();
}

async function openPlayer(id, root) {
  let d;
  try { d = await act('admin_player', { id }); } catch (e) { return toast(e.message, 'error'); }
  const pl = d.player;
  const m = modal(`<h2>${esc(d.username)} ${d.online ? '<span class="tag live">ONLINE</span>' : ''} ${d.banned ? '<span class="tag boss">BANNED</span>' : ''} ${pl ? `<button class="btn tiny ghost" data-export title="Download this player's game data as a JSON file">⬇ Export data</button>` : ''}</h2>
    <div class="muted small">Account created ${new Date(d.createdAt).toLocaleString()} · last seen ${d.online ? 'now' : ago(d.lastActive)}${d.banned ? ` · banned: ${esc(d.banned.reason)}${d.banned.until ? ` (until ${new Date(d.banned.until).toLocaleString()})` : ' (permanent)'}` : ''}</div>
    ${pl ? `<div class="admin-cards small-cards">
      ${[['Gold', fmt(pl.gold)], ['💠 Crystals', fmt(pl.premium)], ['Kills', fmt(pl.stats.kills || 0)], ['Characters', pl.characters.length], ['Inventory', `${pl.inventory.length}/${CONFIG.inventory.limit}`], ['Mailbox', pl.mailbox], ['Auctions', pl.auctions], ['Expeditions', pl.expeditions], ['Zone', pl.zone]].map(([l, v]) => `<div class="admin-card"><small>${l}</small><b>${esc(String(v))}</b></div>`).join('')}
    </div>
    <h4>Characters</h4><div class="small">${pl.characters.map(c => `${classIcon(c.classId, 'xxs')} ${c.isMain ? '★ ' : ''}${esc(c.name)} Lv ${c.level}${c.profession ? ` <span class="muted">(${esc(c.profession.id)} ${c.profession.level})</span>` : ''}`).join(' · ')}</div>
    <h4>Materials</h4><div class="row gap wrap small">${Object.entries(pl.materials).filter(([, v]) => v >= 1).map(([k, v]) => `<span class="cost">${materialIcon(k, 'xxs')} ${fmt(Math.floor(v))}</span>`).join('') || '<span class="muted">none</span>'}</div>
    <h4>Inventory</h4><div class="row gap wrap">${pl.inventory.slice(0, 60).map(i => `<span ${tipAttr(itemTooltipHtml(i))}>${itemIcon(i, 'xs')}</span>`).join('') || '<span class="muted small">empty</span>'}</div>` : '<p class="muted">No game data yet.</p>'}

    <h3>Give</h3>
    <div class="admin-give">
      <label class="inline">Gold <input type="number" data-g-gold min="0" value="0"></label>
      <label class="inline">💠 Crystals <input type="number" data-g-premium min="0" value="0"></label>
      <label class="inline">✨ Pinnacle Sigils <input type="number" data-g-sigils min="0" value="0"></label>
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

    ${pl ? `<h3>Experience</h3>
    <div class="admin-give">
      <label class="inline">For <select data-x-target>
        <option value="hero">Hero</option><option value="party">Active party</option><option value="all">All characters</option>
        ${pl.characters.map(c => `<option value="${esc(c.id)}">${c.isMain ? '★ ' : ''}${esc(c.name)} (Lv ${c.level})</option>`).join('')}
      </select></label>
      <label class="inline"><select data-x-mode><option value="xp">Add XP</option><option value="levels">Add levels</option><option value="set">Set level to</option></select></label>
      <input type="number" data-x-amount min="1" value="1000" style="width:130px">
      <button class="btn primary small" data-give-xp>Give</button>
      <span class="muted small" data-x-hint>Raw XP, no hero/trait bonus. Applied immediately.</span>
    </div>
    <div class="admin-give">
      <span>⚡ XP boost: ${pl.xpBoost ? `<b>×${pl.xpBoost.mult}</b> ${pl.xpBoost.until ? `until ${new Date(pl.xpBoost.until).toLocaleString()}` : 'until removed'} <span class="muted small">(by ${esc(pl.xpBoost.by || '?')})</span>` : '<span class="muted">none</span>'}</span>
      <label class="inline">×<input type="number" data-b-mult min="1" max="100" step="0.5" value="${pl.xpBoost?.mult || 10}" style="width:80px"></label>
      <label class="inline">for <select data-b-hours><option value="1">1 hour</option><option value="6">6 hours</option><option value="24" selected>24 hours</option><option value="168">7 days</option><option value="0">until removed</option></select></label>
      <button class="btn primary small" data-boost>Set boost</button>
      ${pl.xpBoost ? '<button class="btn small ghost danger" data-unboost>Remove</button>' : ''}
      <span class="muted small">Multiplies all XP from fights (also offline) and expeditions — for trying out classes.</span>
    </div>` : ''}

    <h3>Moderation</h3>
    <div class="row gap wrap">
      ${d.online ? '<button class="btn small" data-kick>Kick</button>' : ''}
      ${d.banned ? '<button class="btn small" data-unban>Unban</button>' : `<input data-ban-reason placeholder="Ban reason" maxlength="200"><select data-ban-hours><option value="24">24 hours</option><option value="168">7 days</option><option value="720">30 days</option><option value="0">Permanent</option></select><button class="btn small danger" data-ban>Ban</button>`}
      <button class="btn small" data-reset-pw>Reset password</button>
      <button class="btn small ghost danger" data-delete>Delete account…</button>
    </div>`, { wide: true });
  m.el.querySelector('[data-x-mode]')?.addEventListener('change', e => {
    const mode = e.target.value, inp = m.el.querySelector('[data-x-amount]');
    m.el.querySelector('[data-x-hint]').textContent = { xp: 'Raw XP, no hero/trait bonus. Applied immediately.', levels: `Whole levels (max ${CONFIG.levelCap}); progress into the current level is kept.`, set: 'Exact level — can also lower it. Skill points over the new budget are refunded.' }[mode];
    inp.max = mode === 'xp' ? '' : CONFIG.levelCap;
    inp.value = mode === 'xp' ? 1000 : mode === 'levels' ? 1 : CONFIG.levelCap;
  });
  m.el.addEventListener('click', async e => {
    if (e.target.closest('[data-export]')) {
      try {
        const data = await act('admin_player_export', { id });
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
        const a = Object.assign(document.createElement('a'), { href: url, download: `ashenvale-${d.username}-${new Date().toISOString().slice(0, 10)}.json` });
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (err) { toast(err.message, 'error'); }
      return;
    }
    const t = e.target.closest('button');
    if (!t) return;
    const q = sel => m.el.querySelector(sel);
    const done = () => { m.close(); loadPlayers(root); };
    if ('give' in t.dataset) {
      const mat = q('[data-g-mat]').value;
      const type = q('[data-g-type]').value;
      const r = await run(act('admin_give', {
        id, gold: Number(q('[data-g-gold]').value) || 0, premium: Number(q('[data-g-premium]').value) || 0, sigils: Number(q('[data-g-sigils]').value) || 0,
        materials: mat ? { [mat]: Number(q('[data-g-matqty]').value) || 0 } : {},
        item: type ? { type, uniqueId: q('[data-g-unique]').value, setId: q('[data-g-set]').value, baseId: q('[data-g-base]').value, rarity: q('[data-g-rarity]').value, level: Number(q('[data-g-level]').value) } : null,
        note: q('[data-g-note]').value || undefined,
      }), 'Gift sent.');
      if (r !== undefined) done();
    }
    if ('giveXp' in t.dataset) {
      const mode = q('[data-x-mode]').value, amount = Number(q('[data-x-amount]').value) || 0;
      if (mode === 'set' && !await confirmBox(`Set the level of ${q('[data-x-target]').selectedOptions[0].textContent} to ${amount}? Lowering a level removes skill points that are no longer covered.`, 'Set level')) return;
      const r = await run(act('admin_give_xp', { id, target: q('[data-x-target]').value, mode, amount }));
      if (r) {
        toast(r.results.map(x => `${x.name}: Lv ${x.from} → ${x.to}`).join(' · ') || 'Done.', 'success', 5000);
        m.close(); openPlayer(id, root); loadPlayers(root);
      }
      return;
    }
    if ('boost' in t.dataset || 'unboost' in t.dataset) {
      const r = await run(act('admin_xp_boost', { id, mult: 'unboost' in t.dataset ? 1 : Number(q('[data-b-mult]').value) || 1, hours: Number(q('[data-b-hours]').value) }), 'unboost' in t.dataset ? 'XP boost removed.' : 'XP boost set.');
      if (r !== undefined) { m.close(); openPlayer(id, root); loadPlayers(root); }
      return;
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
      <div class="tabs">${[['dashboard', 'Dashboard'], ['players', 'Players'], ['suggestions', '💡 Suggestions <span class="tab-count" hidden></span>'], ['bots', '🤖 Bots'], ['balance', '⚖ Balance'], ['content', '📦 Content'], ['curve', '📈 XP curve'], ['assets', '🖼 Assets']].map(([id, l]) => `<button class="tab ${ui.tab === id ? 'active' : ''}" data-tab="${id}">${l}</button>`).join('')}</div>
      <div class="admin-body"></div></section>`;
    const reload = () => {
      root.querySelector('.admin-body').classList.toggle('wide', ui.tab === 'content');
      if (ui.tab === 'content') return mountContentEditor(root.querySelector('.admin-body'));
      if (ui.tab === 'curve') return mountCurveEditor(root.querySelector('.admin-body'));
      if (ui.tab === 'balance') return mountBalance(root.querySelector('.admin-body'));
      if (ui.tab === 'assets') return mountAssets(root.querySelector('.admin-body'));
      return ui.tab === 'dashboard' ? loadOverview(root) : ui.tab === 'bots' ? loadBots(root) : ui.tab === 'suggestions' ? loadSuggestions(root) : loadPlayers(root);
    };
    // badge with the number of new suggestions on the tab, also before it is opened
    act('admin_suggestions').then(r => { sugg = r; const bd = root.querySelector('[data-tab=suggestions] .tab-count'); if (bd) { bd.textContent = r.counts.new || ''; bd.hidden = !r.counts.new; } }).catch(() => {});
    clearInterval(botTimer);
    botTimer = setInterval(() => { if (ui.tab === 'bots' && root.isConnected && !root.contains(document.activeElement?.closest?.('select, input'))) loadBots(root); }, 8000);
    root.addEventListener('click', async e => {
      const t = e.target.closest('button, tr[data-player]');
      if (!t) return;
      if (t.dataset.tab && t.dataset.tab !== ui.tab && (contentEditorDirty() || curveEditorDirty()) && !(await confirmBox('Discard your unsaved content changes?', 'Discard'))) return;
      if (t.dataset.tab) { ui.tab = t.dataset.tab; root.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b === t)); reload(); return; }
      if (t.dataset.player) { openPlayer(t.dataset.player, root); return; }
      const sg = t.closest('[data-sugg]')?.dataset.sugg;
      if ('suggRefresh' in t.dataset) { loadSuggestions(root); return; }
      if (sg && t.dataset.suggStatus) { if (await run(act('admin_suggestion_update', { id: sg, status: t.dataset.suggStatus })) !== undefined) loadSuggestions(root); return; }
      if (sg && 'suggSaveReply' in t.dataset) {
        const reply = t.closest('[data-sugg]').querySelector('[data-sugg-reply]').value;
        if (await run(act('admin_suggestion_update', { id: sg, reply, status: undefined }), 'Reply saved — the player sees it under their suggestion.') !== undefined) { document.activeElement?.blur(); loadSuggestions(root); }
        return;
      }
      if (sg && 'suggDel' in t.dataset) { if (await confirmBox('Delete this suggestion?', 'Delete') && await run(act('admin_suggestion_delete', { id: sg })) !== undefined) loadSuggestions(root); return; }
      if ('sendBroadcast' in t.dataset) {
        const ta = root.querySelector('[data-broadcast]');
        const hours = Number(root.querySelector('[data-ann-hours]').value);
        if (await run(act('admin_broadcast', { text: ta.value, hours }), 'Announcement sent.') !== undefined) { ta.value = ''; loadOverview(root); }
      }
      if ('botsAdd' in t.dataset) {
        const count = Number(root.querySelector('[data-bots-count]').value), archetype = root.querySelector('[data-bots-type]').value;
        const r = await run(act('admin_bots_add', { count, archetype }));
        if (r) { toast(`Added ${r.added.map(x => x.name).join(', ')}`, 'success'); loadBots(root); }
        return;
      }
      if (t.dataset.botRemove) {
        const all = t.dataset.botRemove === 'all';
        if (await confirmBox(all ? 'Remove ALL bots? Their accounts, heroes and auctions are deleted.' : `Remove the bot ${t.dataset.botRemove}? Its account and hero are deleted.`, 'Remove')) {
          if (await run(act('admin_bots_remove', { name: t.dataset.botRemove })) !== undefined) loadBots(root);
        }
        return;
      }
      if ('botsToggle' in t.dataset) { await run(act('admin_bots_enable', { on: !botData?.enabled })); loadBots(root); return; }
      if ('botsRefresh' in t.dataset) { loadBots(root); return; }
      if (t.dataset.delAnn) {
        if (await confirmBox('Delete this announcement? Players who haven\'t seen it yet won\'t get it anymore.', 'Delete'))
          if (await run(act('admin_announcement_delete', { id: t.dataset.delAnn }), 'Announcement deleted.') !== undefined) loadOverview(root);
      }
    });
    root.addEventListener('submit', async e => {
      if (!e.target.matches('.admin-settings')) return;
      e.preventDefault();
      const changes = {};
      for (const el of e.target.elements) if (el.name) changes[el.name] = el.type === 'checkbox' ? el.checked : el.value;
      if (await run(act('admin_settings', { changes }), 'Settings saved.') !== undefined) { document.activeElement?.blur(); loadOverview(root); }
    });
    root.addEventListener('change', e => {
      if (e.target.matches('[data-player-sort]')) { ui.sort = e.target.value; loadPlayers(root); }
      if (e.target.matches('[data-sugg-filter]')) { ui.suggFilter = e.target.value; e.target.blur(); render(root); }
      if (e.target.matches('[data-sugg-cat]')) { ui.suggCat = e.target.value; e.target.blur(); render(root); }
    });
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
