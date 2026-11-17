// Tutorial progression (server side, authoritative). Steps and their goals: content/tutorial.json, shared/tutorial.js.
import { TUTORIAL, tutorialSteps, currentStep, stepProgress, baselineFor } from '../shared/tutorial.js';
import { addXp, syncTree } from '../shared/character.js';
import { upgradeCost } from '../shared/town.js';
import { BUILDINGS, MATERIALS } from '../shared/data/town.js';
import { GameError } from './playerLogic.js';

const fail = m => { throw new GameError(m); };

export function startTutorial(p) {
  if (!TUTORIAL?.enabled || !tutorialSteps().length) { p.tutorial = { done: true, step: 0 }; return; }
  p.tutorial = { step: 0, done: false, startedAt: Date.now(), base: {} };
  p.tutorial.base = baselineFor(p, tutorialSteps()[0]);
}

// what a reward gives right now (coverUpgrade depends on what the player has)
export function resolveReward(p, reward) {
  if (!reward) return null;
  const out = { gold: reward.gold || 0, premium: reward.premium || 0, xp: reward.xp || 0, materials: { ...(reward.materials || {}) } };
  if (reward.coverUpgrade && BUILDINGS[reward.coverUpgrade] && p.town?.buildings?.[reward.coverUpgrade]) {
    const b = p.town.buildings[reward.coverUpgrade];
    const cost = upgradeCost(reward.coverUpgrade, (b.upgrade ? b.upgrade.to : b.level) + 1);
    out.gold += Math.max(0, cost.gold - (p.gold + out.gold));
    for (const [k, v] of Object.entries(cost.mats)) {
      const missing = v - (p.town.materials[k] || 0) - (out.materials[k] || 0);
      if (missing > 0) out.materials[k] = (out.materials[k] || 0) + missing;
    }
  }
  return out;
}

function grant(p, r) {
  if (!r) return [];
  const parts = [];
  if (r.gold) { p.gold += r.gold; parts.push(`${r.gold} gold`); }
  if (r.premium) { p.premium = (p.premium || 0) + r.premium; parts.push(`${r.premium} 💠`); }
  if (r.xp) {
    const h = p.characters[p.heroId];
    if (h && addXp(h, r.xp)) syncTree(h);
    parts.push(`${r.xp} XP`);
  }
  const mats = Object.entries(r.materials || {}).filter(([, v]) => v > 0);
  if (mats.length) {
    p.town.materials ||= {};
    for (const [k, v] of mats) p.town.materials[k] = (p.town.materials[k] || 0) + v;
    parts.push(mats.map(([k, v]) => `${v} ${MATERIALS[k]?.name || k}`).join(', '));
  }
  return parts;
}

function advance(p, step) {
  const t = p.tutorial;
  const rewardParts = grant(p, resolveReward(p, step.reward));
  t.step++;
  const next = tutorialSteps()[t.step];
  if (!next) { t.done = true; t.finishedAt = Date.now(); delete t.base; }
  else t.base = baselineFor(p, next);
  return { step, reward: rewardParts, next };
}

// Completes every step whose goal is met (several in a row if the player was quick). Returns what happened.
export function checkTutorial(p) {
  const out = [];
  for (let guard = 0; guard < 50; guard++) {
    const step = currentStep(p);
    if (!step || step.goal?.type === 'ack') break;
    if (!stepProgress(p, step).done) break;
    out.push(advance(p, step));
  }
  return out;
}

export function ackTutorial(p, { stepId }) {
  const step = currentStep(p) || fail('No tutorial step to continue');
  if (step.goal?.type !== 'ack') fail('Finish the current step first');
  if (stepId && stepId !== step.id) fail('The tutorial has moved on');
  return [advance(p, step), ...checkTutorial(p)];
}

export function skipTutorial(p) {
  if (!p.tutorial || p.tutorial.done) return;
  p.tutorial.done = true;
  p.tutorial.skipped = true;
  p.tutorial.finishedAt = Date.now();
  delete p.tutorial.base;
}
