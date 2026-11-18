// Rifts: timed, endlessly scaling dungeon runs with weekly affixes and a leaderboard.
import { state, hero } from '../state.js';
import { act } from '../net.js';
import { esc, fmt, run, duration, toast, tipAttr, botTag } from '../ui.js';
import { enemyArt } from '../assets.js';
import { openInspect } from '../inspect.js';
import { ZONES } from '/shared/data/zones.js';
import { ENEMIES } from '/shared/data/enemies.js';
import { RIFT, AFFIXES, weeklyAffixes, weekEndsAt, affixesFor, maxStartTier, riftThemes, riftScale, riftChest, firstClearCrystals, riftRewardOptions, riftCleared, repeatXpGold, riftLevel } from '/shared/rifts.js';
import { openBestiary } from './bestiary.js';

const ui = { tier: null, theme: '' };
let board = null;
let boardAt = 0;
let timer = null;
const now = () => Date.now() + (state.timeOffset || 0);
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

async function loadBoard(root) {
  if (Date.now() - boardAt < 20000) return;
  boardAt = Date.now();
  try { board = await act('get_rankings', { category: 'rift', limit: 10 }); } catch { /* ignore */ }
  const el = root.querySelector('.rift-board');
  if (el) el.innerHTML = boardHtml();
}

function boardHtml() {
  if (!board) return '<p class="muted small">Loading…</p>';
  const rows = board.rows.filter(r => r.value !== '—');
  return rows.length ? `<table class="rank-table compact"><tbody>${rows.map(r => `<tr class="${r.id === state.player.id ? 'me' : ''}" data-inspect="${esc(r.name)}"><td class="rank-no">${r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}</td><td><b>${esc(r.name)}</b>${botTag(r)} <span class="muted small">${esc(r.hero.name)}</span></td><td class="num"><b>${esc(r.value)}</b></td></tr>`).join('')}</tbody></table>`
    : '<p class="muted small">Nobody has timed a rift yet — be the first!</p>';
}

function liveHtml() {
  const b = state.battles.solo;
  if (!b || b.meta?.kind !== 'rift' || b.state !== 'running') return '';
  const over = b.time > b.meta.timeLimit;
  return `<div class="rift-live ${over ? 'over' : ''}">
    <div><b>${esc(b.meta.title)}</b> <span class="muted">· wave ${b.wave}/${b.waves}</span></div>
    <div class="rift-clock" data-rift-clock>${mmss(b.time)} <span class="muted">/ ${mmss(b.meta.timeLimit)}</span></div>
    <div class="bar thin"><div class="fill" style="width:${Math.min(100, b.time / b.meta.timeLimit * 100)}%"></div></div>
    <div class="row gap"><a class="btn small" href="#/combat">Watch the fight</a><button class="btn small ghost danger" data-rift-stop>Abandon</button></div>
  </div>`;
}

function html() {
  const p = state.player;
  const h = hero();
  const r = p.rift || { best: 0, bestTimes: {}, history: [] };
  const max = maxStartTier(p);
  if (ui.tier == null || ui.tier > max) ui.tier = max;
  const themes = riftThemes(p);
  const week = weeklyAffixes(now());
  const active = affixesFor(ui.tier, now());
  const sc = riftScale(ui.tier);
  const chest = riftChest(ui.tier);
  const opts = riftRewardOptions(ui.tier, true);
  const running = state.battles.solo?.meta?.kind === 'rift' && state.battles.solo.state === 'running';
  const locked = h.level < RIFT.minLevel;
  const firstClear = ui.tier > (r.best || 0);
  return `<div class="rift-layout">
    <section class="panel rift-start">
      <div class="panel-head"><h3>🌀 Rifts</h3><span class="muted small">Best timed: <b>${r.best ? `Tier ${r.best}${r.bestTimes?.[r.best] ? ` (${mmss(r.bestTimes[r.best])})` : ''}` : '—'}</b></span></div>
      <p class="muted small">Fight through ${RIFT.trashWaves} waves and a Rift Guardian before the clock runs out (<b>${mmss(RIFT.timeLimit)}</b>). Health carries over between waves. Finish in time to unlock the next tier. Rifts use your active party. Every tier has stronger enemies — tier 1 starts easy and there is no top: past the level cap they just keep growing.</p>
      ${locked ? `<p class="warn-text">🔒 Rifts open at hero level ${RIFT.minLevel}.</p>` : `
      <div class="rift-form">
        <label>Tier <select data-rift-tier>${Array.from({ length: Math.min(max, 250) }, (_, i) => max - i).map(t => `<option value="${t}" ${t === ui.tier ? 'selected' : ''}>Tier ${t}${r.bestTimes?.[t] ? ` · best ${mmss(r.bestTimes[t])}` : t > (r.best || 0) ? ' · new!' : ''}${riftCleared(state.player, t) ? '' : ' · XP & gold'}</option>`).join('')}</select></label>
        <label>Theme <select data-rift-theme><option value="">🎲 Random</option>${themes.map(z => `<option value="${z}" ${ui.theme === z ? 'selected' : ''}>${esc(ZONES[z].name)} — ${esc(ENEMIES[ZONES[z].boss].name)}</option>`).join('')}</select></label>
        <label>After a run <select data-rift-auto>${[['off', 'Return to idle farming'], ['repeat', 'Repeat the same tier (loot only)'], ['push', 'Push: next tier if timed']].map(([v, l]) => `<option value="${v}" ${r.auto === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <div class="rift-preview">
        <div class="stat-row"><span>Enemy level</span><b class="${riftLevel(ui.tier) > h.level + 2 ? 'warn-text' : ''}">${riftLevel(ui.tier)}${riftLevel(ui.tier) > h.level ? ` <span class="muted small">(your hero: ${h.level})</span>` : ''}</b></div>
        <div class="stat-row"><span>Enemy health</span><b>×${sc.hp.toFixed(2)}</b></div>
        <div class="stat-row"><span>Enemy damage</span><b>×${sc.damage.toFixed(2)}</b></div>
        ${riftCleared(state.player, ui.tier)
          ? `<div class="stat-row"><span>XP & gold</span><b class="muted" ${tipAttr('XP and gold are paid only the first time you clear a tier. Loot, the chest and crystals still work as usual.')}>${repeatXpGold() > 0 ? `×${(opts.rewardMult * repeatXpGold()).toFixed(2)} (already cleared)` : 'none — already cleared'}</b></div>`
          : `<div class="stat-row"><span>XP & gold <span class="tag">first clear</span></span><b>×${opts.rewardMult.toFixed(2)}</b></div>`}
        <div class="stat-row"><span>Timed chest</span><b><span class="rarity-text rarity-${chest.minRarity}">${chest.count}× ${chest.minRarity}+</span></b></div>
        ${firstClear ? `<div class="stat-row"><span>First timed clear</span><b class="premium-text">+${firstClearCrystals(ui.tier)} 💠</b></div>` : ''}
        <div class="stat-row"><span>Affixes</span><b>${active.length ? active.map(a => `<span ${tipAttr(`<b>${esc(AFFIXES[a].name)}</b><br>${esc(AFFIXES[a].description)}`)}>${AFFIXES[a].icon} ${esc(AFFIXES[a].name)}</span>`).join(', ') : 'none'}</b></div>
      </div>
      <div class="row end gap">${running ? '<button class="btn danger" data-rift-stop>Abandon run</button>' : `<button class="btn primary" data-rift-start>Enter Rift (Tier ${ui.tier})</button>`}</div>`}
      <div data-rift-live>${liveHtml()}</div>
      <p class="faint small">XP and gold are paid <b>once per tier</b>, the first time you clear it (in full, even over time); repeating a tier only gives loot. Not timed? No chest and no tier unlock. A wipe ends the run with no rewards.</p>
    </section>

    <section class="panel">
      <div class="panel-head"><h3>This week's affixes</h3><span class="muted small">Change in ${duration((weekEndsAt(now()) - now()) / 1000)}</span></div>
      ${week.map((a, i) => `<div class="affix ${ui.tier >= RIFT.affixTiers[i] ? 'on' : ''}"><div class="affix-icon">${AFFIXES[a].icon}</div><div class="grow"><b>${esc(AFFIXES[a].name)}</b> <span class="tag">Tier ${RIFT.affixTiers[i]}+</span><div class="small muted">${esc(AFFIXES[a].description)}</div></div></div>`).join('')}
      <p class="faint small">Everyone faces the same affixes this week, so the leaderboard is fair. Check the Bestiary to see what each Rift Guardian does.</p>
      <div class="rift-guardians">${themes.map(z => `<button class="guardian" data-guardian="${ZONES[z].boss}" ${tipAttr(`Look up ${esc(ENEMIES[ZONES[z].boss].name)} in the Bestiary`)}>${enemyArt(ZONES[z].boss, 'sm')}<span class="small">${esc(ENEMIES[ZONES[z].boss].name)}</span></button>`).join('')}</div>
    </section>

    <section class="panel">
      <h3>🏆 Rift leaderboard</h3>
      <div class="rift-board">${boardHtml()}</div>
      <a class="small" href="#/rankings">Full rankings →</a>
    </section>

    <section class="panel">
      <h3>Your recent runs <span class="muted small">${fmt(r.runs || 0)} runs · ${fmt(r.timed || 0)} timed</span></h3>
      ${(r.history || []).length ? `<table class="rift-history"><thead><tr><th>Tier</th><th>Rift</th><th>Time</th><th>Result</th></tr></thead><tbody>${r.history.map(x => `<tr class="${x.timed ? 'good' : x.result === 'victory' ? '' : 'bad'}">
        <td><b>${x.tier}</b></td><td>${esc(ZONES[x.theme]?.name || '')} <span class="muted small">${(x.affixes || []).map(a => AFFIXES[a]?.icon || '').join('')}</span></td>
        <td>${mmss(x.time)}</td><td>${x.timed ? '⏱ Timed' : x.result === 'victory' ? 'Over time' : '✗ Defeated'}</td></tr>`).join('')}</tbody></table>` : '<p class="muted small">No runs yet.</p>'}
    </section>
  </div>`;
}

export const riftsView = {
  id: 'rifts', label: 'Rifts', icon: '🌀',
  mount(root) {
    board = null; boardAt = 0;
    root.addEventListener('change', async e => {
      const t = e.target;
      if (t.matches('[data-rift-tier]')) { ui.tier = Number(t.value); this.render(root); }
      if (t.matches('[data-rift-theme]')) ui.theme = t.value;
      if (t.matches('[data-rift-auto]')) await run(act('rift_settings', { auto: t.value }));
    });
    root.addEventListener('click', async e => {
      if (e.target.closest('[data-rift-start]')) {
        const r = await run(act('rift_start', { tier: ui.tier, theme: ui.theme || null }));
        if (r) { toast(`Entering Rift Tier ${r.tier}: ${ZONES[r.theme].name}…`, 'success'); location.hash = '#/combat'; }
        return;
      }
      if (e.target.closest('[data-rift-stop]')) { await run(act('rift_stop'), 'Rift abandoned.'); return; }
      const g = e.target.closest('[data-guardian]');
      if (g) { openBestiary(g.dataset.guardian); return; }
      const ins = e.target.closest('[data-inspect]');
      if (ins) openInspect(ins.dataset.inspect);
    });
    timer = setInterval(() => {
      const el = root.querySelector('[data-rift-live]');
      if (el) el.innerHTML = liveHtml();
    }, 500);
  },
  unmount() { clearInterval(timer); },
  render(root) {
    if (document.activeElement?.tagName === 'SELECT' && root.contains(document.activeElement)) return;
    root.innerHTML = html();
    loadBoard(root);
  },
};
