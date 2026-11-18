// Combat view: live, server-driven battle display (presentation only — all math happens on the server).
import { bus, state } from '../state.js';
import { act } from '../net.js';
import { esc, fmt, run, tipAttr } from '../ui.js';
import { portrait, enemyArt, minionArt, abilityIcon, statusIcon, backgroundStyle } from '../assets.js';
import { ABILITIES } from '/shared/data/abilities.js';
import { STATUSES } from '/shared/data/statuses.js';
import { ZONES, COOP_ENCOUNTERS } from '/shared/data/zones.js';
import { ENEMIES } from '/shared/data/enemies.js';
import { CLASSES } from '/shared/data/classes.js';
import { MINIONS } from '/shared/data/minions.js';
import { rarityById } from '/shared/config.js';
import { createMeter, recordEvent, seedUnits, mergeMeter } from '../meter.js';
import { LOG_CATEGORIES, PRESETS, loadFilter, saveFilter, makeEntry, passes } from '../combatlog.js';
import { renderMeterPanel, meterUI } from './combat-meter.js';
import { AFFIXES } from '/shared/rifts.js';
import { openBestiary } from './bestiary.js';

const battles = { solo: null, coop: null };
const results = { solo: [], coop: [] };
const meters = { solo: { last: null, session: createMeter('Session') }, coop: { last: null, session: createMeter('Session') } };
let root = null;
let filter = loadFilter();
let meterDirty = true;
let meterTimer = null;
const MAX_LOG = 800;
const MAX_LOG_DOM = 400;

function makeBattle(snapshot) {
  const b = { meta: snapshot.meta, time: snapshot.time, wave: snapshot.wave, waves: snapshot.waves, state: snapshot.state, units: new Map(), log: [] };
  for (const u of snapshot.units) b.units.set(u.uid, u);
  return b;
}
const shown = () => (battles.coop ? 'coop' : 'solo');

// ------------------------------------------------------------------ message handling (always active)
bus.on('msg:battle_start', m => {
  const prevLog = battles[m.k]?.log || [];
  battles[m.k] = makeBattle(m.battle);
  battles[m.k].log = prevLog.slice(-300);
  battles[m.k].meter = createMeter(m.battle.meta?.title || 'Battle');
  seedUnits(battles[m.k].meter, battles[m.k].units);
  meterDirty = true;
  addLog(battles[m.k], { cat: 'sep', t: m.battle.time || 0, html: `<span class="log-sep">— ${esc(m.battle.meta?.title || 'Battle')} —</span>` });
  state.battles[m.k] = battles[m.k];
  if (root && shown() === m.k) build();
  updateActivity();
});
bus.on('msg:bt', m => {
  const b = battles[m.k];
  if (!b) return;
  b.time = m.time; b.wave = m.wave;
  let structural = false;
  for (const d of m.u) { const u = b.units.get(d.uid); if (u) Object.assign(u, d); }
  const visible = root && shown() === m.k;
  const gone = [];
  for (const ev of m.e) {
    // minions that faded, exploded or died leave the field
    if (ev.type === 'expire' || (ev.type === 'death' && b.units.get(ev.tgt)?.kind === 'minion')) { const u = b.units.get(ev.tgt); if (u) { u.alive = false; gone.push(ev.tgt); } }
    if (ev.type === 'spawn') { b.units.set(ev.unit.uid, ev.unit); structural = true; }
    if (ev.type === 'wave') {
      for (const [uid, u] of b.units) if (u.side === 'B' && !u.alive) b.units.delete(uid);
      for (const u of ev.units) b.units.set(u.uid, u);
      structural = true;
    }
    if (ev.type === 'spawn' || ev.type === 'wave') seedUnits(b.meter, b.units);
    recordEvent(b.meter, b.units, ev, m.time);
    const entry = makeEntry(b.units, ev, ev.t ?? m.time);
    if (entry) addLog(b, entry);
    if (visible && !structural) floatEvent(ev);
  }
  if (gone.length) { for (const uid of gone) b.units.delete(uid); structural = true; }
  meterDirty = true;
  if (visible) { if (structural) { buildField(); refreshSources(); } update(); }
});
bus.on('msg:battle_end', m => {
  const b = battles[m.k];
  const s = m.summary;
  results[m.k].unshift({ ...s, at: Date.now(), title: b?.meta?.title });
  results[m.k].length = Math.min(results[m.k].length, 8);
  if (b) {
    b.state = s.result;
    if (b.meter && !b.meter.done) {
      b.meter.done = true;
      b.meter.result = s.result;
      meters[m.k].last = b.meter;
      mergeMeter(meters[m.k].session, b.meter);
      meterDirty = true;
    }
    if (s.result === 'victory') {
      const items = s.items?.length ? ` · ${s.items.length} item${s.items.length > 1 ? 's' : ''}` : '';
      addLog(b, { cat: 'event', t: b.time, html: `<span class="log-win">Victory! +${fmt(s.xp)} XP, +${fmt(s.gold)} gold${items}</span>` });
    } else addLog(b, { cat: 'event', t: b.time, html: '<span class="log-loss">Defeat… your party regroups.</span>' });
  }
  if (m.k === 'coop') setTimeout(() => { battles.coop = null; state.battles.coop = null; if (root) build(); updateActivity(); }, 4000);
  if (root && shown() === m.k) { update(); renderResults(); showBanner(s); }
  updateActivity();
});
bus.on('msg:battle_abort', m => {
  battles[m.k] = null; state.battles[m.k] = null;
  if (root) build();
  updateActivity();
});

function updateActivity() {
  const k = shown();
  const b = battles[k];
  let html;
  if (!b) html = '<span class="muted">Resting…</span>';
  else {
    const icon = k === 'coop' ? '⚑' : b.meta?.kind === 'boss' ? '☠' : '⚔';
    const st = b.state === 'running' ? `Wave ${b.wave}/${b.waves}` : b.state === 'victory' ? 'Victory' : 'Defeat';
    html = `<a href="#/combat">${icon} ${esc(b.meta?.title || '')} <span class="muted">· ${st}</span></a>`;
  }
  bus.emit('activity', html);
}

// ------------------------------------------------------------------ combat log
const myId = () => state.player?.id;
function addLog(b, entry) {
  b.log.push(entry);
  if (b.log.length > MAX_LOG) b.log.splice(0, b.log.length - MAX_LOG);
  if (root && battles[shown()] === b) appendLogLine(entry);
}
function lineEl(e) {
  const d = document.createElement('div');
  d.className = `log-line k-${e.cat}`;
  d.innerHTML = `<span class="log-t">${e.t.toFixed(1)}</span> ${e.html}`;
  return d;
}
function appendLogLine(entry) {
  const el = root?.querySelector('.log-lines');
  if (!el) return;
  updateLogCount();
  if (!passes(entry, filter, myId())) return;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  el.appendChild(lineEl(entry));
  while (el.children.length > MAX_LOG_DOM) el.firstChild.remove();
  if (filter.autoscroll && atBottom) el.scrollTop = el.scrollHeight;
}
function rebuildLog() {
  const el = root?.querySelector('.log-lines');
  if (!el) return;
  const b = battles[shown()];
  el.innerHTML = '';
  if (b) {
    const frag = document.createDocumentFragment();
    const shownEntries = b.log.filter(e => passes(e, filter, myId())).slice(-MAX_LOG_DOM);
    for (const e of shownEntries) frag.appendChild(lineEl(e));
    el.appendChild(frag);
  }
  el.scrollTop = el.scrollHeight;
  updateLogCount();
}
let countTimer = null;
function updateLogCount() {
  if (countTimer) return;
  countTimer = setTimeout(() => {
    countTimer = null;
    const b = battles[shown()];
    const el = root?.querySelector('.log-count');
    if (!el || !b) return;
    const shownN = b.log.filter(e => passes(e, filter, myId())).length;
    el.textContent = `${shownN} / ${b.log.length} lines`;
  }, 300);
}
function sourceOptions(b) {
  const opts = [['all', 'Everyone'], ['party', 'My side'], ['enemies', 'Enemies']];
  if (b?.meta?.kind === 'coop') opts.push(['mine', 'My characters']);
  const units = b ? [...b.units.values()] : [];
  return `${opts.map(([v, l]) => `<option value="${v}" ${filter.source === v ? 'selected' : ''}>${l}</option>`).join('')}
    ${units.length ? `<optgroup label="Involving unit">${units.map(u => { const k = `u:${unitKeyOf(u)}`; return `<option value="${esc(k)}" ${filter.source === k ? 'selected' : ''}>${esc(u.name)}${u.side === 'B' ? ' (enemy)' : ''}</option>`; }).join('')}</optgroup>` : ''}`;
}
function logPanelHtml(b) {
  return `<div class="panel combat-log">
    <div class="panel-head"><h3>Combat log <span class="muted small log-count"></span></h3>
      <div class="row gap">${Object.entries(PRESETS).map(([id, p]) => `<button class="btn tiny ghost" data-preset="${id}">${esc(p.label)}</button>`).join('')}</div>
    </div>
    <div class="log-cats">${Object.entries(LOG_CATEGORIES).map(([id, c]) => `<button class="chip-toggle ${filter.cats[id] ? 'on' : ''} c-${id}" data-cat="${id}" ${tipAttr(esc(c.tip))}>${esc(c.label)}</button>`).join('')}</div>
    <div class="log-filters row gap wrap">
      <select data-log-source title="Whose actions to show">${sourceOptions(b)}</select>
      <label class="inline small"><input type="checkbox" data-crits ${filter.critsOnly ? 'checked' : ''}> Crits only</label>
      <label class="inline small">Min <input type="number" data-min min="0" step="10" value="${filter.minAmount || 0}"></label>
      <input class="log-search" data-log-search placeholder="Search log…" value="${esc(filter.search)}">
      <label class="inline small" title="Keep the log scrolled to the newest line"><input type="checkbox" data-autoscroll ${filter.autoscroll ? 'checked' : ''}> Follow</label>
    </div>
    <div class="log-lines"></div>
  </div>`;
}
function unitKeyOf(u) { return u.kind === 'minion' ? `A:${u.ownerId || ''}:${u.charId || u.summonerName}:minions` : u.side === 'A' ? `A:${u.ownerId || ''}:${u.charId || u.name}` : `B:${u.defId}#${u.uid}`; }

function currentMeter() {
  const k = shown();
  const b = battles[k];
  if (meterUI.scope === 'session') return meters[k].session;
  if (meterUI.scope === 'last') return meters[k].last || b?.meter || null;
  return b?.meter || meters[k].last || null;
}
function renderMeter() {
  const host = root?.querySelector('.meter-host');
  if (!host) return;
  if (document.activeElement?.tagName === 'SELECT' && host.contains(document.activeElement)) return; // don't close an open dropdown
  meterDirty = false;
  const scroll = host.querySelector('.meter-rows')?.scrollTop || 0;
  renderMeterPanel(host, currentMeter(), { myId: myId(), coop: shown() === 'coop', running: battles[shown()]?.state === 'running' });
  const rows = host.querySelector('.meter-rows');
  if (rows) rows.scrollTop = scroll;
}

// ------------------------------------------------------------------ rendering
// summoned minions: small cards under their summoner (health, statuses, time left)
function minionCard(m) {
  return `<div class="unit minion ally" data-uid="${m.uid}" ${tipAttr(`<b>${esc(m.name)}</b> · ${esc(m.summonerName || '')}'s minion<br>${esc(MINIONS[m.defId]?.description || '')}`)}>
    <div class="unit-art">${minionArt(m.defId, 'xs')}<div class="floaters"></div></div>
    <div class="unit-info"><div class="minion-name">${esc(m.name)} <span class="minion-exp"></span></div>
      <div class="bar hp"><div class="fill"></div><span class="bar-label"></span></div>
      <div class="unit-statuses"></div></div>
  </div>`;
}

function unitCard(u, k, minions = []) {
  const art = u.kind === 'enemy' ? enemyArt(u.defId, 'md') : portrait({ name: u.name, classId: u.classId, portrait: u.portrait }, 'md');
  const owner = k === 'coop' && u.ownerName ? `<small class="owner">${esc(u.ownerName)}</small>` : '';
  const tags = u.boss ? '<span class="tag boss">BOSS</span>' : u.tags?.includes('elite') ? '<span class="tag elite">ELITE</span>' : '';
  const abilities = u.side === 'A' ? `<div class="unit-abilities">${u.loadout.map(a => `<span class="cd-wrap" data-ab="${a}" ${tipAttr(`<b>${esc(ABILITIES[a]?.name)}</b><br>${esc(ABILITIES[a]?.description || '')}`)}>${abilityIcon(a, 'xs')}<span class="cd-overlay"></span><span class="cd-num"></span></span>`).join('')}</div>` : '';
  const res = u.resourceMax ? `<div class="bar res thin" style="--rc:${u.resourceColor}"><div class="fill"></div></div>` : '';
  const cls = u.classId ? CLASSES[u.classId] : null;
  return `<div class="unit ${u.side === 'A' ? 'ally' : 'foe'} ${u.boss ? 'boss' : ''} ${u.isMain ? 'main' : ''}" data-uid="${u.uid}">
    <div class="unit-art">${art}<div class="floaters"></div></div>
    <div class="unit-info">
      <div class="unit-name">${u.isMain ? '<span class="hero-star">★</span>' : ''}${esc(u.name)} <span class="muted">Lv ${u.level}${cls ? ' ' + esc(cls.name) : ''}</span> ${tags}${owner}</div>
      <div class="bar hp"><div class="fill"></div><span class="bar-label"></span></div>
      ${res}
      <div class="unit-statuses"></div>
      ${abilities}
    </div>
    ${minions.length ? `<div class="unit-minions">${minions.map(minionCard).join('')}</div>` : ''}
  </div>`;
}

function headerHtml(k, b) {
  const p = state.player;
  if (k === 'coop') {
    return `<div class="combat-title"><h2>${esc(b?.meta?.title || 'Co-op encounter')}</h2><span class="muted">${b?.meta?.players || ''} player(s) · Level ${b?.meta?.level || ''}</span></div>`;
  }
  const zone = ZONES[p.zone];
  const zones = Object.values(ZONES).sort((a, c) => a.order - c.order);
  if (b?.meta?.kind === 'rift' && b.state === 'running') {
    return `<div class="combat-title">
        <h2>🌀 ${esc(b.meta.title)}</h2>
        <span class="muted">${b.meta.affixes?.length ? b.meta.affixes.map(a => `<span class="affix-chip" ${tipAttr(`<b>${esc(AFFIXES[a]?.name)}</b><br>${esc(AFFIXES[a]?.description)}`)}>${AFFIXES[a]?.icon} ${esc(AFFIXES[a]?.name)}</span>`).join(' ') : 'No affixes'} · beat the clock: ${Math.floor(b.meta.timeLimit / 60)}:${String(b.meta.timeLimit % 60).padStart(2, '0')}</span>
      </div>
      <div class="combat-controls"><a class="btn" href="#/rifts">Rift details</a><button class="btn ghost danger" data-rift-stop>Abandon rift</button></div>`;
  }
  return `<div class="combat-title">
      <h2>${esc(b?.meta?.title || zone.name)}</h2>
      <span class="muted">${esc(zone.description)}</span>
    </div>
    <div class="combat-controls">
      <select data-zone aria-label="Zone">${zones.map(z => `<option value="${z.id}" ${z.id === p.zone ? 'selected' : ''} ${p.unlockedZones.includes(z.id) ? '' : 'disabled'}>${esc(z.name)} (Lv ${z.levelRange[0]}–${z.levelRange[1]})${p.unlockedZones.includes(z.id) ? '' : ' 🔒'}</option>`).join('')}</select>
      <button class="btn danger" data-boss ${tipAttr(`Challenge <b>${esc(ENEMIES[zone.boss].name)}</b>. Defeating the boss unlocks the next zone.`)}>☠ Challenge Boss</button>
    </div>`;
}

function build() {
  if (!root) return;
  const k = shown();
  const b = battles[k];
  if (!root.querySelector('.combat-bottom')) {
    root.innerHTML = `
      <div class="combat-header"></div>
      <div class="battlefield"></div>
      <div class="combat-bottom">
        <div class="panel meter-panel"><div class="meter-host"></div></div>
        ${logPanelHtml(b)}
      </div>
      <div class="panel results"><div class="panel-head"><h3>Recent fights</h3></div><div class="results-list"></div></div>`;
  }
  buildField();
  refreshSources();
  rebuildLog();
  renderMeter();
  renderResults();
  update();
}

// Header + battlefield only (used when units appear mid-fight)
function buildField() {
  if (!root) return;
  const k = shown();
  const b = battles[k];
  const zoneId = b?.meta?.zoneId || state.player?.zone;
  const bg = k === 'coop' ? backgroundStyle(`encounters/${b?.meta?.encounterId}`, 'zones/coop') : backgroundStyle(`zones/${zoneId}`);
  const allies = b ? [...b.units.values()].filter(u => u.side === 'A' && u.kind !== 'minion').sort((x, y) => x.position - y.position) : [];
  const minionsOf = u => (b ? [...b.units.values()].filter(m => m.kind === 'minion' && m.alive !== false && m.ownerUid === u.uid).sort((x, y) => x.uid - y.uid) : []);
  const foes = b ? [...b.units.values()].filter(u => u.side === 'B' && (u.alive || !u.summoned)).sort((x, y) => x.position - y.position) : [];
  const header = root.querySelector('.combat-header');
  if (document.activeElement?.closest?.('.combat-header') == null) header.innerHTML = headerHtml(k, b);
  const field = root.querySelector('.battlefield');
  field.setAttribute('style', bg);
  field.innerHTML = `
    <div class="bf-status"><span class="bf-wave"></span><span class="bf-time"></span></div>
    <div class="side allies">${allies.map(u => unitCard(u, k, minionsOf(u))).join('') || '<div class="muted center pad">Your party is resting…</div>'}</div>
    <div class="side enemies">${foes.map(u => unitCard(u, k)).join('')}</div>
    <div class="result-banner" hidden></div>`;
}

function refreshSources() {
  const sel = root?.querySelector('[data-log-source]');
  if (sel && document.activeElement !== sel) sel.innerHTML = sourceOptions(battles[shown()]);
}

function update() {
  const b = battles[shown()];
  if (!root || !b) return;
  root.querySelector('.bf-wave').textContent = b.waves > 1 ? `Wave ${b.wave}/${b.waves}` : '';
  const bt = root.querySelector('.bf-time');
  if (b.meta?.kind === 'rift' && b.meta.timeLimit) {
    const left = b.meta.timeLimit - b.time;
    bt.textContent = left >= 0 ? `⏱ ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')} left` : `⏱ +${Math.floor(-left)}s over time`;
    bt.classList.toggle('over', left < 0);
    bt.classList.toggle('hurry', left >= 0 && left < 30);
  } else { bt.textContent = `${Math.floor(b.time)}s`; bt.classList.remove('over', 'hurry'); }
  for (const u of b.units.values()) {
    const el = root.querySelector(`.unit[data-uid="${u.uid}"]`);
    if (!el) continue;
    el.classList.toggle('dead', !u.alive);
    const hpP = u.maxHp ? (u.hp / u.maxHp) * 100 : 0;
    const hp = el.querySelector('.bar.hp');
    hp.querySelector('.fill').style.width = hpP + '%';
    hp.classList.toggle('low', hpP < 30);
    hp.querySelector('.bar-label').textContent = `${fmt(u.hp)} / ${fmt(u.maxHp)}`;
    const res = el.querySelector('.bar.res .fill');
    if (res) res.style.width = (u.resourceMax ? (u.resource / u.resourceMax) * 100 : 0) + '%';
    const sig = (u.st || []).map(s => s[0] + s[2]).join(',');
    const stEl = el.querySelector('.unit-statuses');
    if (stEl.dataset.sig !== sig) {
      stEl.dataset.sig = sig;
      stEl.innerHTML = (u.st || []).map(([id, , stacks]) => `<span class="st" data-st="${id}">${statusIcon(id, 'xxs')}${stacks > 1 ? `<b>${stacks}</b>` : ''}<i></i></span>`).join('');
    }
    for (const [id, rem] of u.st || []) {
      const i = stEl.querySelector(`[data-st="${id}"] i`);
      if (i) i.textContent = rem > 99 ? '' : Math.ceil(rem);
    }
    if (u.exp != null) { const x = el.querySelector('.minion-exp'); if (x) x.textContent = `${Math.max(0, Math.ceil(u.exp - b.time))}s`; }
    if (u.side === 'A' && u.cd) {
      for (const [ab, rem] of Object.entries(u.cd)) {
        const w = el.querySelector(`.cd-wrap[data-ab="${ab}"]`);
        if (!w) continue;
        const total = ABILITIES[ab]?.cooldown || 1;
        w.querySelector('.cd-overlay').style.height = `${Math.min(100, (rem / total) * 100)}%`;
        w.querySelector('.cd-num').textContent = rem > 0 ? Math.ceil(rem) : '';
        w.classList.toggle('ready', rem <= 0);
      }
    }
  }
  updateActivity();
}

function floatEvent(ev) {
  if (!root) return;
  let text = null, cls = '';
  if (ev.type === 'damage') { text = fmt(ev.amount) + (ev.crit ? '!' : ''); cls = `dmg ${ev.crit ? 'crit' : ''} ${ev.dot ? 'dot' : ''}`; }
  else if (ev.type === 'heal' && ev.amount > 0) { text = '+' + fmt(ev.amount); cls = `heal ${ev.crit ? 'crit' : ''}`; }
  else if (ev.type === 'miss') { text = 'Dodge'; cls = 'miss'; }
  else if (ev.type === 'ability') {
    const el = root.querySelector(`.unit[data-uid="${ev.src}"]`);
    if (el) { el.classList.remove('acting'); void el.offsetWidth; el.classList.add('acting'); }
    const w = el?.querySelector(`.cd-wrap[data-ab="${ev.ability}"]`);
    if (w) { w.classList.remove('flash'); void w.offsetWidth; w.classList.add('flash'); }
    return;
  }
  if (!text) return;
  const host = root.querySelector(`.unit[data-uid="${ev.tgt}"] .floaters`);
  if (!host || host.childElementCount > 6) return;
  const s = document.createElement('span');
  s.className = `floater ${cls}`;
  s.textContent = text;
  s.style.left = `${20 + Math.random() * 50}%`;
  host.appendChild(s);
  if (ev.type === 'damage' && !ev.dot) {
    const card = host.closest('.unit');
    card.classList.remove('hit'); void card.offsetWidth; card.classList.add('hit');
  }
  setTimeout(() => s.remove(), 1300);
}

function showBanner(s) {
  const el = root?.querySelector('.result-banner');
  if (!el) return;
  el.hidden = false;
  el.className = `result-banner ${s.result}`;
  const riftLine = s.kind === 'rift' ? `<span>Rift tier ${s.tier}: ${Math.floor(s.time / 60)}:${String(s.time % 60).padStart(2, '0')} — ${s.timed ? '⏱ in time!' : s.result === 'victory' ? 'over time' : 'defeated'}${s.crystals ? ` · +${s.crystals} 💠` : ''}</span>` : '';
  el.innerHTML = s.result === 'victory'
    ? `<b>${s.kind === 'rift' ? (s.timed ? 'Rift timed!' : 'Rift cleared') : 'Victory'}</b>${riftLine}<span>+${fmt(s.xp)} XP · +${fmt(s.gold)} gold${s.items?.length ? ` · ${s.items.length} loot` : ''}</span>`
    : `<b>Defeat</b>${riftLine}<span>Tip: click an enemy to see its abilities in the Bestiary, then adjust behaviour, gear or party.</span>`;
  setTimeout(() => { if (el.isConnected) el.hidden = true; }, s.kind === 'rift' ? 5000 : 2200);
}

function renderResults() {
  const el = root?.querySelector('.results-list');
  if (!el) return;
  const list = [...results.coop, ...results.solo].sort((a, b) => b.at - a.at).slice(0, 8);
  el.innerHTML = list.length ? list.map(r => `<div class="result-row ${r.result}">
      <div><b>${r.result === 'victory' ? 'Victory' : 'Defeat'}</b> <span class="muted small">${esc(r.title || '')}</span></div>
      ${r.result === 'victory' ? `<div class="small"><span class="xp-text">+${fmt(r.xp)} XP</span> · <span class="gold-text">+${fmt(r.gold)}g</span>
        ${(r.items || []).map(i => `<div class="rarity-text rarity-${i.rarity}">${esc(i.name)}</div>`).join('')}
        ${r.sold ? `<div class="muted">${r.sold} item(s) auto-sold/salvaged</div>` : ''}
        ${(r.levelUps || []).map(l => `<div class="lvlup">▲ ${esc(l.name)} → Lv ${l.level}</div>`).join('')}</div>` : ''}
    </div>`).join('') : '<div class="muted small">No fights yet.</div>';
}

// ------------------------------------------------------------------ view
export const combatView = {
  id: 'combat', label: 'Combat', icon: '⚔',
  mount(el) {
    root = el;
    const changed = () => { saveFilter(filter); rebuildLog(); };
    el.addEventListener('change', async e => {
      const t = e.target;
      if (t.matches('[data-zone]')) await run(act('set_zone', { zoneId: t.value }));
      else if (t.matches('[data-log-source]')) { filter.source = t.value; changed(); }
      else if (t.matches('[data-crits]')) { filter.critsOnly = t.checked; changed(); }
      else if (t.matches('[data-autoscroll]')) { filter.autoscroll = t.checked; saveFilter(filter); }
      else if (t.matches('[data-min]')) { filter.minAmount = Math.max(0, Number(t.value) || 0); changed(); }
      else if (t.matches('[data-meter-scope]')) { meterUI.scope = t.value; renderMeter(); }
      else if (t.matches('[data-meter-side]')) { meterUI.side = t.value; renderMeter(); }
    });
    el.addEventListener('input', e => {
      if (e.target.matches('[data-log-search]')) { filter.search = e.target.value.trim().toLowerCase(); rebuildLog(); }
    });
    el.addEventListener('click', async e => {
      if (e.target.closest('[data-boss]')) { await run(act('challenge_boss', { zoneId: state.player.zone }), 'Boss challenge accepted!'); return; }
      if (e.target.closest('[data-rift-stop]')) { await run(act('rift_stop'), 'Rift abandoned.'); return; }
      const foe = e.target.closest('.unit.foe');
      if (foe && !e.target.closest('button')) {
        const u = battles[shown()]?.units.get(Number(foe.dataset.uid));
        if (u) openBestiary(u.defId);
        return;
      }
      const cat = e.target.closest('[data-cat]');
      if (cat) {
        filter.cats[cat.dataset.cat] = !filter.cats[cat.dataset.cat];
        cat.classList.toggle('on', filter.cats[cat.dataset.cat]);
        changed();
        return;
      }
      const pre = e.target.closest('[data-preset]');
      if (pre) {
        const cats = PRESETS[pre.dataset.preset].cats;
        for (const c of Object.keys(filter.cats)) filter.cats[c] = cats.includes(c);
        filter.critsOnly = false; filter.minAmount = 0; filter.source = 'all'; filter.search = '';
        saveFilter(filter);
        const host = root.querySelector('.combat-log');
        host.outerHTML = logPanelHtml(battles[shown()]);
        rebuildLog();
        return;
      }
      const mode = e.target.closest('[data-meter-mode]');
      if (mode) { meterUI.mode = mode.dataset.meterMode; renderMeter(); return; }
      const row = e.target.closest('[data-meter-unit]');
      if (row) { meterUI.selected = meterUI.selected === row.dataset.meterUnit ? null : row.dataset.meterUnit; renderMeter(); return; }
      if (e.target.closest('[data-meter-reset]')) { meters[shown()].session = createMeter('Session'); renderMeter(); return; }
      if (e.target.closest('[data-meter-close]')) { meterUI.selected = null; renderMeter(); }
    });
    meterTimer = setInterval(() => { if (meterDirty && root) renderMeter(); }, 500);
    build();
  },
  unmount() { root = null; clearInterval(meterTimer); },
  render() {
    // Only the header depends on player state; units update via battle ticks.
    const h = root?.querySelector('.combat-header');
    if (h && document.activeElement?.tagName !== 'SELECT') h.innerHTML = headerHtml(shown(), battles[shown()]);
    renderResults();
  },
};

export { rarityById };
