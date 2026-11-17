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
  // highlights follow the page as it re-renders
  let queued = false;
  const schedule = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; applyHighlights(); }); };
  new MutationObserver(schedule).observe(document.getElementById('view'), { childList: true, subtree: true });
  new MutationObserver(schedule).observe(document.getElementById('sidebar'), { childList: true });
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
          : here ? '<span class="tut-hint">👉 Look for the glowing button</span>'
          : `<button class="btn primary small" data-tut-go="${esc(step.view)}">Go to ${esc(ctx.viewLabel(step.view))} →</button>`}
        <span class="grow"></span>
        ${idx < steps.length - 1 ? '<button class="tut-skip" data-tut-skip>Skip tutorial</button>' : ''}
      </div>
    </div>`;
  applyHighlights();
}

function applyHighlights() {
  for (const el of document.querySelectorAll('.tut-hl, .tut-hl-nav')) el.classList.remove('tut-hl', 'tut-hl-nav');
  const p = state.player;
  const step = p && currentStep(p);
  if (!step || step.goal?.type === 'ack') return;
  if (ctx.currentView() !== step.view) {
    document.querySelector(`#sidebar a[data-view="${step.view}"]`)?.classList.add('tut-hl-nav');
    document.getElementById('menu-toggle')?.classList.add('tut-hl-nav');
    return;
  }
  const view = document.getElementById('view');
  for (const sel of step.highlight || []) {
    let list = [];
    try { list = [...view.querySelectorAll(sel)]; } catch { /* bad selector in content */ }
    for (const el of list.filter(x => !x.disabled).slice(0, 6)) el.classList.add('tut-hl');
  }
}
