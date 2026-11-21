// Daily & weekly quests.
import { morphed } from '../morph.js';
import { state } from '../state.js';
import { act } from '../net.js';
import { esc, fmt, bar, run, duration, toast, tipAttr, confirmBox } from '../ui.js';
import { materialIcon } from '../assets.js';
import { MATERIALS } from '/shared/data/town.js';
import { QUEST_TYPES, QUEST_CONFIG, questTitle, nextDailyReset, nextWeeklyReset } from '/shared/quests.js';

const now = () => Date.now() + (state.timeOffset || 0);
let timer = null;

export function questsReady(p) {
  const q = p?.quests;
  if (!q) return 0;
  const all = [...(q.daily || []), ...(q.weekly || [])];
  return all.filter(x => !x.claimed && x.progress >= x.target).length + (!q.bonusClaimed && q.daily?.length && q.daily.every(x => x.claimed) ? 1 : 0);
}

function rewardHtml(r) {
  const parts = [];
  if (r.gold) parts.push(`<span class="gold-text">${fmt(r.gold)}g</span>`);
  if (r.xpKills) parts.push('<span class="xp-text">XP</span>');
  if (r.crystals) parts.push(`<span class="premium-text">${r.crystals} 💠</span>`);
  for (const [m, n] of Object.entries(r.materials || {})) parts.push(`<span class="mat-chip">${materialIcon(m, 'xxs')} ${n} ${esc(MATERIALS[m]?.name || m)}</span>`);
  if (r.item) parts.push(`<span class="rarity-text rarity-${r.item}">${r.item[0].toUpperCase() + r.item.slice(1)} item</span>`);
  return parts.join(' · ');
}

function questCard(q, id, kind) {
  const t = QUEST_TYPES[q.type];
  const done = q.progress >= q.target;
  const rerollCost = (state.player.quests.rerolls || 0) < QUEST_CONFIG.freeRerollsPerDay ? 0 : QUEST_CONFIG.rerollCost;
  return `<div class="quest ${q.claimed ? 'claimed' : done ? 'ready' : ''}">
    <div class="quest-icon">${t.icon}</div>
    <div class="grow">
      <div class="quest-title"><b>${esc(questTitle(q))}</b>${t.hint ? ` <span class="muted small" ${tipAttr(esc(t.hint))}>ⓘ</span>` : ''}</div>
      ${bar(q.progress, q.target, 'thin quest-bar', `${fmt(q.progress)} / ${fmt(q.target)}`)}
      <div class="small quest-reward">Reward: ${rewardHtml(q.reward)}</div>
    </div>
    <div class="quest-actions">
      ${q.claimed ? '<span class="tag done">✓ Done</span>'
        : done ? `<button class="btn primary small" data-claim="${id}">Claim</button>`
        : kind === 'daily' ? `<button class="btn ghost tiny" data-reroll="${id}" data-cost="${rerollCost}" ${tipAttr(rerollCost ? `Swap for a different quest (${rerollCost} 💠)` : 'Swap for a different quest (free once per day)')}>⟳ ${rerollCost ? rerollCost + ' 💠' : 'Free'}</button>` : ''}
    </div>
  </div>`;
}

function html() {
  const p = state.player;
  const q = p.quests;
  if (!q?.daily) return '<section class="panel"><p class="muted">Quests appear once you have created your hero.</p></section>';
  const dailyDone = q.daily.filter(x => x.claimed).length;
  const ready = questsReady(p);
  return `<div class="quests-layout">
    <section class="panel">
      <div class="panel-head"><h3>📜 Daily quests</h3><span class="muted small">New quests in <b data-reset-daily>${duration((nextDailyReset(now()) - now()) / 1000)}</b></span></div>
      ${q.daily.map((x, i) => questCard(x, `daily-${i}`, 'daily')).join('')}
      <div class="quest bonus ${q.bonusClaimed ? 'claimed' : dailyDone === q.daily.length ? 'ready' : ''}">
        <div class="quest-icon">🎁</div>
        <div class="grow"><b>Daily chest</b> <span class="muted small">— finish all ${q.daily.length} daily quests</span>
          ${bar(dailyDone, q.daily.length, 'thin quest-bar', `${dailyDone} / ${q.daily.length}`)}
          <div class="small quest-reward">Reward: <span class="premium-text">${QUEST_CONFIG.allDailiesCrystals} 💠</span> · <span class="rarity-text rarity-rare">Rare item</span></div></div>
        <div class="quest-actions">${q.bonusClaimed ? '<span class="tag done">✓ Done</span>' : dailyDone === q.daily.length ? '<button class="btn primary small" data-claim="bonus">Open</button>' : ''}</div>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><h3>🗓 Weekly quests</h3><span class="muted small">Resets in <b data-reset-weekly>${duration((nextWeeklyReset(now()) - now()) / 1000)}</b></span></div>
      ${q.weekly.map((x, i) => questCard(x, `weekly-${i}`, 'weekly')).join('')}
      <div class="row end gap">${ready ? `<button class="btn primary" data-claim="all">Claim all (${ready})</button>` : ''}</div>
      <p class="muted small">Quests progress automatically — including fights your party wins while you're offline. Kills from your active party, co-op encounters and rifts all count.
      ${QUEST_CONFIG.freeRerollsPerDay} daily quest swap per day is free; after that a swap costs ${QUEST_CONFIG.rerollCost} 💠. Quests reset at ${String(QUEST_CONFIG.resetHourUtc).padStart(2, '0')}:00 UTC.</p>
      <div class="stat-row"><span>Quests completed</span><b>${fmt(p.stats.questsDone || 0)}</b></div>
    </section>
  </div>`;
}

export const questsView = {
  id: 'quests', label: 'Quests', icon: '📜',
  mount(root) {
    root.addEventListener('click', async e => {
      const c = e.target.closest('[data-claim]');
      if (c) {
        c.disabled = true;
        const r = await run(act('quest_claim', { id: c.dataset.claim }));
        if (r) toast(`Reward: +${fmt(r.gold)} gold${r.xp ? ` · +${fmt(r.xp)} XP` : ''}${r.crystals ? ` · +${r.crystals} 💠` : ''}${r.items?.length ? ` · ${r.items.map(i => i.name).join(', ')}` : ''}`, 'success', 6000);
        return;
      }
      const rr = e.target.closest('[data-reroll]');
      if (rr) {
        const cost = Number(rr.dataset.cost);
        if (cost && !(await confirmBox(`Swap this quest for ${cost} Ashen Crystals?`, `Swap (${cost} 💠)`))) return;
        await run(act('quest_reroll', { id: rr.dataset.reroll, maxCost: cost }), 'Quest swapped.');
      }
    });
    timer = setInterval(() => {
      const d = root.querySelector('[data-reset-daily]'), w = root.querySelector('[data-reset-weekly]');
      if (d) d.textContent = duration((nextDailyReset(now()) - now()) / 1000);
      if (w) w.textContent = duration((nextWeeklyReset(now()) - now()) / 1000);
    }, 1000);
  },
  unmount() { clearInterval(timer); },
  render(root) { morphed(root).innerHTML = html(); },
};
