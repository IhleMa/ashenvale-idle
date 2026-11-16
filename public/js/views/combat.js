// Combat view: live, server-driven battle display (presentation only — all math happens on the server).
import { bus, state } from '../state.js';
import { act } from '../net.js';
import { esc, fmt, run, tipAttr } from '../ui.js';
import { portrait, enemyArt, abilityIcon, statusIcon, backgroundStyle } from '../assets.js';
import { ABILITIES } from '/shared/data/abilities.js';
import { STATUSES } from '/shared/data/statuses.js';
import { ZONES, COOP_ENCOUNTERS } from '/shared/data/zones.js';
import { ENEMIES } from '/shared/data/enemies.js';
import { CLASSES } from '/shared/data/classes.js';
import { rarityById } from '/shared/config.js';

const battles = { solo: null, coop: null };
const results = { solo: [], coop: [] };
let root = null;
let logFilter = 'all';
const MAX_LOG = 160;

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
  battles[m.k].log = prevLog.slice(-40);
  addLog(battles[m.k], `<span class="log-sep">— ${esc(m.battle.meta?.title || 'Battle')} —</span>`, 'sep');
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
  for (const ev of m.e) {
    if (ev.type === 'spawn') { b.units.set(ev.unit.uid, ev.unit); structural = true; }
    if (ev.type === 'wave') {
      for (const [uid, u] of b.units) if (u.side === 'B' && !u.alive) b.units.delete(uid);
      for (const u of ev.units) b.units.set(u.uid, u);
      structural = true;
    }
    logEvent(b, ev);
    if (visible && !structural) floatEvent(ev);
  }
  if (visible) { if (structural) build(); else update(); }
});
bus.on('msg:battle_end', m => {
  const b = battles[m.k];
  const s = m.summary;
  results[m.k].unshift({ ...s, at: Date.now(), title: b?.meta?.title });
  results[m.k].length = Math.min(results[m.k].length, 8);
  if (b) {
    b.state = s.result;
    if (s.result === 'victory') {
      const items = s.items?.length ? ` · ${s.items.length} item${s.items.length > 1 ? 's' : ''}` : '';
      addLog(b, `<span class="log-win">Victory! +${fmt(s.xp)} XP, +${fmt(s.gold)} gold${items}</span>`, 'important');
    } else addLog(b, `<span class="log-loss">Defeat… your party regroups.</span>`, 'important');
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
function nameOf(b, uid) {
  const u = b.units.get(uid);
  if (!u) return '?';
  return `<span class="log-name ${u.side === 'A' ? 'ally' : 'foe'}">${esc(u.name)}</span>`;
}
function addLog(b, html, kind = 'detail') {
  b.log.push({ html, kind, t: b.time });
  if (b.log.length > MAX_LOG) b.log.splice(0, b.log.length - MAX_LOG);
  if (root && battles[shown()] === b) appendLogLine(b.log[b.log.length - 1]);
}
function logEvent(b, ev) {
  const ab = ev.ability ? ABILITIES[ev.ability]?.name : null;
  switch (ev.type) {
    case 'ability': {
      const a = ABILITIES[ev.ability];
      if (a && a.effects.some(e => e.kind === 'damage' || e.kind === 'heal')) return; // the hit/heal lines describe these
      const tg = ev.tgts.length > 1 ? 'the party' : nameOf(b, ev.tgts[0]);
      addLog(b, `${nameOf(b, ev.src)} uses <b>${esc(a?.name)}</b>${ev.tgts[0] === ev.src ? '' : ` on ${tg}`}.`, 'ability');
      break;
    }
    case 'damage': {
      const how = ev.dot ? `${esc(STATUSES[ev.dot]?.name)} deals` : ab ? `<b>${esc(ab)}</b> hits` : 'hits';
      const crit = ev.crit ? ' <span class="log-crit">CRIT!</span>' : '';
      const abs = ev.absorbed ? ` <span class="muted">(${fmt(ev.absorbed)} absorbed)</span>` : '';
      addLog(b, `${ev.dot ? '' : nameOf(b, ev.src) + "'s "}${how} ${nameOf(b, ev.tgt)} for <span class="log-dmg">${fmt(ev.amount)}</span>${crit}${abs}`, ev.dot ? 'dot' : ab ? 'ability' : 'detail');
      break;
    }
    case 'heal':
      if (ev.amount <= 0) return;
      addLog(b, `${nameOf(b, ev.src)}'s ${ev.hot ? esc(STATUSES[ev.hot]?.name) : `<b>${esc(ab || 'heal')}</b>`} heals ${nameOf(b, ev.tgt)} for <span class="log-heal">${fmt(ev.amount)}</span>${ev.crit ? ' <span class="log-crit">CRIT!</span>' : ''}`, ev.hot ? 'dot' : 'ability');
      break;
    case 'miss': addLog(b, `${nameOf(b, ev.tgt)} dodges ${nameOf(b, ev.src)}'s attack.`, 'detail'); break;
    case 'death': addLog(b, `<span class="log-death">☠ ${nameOf(b, ev.tgt)} has fallen.</span>`, 'important'); break;
    case 'phase': addLog(b, `<span class="log-phase">⚠ ${esc(ev.message)}</span>`, 'important'); break;
    case 'spawn': addLog(b, `${esc(ev.unit.name)} joins the fight!`, 'important'); break;
    case 'wave': if (ev.total > 1) addLog(b, `<span class="log-phase">Wave ${ev.wave} of ${ev.total}</span>`, 'important'); break;
    case 'cleanse': addLog(b, `${nameOf(b, ev.src)} removes ${esc(STATUSES[ev.status]?.name)} from ${nameOf(b, ev.tgt)}.`, 'ability'); break;
    default: break;
  }
}
const FILTERS = { all: () => true, abilities: k => k !== 'detail' && k !== 'dot', important: k => k === 'important' || k === 'sep' };
function appendLogLine(entry) {
  const el = root?.querySelector('.combat-log .log-lines');
  if (!el || !FILTERS[logFilter](entry.kind)) return;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  const d = document.createElement('div');
  d.className = `log-line k-${entry.kind}`;
  d.innerHTML = `<span class="log-t">${entry.t.toFixed(1)}</span> ${entry.html}`;
  el.appendChild(d);
  while (el.children.length > MAX_LOG) el.firstChild.remove();
  if (atBottom) el.scrollTop = el.scrollHeight;
}

// ------------------------------------------------------------------ rendering
function unitCard(u, k) {
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
  </div>`;
}

function headerHtml(k, b) {
  const p = state.player;
  if (k === 'coop') {
    return `<div class="combat-title"><h2>${esc(b?.meta?.title || 'Co-op encounter')}</h2><span class="muted">${b?.meta?.players || ''} player(s) · Level ${b?.meta?.level || ''}</span></div>`;
  }
  const zone = ZONES[p.zone];
  const zones = Object.values(ZONES).sort((a, c) => a.order - c.order);
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
  const zoneId = b?.meta?.zoneId || state.player?.zone;
  const bg = k === 'coop' ? backgroundStyle(`encounters/${b?.meta?.encounterId}`, 'zones/coop') : backgroundStyle(`zones/${zoneId}`);
  const allies = b ? [...b.units.values()].filter(u => u.side === 'A').sort((x, y) => x.position - y.position) : [];
  const foes = b ? [...b.units.values()].filter(u => u.side === 'B' && (u.alive || !u.summoned)).sort((x, y) => x.position - y.position) : [];
  root.innerHTML = `
    <div class="combat-header">${headerHtml(k, b)}</div>
    <div class="battlefield" style="${bg}">
      <div class="bf-status"><span class="bf-wave"></span><span class="bf-time"></span></div>
      <div class="side allies">${allies.map(u => unitCard(u, k)).join('') || '<div class="muted center pad">Your party is resting…</div>'}</div>
      <div class="side enemies">${foes.map(u => unitCard(u, k)).join('')}</div>
      <div class="result-banner" hidden></div>
    </div>
    <div class="combat-bottom">
      <div class="panel combat-log">
        <div class="panel-head"><h3>Combat log</h3>
          <select data-log-filter>${[['all', 'Everything'], ['abilities', 'Abilities & events'], ['important', 'Key events only']].map(([v, l]) => `<option value="${v}" ${v === logFilter ? 'selected' : ''}>${l}</option>`).join('')}</select>
        </div>
        <div class="log-lines"></div>
      </div>
      <div class="panel results"><div class="panel-head"><h3>Recent fights</h3></div><div class="results-list"></div></div>
    </div>`;
  const lines = root.querySelector('.log-lines');
  if (b) for (const e of b.log) if (FILTERS[logFilter](e.kind)) {
    const d = document.createElement('div');
    d.className = `log-line k-${e.kind}`;
    d.innerHTML = `<span class="log-t">${e.t.toFixed(1)}</span> ${e.html}`;
    lines.appendChild(d);
  }
  lines.scrollTop = lines.scrollHeight;
  renderResults();
  update();
}

function update() {
  const b = battles[shown()];
  if (!root || !b) return;
  root.querySelector('.bf-wave').textContent = b.waves > 1 ? `Wave ${b.wave}/${b.waves}` : '';
  root.querySelector('.bf-time').textContent = `${Math.floor(b.time)}s`;
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
  el.innerHTML = s.result === 'victory'
    ? `<b>Victory</b><span>+${fmt(s.xp)} XP · +${fmt(s.gold)} gold${s.items?.length ? ` · ${s.items.length} loot` : ''}</span>`
    : `<b>Defeat</b><span>Tip: adjust ability behaviour, gear or party composition.</span>`;
  setTimeout(() => { if (el.isConnected) el.hidden = true; }, 2200);
}

function renderResults() {
  const el = root?.querySelector('.results-list');
  if (!el) return;
  const list = [...results.coop, ...results.solo].sort((a, b) => b.at - a.at).slice(0, 8);
  el.innerHTML = list.length ? list.map(r => `<div class="result-row ${r.result}">
      <div><b>${r.result === 'victory' ? 'Victory' : 'Defeat'}</b> <span class="muted small">${esc(r.title || '')}</span></div>
      ${r.result === 'victory' ? `<div class="small"><span class="xp-text">+${fmt(r.xp)} XP</span> · <span class="gold-text">+${fmt(r.gold)}g</span>
        ${(r.items || []).map(i => `<div class="rarity-text rarity-${i.rarity}">${esc(i.name)}</div>`).join('')}
        ${r.sold ? `<div class="muted">${r.sold} item(s) auto-sold</div>` : ''}
        ${(r.levelUps || []).map(l => `<div class="lvlup">▲ ${esc(l.name)} → Lv ${l.level}</div>`).join('')}</div>` : ''}
    </div>`).join('') : '<div class="muted small">No fights yet.</div>';
}

// ------------------------------------------------------------------ view
export const combatView = {
  id: 'combat', label: 'Combat', icon: '⚔',
  mount(el) {
    root = el;
    el.addEventListener('change', async e => {
      if (e.target.matches('[data-zone]')) await run(act('set_zone', { zoneId: e.target.value }));
      if (e.target.matches('[data-log-filter]')) { logFilter = e.target.value; build(); }
    });
    el.addEventListener('click', async e => {
      if (e.target.closest('[data-boss]')) await run(act('challenge_boss', { zoneId: state.player.zone }), 'Boss challenge accepted!');
    });
    build();
  },
  unmount() { root = null; },
  render() {
    // Only the header depends on player state; units update via battle ticks.
    const h = root?.querySelector('.combat-header');
    if (h && document.activeElement?.tagName !== 'SELECT') h.innerHTML = headerHtml(shown(), battles[shown()]);
    renderResults();
  },
};

export { rarityById };
