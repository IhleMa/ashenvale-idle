// Arena: asynchronous player-vs-player. Each player picks one of their party setups as their arena team; it
// attacks and defends. Both teams fight at the average level of the two heroes (synced up or down), with the
// PvP modifiers from config.json → arena. Rating: Elo for attacker and defender.
import { CONFIG } from './config.js';

export const ARENA = () => CONFIG.arena || {};

export function newArena() {
  return { party: null, rating: ARENA().startRating ?? 1000, best: ARENA().startRating ?? 1000, wins: 0, losses: 0, defWins: 0, defLosses: 0, attacks: ARENA().attacksMax ?? 5, attacksAt: 0, opponents: [], recent: {}, log: [] };
}

// both teams fight at this level
export function arenaLevel(heroLevelA, heroLevelB) {
  return Math.max(1, Math.min(CONFIG.levelCap, Math.round((heroLevelA + heroLevelB) / 2)));
}

// Elo: rating change for A after a fight against B (B changes by the opposite amount)
export function eloDelta(ratingA, ratingB, aWon, k = ARENA().kFactor ?? 32) {
  const expected = 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
  return Math.round(k * ((aWon ? 1 : 0) - expected));
}

// attacks refill one at a time, every attackRefillMinutes, up to attacksMax; returns when the next one comes
export function refillAttacks(a, now = Date.now()) {
  const max = ARENA().attacksMax ?? 5;
  const step = (ARENA().attackRefillMinutes ?? 120) * 60_000;
  if (a.attacks >= max) { a.attacksAt = now; return null; }
  if (!a.attacksAt) a.attacksAt = now;
  const gained = Math.floor((now - a.attacksAt) / step);
  if (gained > 0) {
    a.attacks = Math.min(max, a.attacks + gained);
    a.attacksAt = a.attacks >= max ? now : a.attacksAt + gained * step;
  }
  return a.attacks >= max ? null : a.attacksAt + step;
}

export function pvpOptions() {
  const a = ARENA();
  return { damageMult: a.damageMult ?? 0.5, healingMult: a.healingMult ?? 0.5, controlMult: a.controlMult ?? 0.5, timeLimit: a.timeLimit ?? 90 };
}
