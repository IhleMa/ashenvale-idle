// New-player tutorial: a guide card that walks through the steps of content/tutorial.json, highlights
// what to click, and hides pages that haven't been introduced yet. Progress is counted by the server
// (server/tutorialLogic.js); this only shows it.
import { state } from './state.js';
import { act } from './net.js';
import { esc, confirmBox, toast } from './ui.js';
import { currentStep, stepProgress, visibleViews, tutorialSteps, stepText } from '/shared/tutorial.js';

let card = null;
let ctx = { currentView: () => null, viewLabel: id => id };
let minimized = false;
try { minimized = localStorage.getItem('tutorialMin') === '1'; } catch { /* storage unavailable */ }
let lastStepId = null;
let busy = false;

// pages the menu shows right now
export function isViewVisible(viewId) {
  const p = state.player;
  if (!p) return true;
  const set = visibleViews(p);
  return !set || set.has(viewId);
}
export function visibleKey() {
  const p = state.player;
  const set = p && visibleViews(p);
  return set ? [...set].sort().join(',') : '*';
}

const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

function rewardText(step) {
  if (step.rewardText) return step.rewardText;
  const r = step.reward;
  if (!r) return '';
  const parts = [];
  if (r.gold) parts.push(`${r.gold} gold`);
  if (r.premium) parts.push(`${r.premium} 💠`);
  if (r.xp) parts.push(`${r.xp} XP`);
  if (r.materials && Object.keys(r.materials).length) parts.push('materials');
  return parts.join(', ');
}

export function initTutorial(options) {
  ctx = { ...ctx, ...options };
  card = document.createElement('div');
  card.id = 'tutorial';
  card.hidden = true;
  document.body.appendChild(card);
  card.addEventListener('click', async e => {
    const t = e.target.closest('button');
    if (!t) return;
    if ('tutGo' in t.dataset) { location.hash = `#/${t.dataset.tutGo}`; return; }
    if ('tutMin' in t.dataset) { setMin(!minimized); return; }
    if ('tutAck' in t.dataset) {
      if (busy) return;
      busy = true;
      try { await act('tutorial_ack', { stepId: t.dataset.tutAck }); } catch (err) { toast(err.message, 'error'); } finally { busy = false; }
      return;
    }
    if ('tutSkip' in t.dataset) {
      if (await confirmBox('Skip the tutorial? Every page is unlocked right away, but you miss the remaining tutorial rewards.', 'Skip tutorial')) {
        try { await act('tutorial_skip'); } catch (err) { toast(err.message, 'error'); }
      }
    }
  });
  // during a goal step only the highlighted things can be clicked, so steps happen in order
  document.addEventListener('click', guardClick, true);
  document.addEventListener('mousedown', e => { if (e.target instanceof Element && e.target.closest('select, input, textarea')) guardClick(e); }, true);
  // highlights follow the page as it re-renders
  let queued = false;
  const schedule = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; applyHighlights(); }); };
  new MutationObserver(schedule).observe(document.getElementById('view'), { childList: true, subtree: true });
  new MutationObserver(schedule).observe(document.getElementById('sidebar'), { childList: true });
}

// Clicks on the page or the menu that aren't on the highlighted target are swallowed during a goal step.
// Dialogs, the tutorial card, toasts and the top bar stay usable. If a step's target isn't on the page
// (nothing to highlight right now), nothing is blocked, so the player can never get stuck. Steps without any
// highlight (the first fights) block the whole page: there is nothing to click, the fights run by themselves.
let lastNudge = 0;
function guardClick(e) {
  const p = state.player;
  const step = p && currentStep(p);
  if (!step || step.goal?.type === 'ack') return;
  const el = e.target instanceof Element ? e.target : e.target?.parentElement;
  if (!el) return;
  const inView = el.closest('#view'), inMenu = el.closest('#sidebar');
  if (!inView && !inMenu) return;
  if (el.closest('.tut-hl, .tut-hl-nav, #menu-toggle')) return;
  if (inMenu) {
    const link = el.closest('[data-view]');
    if (!link || link.dataset.view === step.view) return; // the menu entry of this step's page is always fine
  } else if (ctx.currentView() === step.view && (step.highlight || []).length && !targets(step).els.length) return; // target missing: don't trap the player
  e.preventDefault();
  e.stopImmediatePropagation();
  for (const h of document.querySelectorAll('.tut-hl, .tut-hl-nav')) { h.classList.remove('tut-nudge'); void h.offsetWidth; h.classList.add('tut-nudge'); setTimeout(() => h.classList.remove('tut-nudge'), 900); }
  if (e.type === 'click' && Date.now() - lastNudge > 4000) {
    lastNudge = Date.now();
    toast('Tutorial: click the highlighted button first (or skip the tutorial).', 'info');
  }
}

function setMin(v) {
  minimized = v;
  try { localStorage.setItem('tutorialMin', v ? '1' : '0'); } catch { /* storage unavailable */ }
  renderTutorial();
}

export function renderTutorial() {
  if (!card) return;
  const p = state.player;
  const step = p && currentStep(p);
  document.body.classList.toggle('in-tutorial', !!step);
  if (!step) { card.hidden = true; card.innerHTML = ''; applyHighlights(); lastStepId = null; return; }
  const steps = tutorialSteps();
  const idx = p.tutorial.step;
  const prog = stepProgress(p, step);
  const here = ctx.currentView() === step.view;
  const isAck = step.goal?.type === 'ack';
  if (step.id !== lastStepId) { if (lastStepId && !isAck) minimized = false; lastStepId = step.id; card.classList.remove('tut-pop'); void card.offsetWidth; card.classList.add('tut-pop'); }
  const reward = rewardText(step);
  card.hidden = false;
  card.className = `tut ${isAck ? 'tut-center' : ''} ${minimized && !isAck ? 'tut-min' : ''} ${card.classList.contains('tut-pop') ? 'tut-pop' : ''}`;
  if (minimized && !isAck) {
    card.innerHTML = `<button class="tut-pill" data-tut-min>📘 Tutorial ${idx + 1}/${steps.length} · ${esc(step.title)}${prog.target > 1 ? ` · ${prog.value}/${prog.target}` : ''}</button>`;
    applyHighlights();
    return;
  }
  card.innerHTML = `${isAck ? '<div class="tut-backdrop"></div>' : ''}
    <div class="tut-box" role="dialog" aria-label="Tutorial">
      <div class="tut-top"><span class="tut-count">Tutorial · step ${idx + 1} of ${steps.length}</span>${isAck ? '' : '<button class="tut-x" data-tut-min title="Minimize">–</button>'}</div>
      <div class="tut-dots">${steps.map((s, i) => `<i class="${i < idx ? 'done' : i === idx ? 'now' : ''}"></i>`).join('')}</div>
      <h3>${esc(step.title)}</h3>
      <p>${md(stepText(step))}</p>
      ${!isAck && prog.target > 1 ? `<div class="tut-bar"><i style="width:${Math.round((prog.value / prog.target) * 100)}%"></i><span>${prog.value} / ${prog.target}</span></div>` : ''}
      ${reward ? `<div class="tut-reward">🎁 Reward: ${esc(reward)}</div>` : ''}
      <div class="tut-actions">
        ${isAck ? `<button class="btn primary" data-tut-ack="${esc(step.id)}">${esc(step.button || 'Continue')}</button>`
          : here ? '<span class="tut-hint">Click the <b>highlighted</b> button</span>'
          : `<button class="btn primary small" data-tut-go="${esc(step.view)}">Go to ${esc(ctx.viewLabel(step.view))} →</button>`}
        <span class="grow"></span>
        ${idx < steps.length - 1 ? '<button class="tut-skip" data-tut-skip>Skip tutorial</button>' : ''}
      </div>
    </div>`;
  applyHighlights();
}

// One target at a time: the first highlight entry that is not done yet and exists on the page gets the glow
// (a pulsing outline). Entries: "selector" or { "el": selector, "done": selector } — the entry
// is skipped once something matches "done" (e.g. the destination is already selected).
let scrolledFor = null;
function targets(step) {
  if (ctx.currentView() !== step.view) {
    const nav = document.querySelector(`#sidebar a[data-view="${step.view}"]`);
    const sidebarHidden = !nav || nav.getBoundingClientRect().right <= 0;
    return { nav: true, els: [sidebarHidden ? document.getElementById('menu-toggle') : nav].filter(Boolean) };
  }
  const view = document.getElementById('view');
  for (const h of step.highlight || []) {
    const sel = typeof h === 'string' ? h : h?.el;
    const done = typeof h === 'object' ? h?.done : null;
    try {
      if (done && view.querySelector(done)) continue;
      const els = [...view.querySelectorAll(sel)].filter(x => !x.disabled && x.getClientRects().length).slice(0, 6);
      if (els.length) return { nav: false, els };
    } catch { /* bad selector in content */ }
  }
  return { nav: false, els: [] };
}

function applyHighlights() {
  for (const el of document.querySelectorAll('.tut-hl, .tut-hl-nav')) el.classList.remove('tut-hl', 'tut-hl-nav');
  const p = state.player;
  const step = p && currentStep(p);
  if (!step || step.goal?.type === 'ack') return;
  const t = targets(step);
  for (const el of t.els) el.classList.add(t.nav ? 'tut-hl-nav' : 'tut-hl');
  const first = t.els[0] || null;
  // bring the target into view once (don't fight the player's own scrolling afterwards)
  const key = first && `${step.id}:${first.dataset ? JSON.stringify(first.dataset) : ''}`;
  if (first && key !== scrolledFor) {
    scrolledFor = key;
    const r = first.getBoundingClientRect();
    if (r.top < 60 || r.bottom > innerHeight - 160) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}
