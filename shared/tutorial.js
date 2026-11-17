// New-player tutorial (content/tutorial.json): ordered steps with goals measured from the player's state.
// Shared so the client shows exactly the progress the server counts.
import { CONTENT } from './content.js';
export { VIEW_IDS, METRIC_NAMES } from './tutorialDefs.js';

export const TUTORIAL = CONTENT.tutorial;

const hero = p => (p.heroId ? p.characters[p.heroId] : null);
export const METRICS = {
  kills: p => p.stats?.kills || 0,
  fights: p => p.stats?.fights || 0,
  recruited: p => p.stats?.recruited || 0,
  heroLevel: p => hero(p)?.level || 0,
  heroNodes: p => Math.max(0, (hero(p)?.tree?.allocated?.length || 1) - 1),
  buildingUpgrades: p => Object.values(p.town?.buildings || {}).reduce((n, b) => n + (b.level || 0) + (b.upgrade ? 1 : 0), 0),
  expeditionsSent: p => p.stats?.expeditionsSent || 0,
  expeditionSpeedups: p => p.stats?.expeditionSpeedups || 0,
  expeditionsReady: (p, now = Date.now()) => (p.expeditions || []).filter(e => e.endsAt <= now).length,
  expeditionsClaimed: p => p.stats?.expeditionsClaimed || 0,
  partySize: p => (p.parties?.[p.activeParty]?.members || []).length,
};

export const tutorialSteps = () => TUTORIAL?.steps || [];
export function currentStep(p) {
  const t = p.tutorial;
  if (!t || t.done) return null;
  return tutorialSteps()[t.step] || null;
}
export const tutorialActive = p => !!currentStep(p);

function conditions(goal) { return goal?.any ? goal.any : goal?.metric ? [goal] : []; }
// values of every metric a step uses, remembered when the step starts
export function baselineFor(p, step) {
  const base = {};
  for (const c of conditions(step.goal)) if (METRICS[c.metric]) base[c.metric] = METRICS[c.metric](p);
  return base;
}
// → { value, target, done } (for "any": the condition closest to done)
export function stepProgress(p, step = currentStep(p), base = p.tutorial?.base || {}) {
  if (!step) return null;
  if (step.goal?.type === 'ack') return { value: 0, target: 1, done: false, ack: true };
  let best = null;
  for (const c of conditions(step.goal)) {
    const raw = METRICS[c.metric]?.(p) ?? 0;
    const value = Math.max(0, c.absolute ? raw : raw - (base[c.metric] ?? 0));
    const r = { value: Math.min(value, c.count), target: c.count, done: value >= c.count };
    if (!best || r.done || (!best.done && r.value / r.target > best.value / best.target)) best = r;
    if (r.done) break;
  }
  return best || { value: 0, target: 1, done: false };
}

// pages shown in the menu: null = all of them
export function visibleViews(p) {
  const t = p.tutorial;
  if (!t || t.done || !TUTORIAL?.enabled) return null;
  const steps = tutorialSteps();
  const set = new Set(TUTORIAL.alwaysVisible || []);
  for (let i = 0; i <= Math.min(t.step, steps.length - 1); i++) {
    for (const v of steps[i].unlocks || []) {
      if (v === '*') return null;
      set.add(v);
    }
  }
  return set;
}
// the step at which a page appears (for "NEW" markers)
export function unlockedAt(viewId) {
  return tutorialSteps().findIndex(s => (s.unlocks || []).includes(viewId));
}
export const stepText = step => String(step.text || '').replace(/\{count\}/g, String(step.goal?.count ?? ''));
