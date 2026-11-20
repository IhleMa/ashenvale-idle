// Expedition calculations shared by server (rewards) and client (estimates).
import { EXPEDITIONS, CAMP_SLOTS, CAMP_MEMBERS, EXPEDITION_DURATIONS } from './data/expeditions.js';
import { bLevel } from './town.js';

export const campSlots = p => CAMP_SLOTS[bLevel(p, 'expedition_camp')] || 0;
export const campMembers = p => CAMP_MEMBERS[bLevel(p, 'expedition_camp')] || 0;

// What a character is busy with, or null if free to fight
export function busyWith(p, charId) {
  for (const [bid, b] of Object.entries(p.town?.buildings || {})) if (b.worker === charId) return { type: 'work', buildingId: bid };
  for (const ex of p.expeditions || []) if (ex.charIds.includes(charId)) return { type: 'expedition', expeditionId: ex.id, destId: ex.destId, endsAt: ex.endsAt };
  return null;
}

// Multipliers for a team (array of characters)
export function teamFactors(dest, chars) {
  const n = chars.length;
  const members = n ? 1 + (n - 1) * 0.8 : 0;
  const avgLevel = n ? chars.reduce((s, c) => s + c.level, 0) / n : 0;
  const power = Math.min(1.25, Math.max(0.35, 1 + (avgLevel - dest.level) * 0.03));
  let prof = 1;
  for (const c of chars) if (dest.bonus && c.profession?.id === dest.bonus) prof += 0.2 + c.profession.level * 0.01;
  return { members, power, prof, avgLevel };
}

// Longer expeditions give more per hour (durations[].bonusPerHour, e.g. +10% at 8 hours): planning pays off
export const durationBonus = hours => EXPEDITION_DURATIONS.find(d => d.hours === Number(hours))?.bonusPerHour || 0;

// Expected yields (no randomness) — client shows this as an estimate; server applies ±15% variance
export function expectedYield(dest, chars, hours) {
  const f = teamFactors(dest, chars);
  const time = hours * (1 + durationBonus(hours));
  const mult = f.members * f.power * f.prof * time;
  const out = {};
  for (const [m, perHour] of Object.entries(dest.yields)) out[m] = perHour * mult;
  const rare = {};
  for (const [m, ch] of Object.entries(dest.rare || {})) rare[m] = ch * time * f.members * f.prof;
  return { yields: out, rare, factors: f };
}

export function expeditionXp(dest, hours) {
  return Math.round(hours * (1 + durationBonus(hours)) * 35 * (1 + dest.level * 0.25));
}

export { EXPEDITIONS };
