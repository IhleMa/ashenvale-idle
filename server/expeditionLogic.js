// Expeditions: send recruits away to gather materials (server-authoritative, server clock).
import crypto from 'node:crypto';
import { EXPEDITIONS, EXPEDITION_DURATIONS } from '../shared/data/expeditions.js';
import { PROFESSIONS, PROFESSION_MAX, professionXpToNext } from '../shared/data/town.js';
import { campSlots, campMembers, busyWith, expectedYield, expeditionXp } from '../shared/expeditions.js';
import { addXp } from '../shared/character.js';
import { createRng } from '../shared/rng.js';
import { GameError } from './playerLogic.js';
import { addMaterials, removeFromParties } from './townLogic.js';

const fail = m => { throw new GameError(m); };

export function startExpedition(p, { destId, charIds, hours }) {
  const dest = EXPEDITIONS[destId] || fail('Unknown destination');
  const campLevel = p.town.buildings.expedition_camp?.level || 0;
  if (campLevel < 1) fail('Build an Expedition Camp first');
  if (dest.campLevel > campLevel) fail(`Requires Expedition Camp level ${dest.campLevel}`);
  if (!EXPEDITION_DURATIONS.some(d => d.hours === Number(hours))) fail('Invalid duration');
  if (p.expeditions.length >= campSlots(p)) fail(`Only ${campSlots(p)} expedition${campSlots(p) > 1 ? 's' : ''} at a time — upgrade the Expedition Camp`);
  if (!Array.isArray(charIds) || !charIds.length) fail('Choose at least one recruit');
  const ids = [...new Set(charIds.map(String))];
  if (ids.length > campMembers(p)) fail(`Up to ${campMembers(p)} recruit${campMembers(p) > 1 ? 's' : ''} per expedition at this camp level`);
  for (const id of ids) {
    const ch = p.characters[id] || fail('Character not found');
    if (ch.isMain) fail('Your hero stays to lead the party');
    const busy = busyWith(p, id);
    if (busy?.type === 'work') fail(`${ch.name} is working in town — unassign them first`);
    if (busy?.type === 'expedition') fail(`${ch.name} is already on an expedition`);
  }
  const now = Date.now();
  const ex = {
    id: crypto.randomBytes(5).toString('hex'), destId, charIds: ids, hours: Number(hours),
    startedAt: now, endsAt: now + Number(hours) * 3600000, seed: crypto.randomInt(1, 2 ** 31),
  };
  p.expeditions.push(ex);
  for (const id of ids) removeFromParties(p, id);
  return ex;
}

export function cancelExpedition(p, { id }) {
  const idx = p.expeditions.findIndex(e => e.id === id);
  if (idx < 0) fail('Expedition not found');
  if (p.expeditions[idx].endsAt <= Date.now()) fail('This expedition is already back — claim the rewards');
  p.expeditions.splice(idx, 1);
}

function professionXp(ch, amount) {
  const pr = ch.profession;
  if (!pr || pr.level >= PROFESSION_MAX) return null;
  pr.xp += Math.round(amount);
  let up = false;
  while (pr.level < PROFESSION_MAX && pr.xp >= professionXpToNext(pr.level)) { pr.xp -= professionXpToNext(pr.level); pr.level++; up = true; }
  return up ? `${ch.name}'s ${PROFESSIONS[pr.id].name} reached ${pr.level}!` : null;
}

export function claimExpedition(p, { id }) {
  const idx = p.expeditions.findIndex(e => e.id === id);
  if (idx < 0) fail('Expedition not found');
  const ex = p.expeditions[idx];
  if (ex.endsAt > Date.now()) fail('Your recruits are still away');
  const dest = EXPEDITIONS[ex.destId];
  const chars = ex.charIds.map(c => p.characters[c]).filter(Boolean);
  const rng = createRng(ex.seed);
  const est = expectedYield(dest, chars, ex.hours);
  const got = {};
  for (const [m, v] of Object.entries(est.yields)) { const n = Math.round(v * (0.85 + rng() * 0.3)); if (n > 0) got[m] = n; }
  for (const [m, expected] of Object.entries(est.rare)) {
    let n = Math.floor(expected);
    if (rng() < expected - n) n++;
    if (n > 0) got[m] = (got[m] || 0) + n;
  }
  addMaterials(p, got);
  const xp = expeditionXp(dest, ex.hours);
  const messages = [];
  const levelUps = [];
  for (const ch of chars) {
    if (addXp(ch, xp)) levelUps.push(`${ch.name} reached level ${ch.level}!`);
    if (dest.bonus && ch.profession?.id === dest.bonus) { const m = professionXp(ch, 20 * ex.hours + 5); if (m) messages.push(m); }
    else { const m = professionXp(ch, 5 * ex.hours + 2); if (m) messages.push(m); }
  }
  p.expeditions.splice(idx, 1);
  p.stats.expeditions = (p.stats.expeditions || 0) + 1;
  return { got, xp, messages: [...levelUps, ...messages], destName: dest.name };
}

export function claimAll(p) {
  const done = p.expeditions.filter(e => e.endsAt <= Date.now()).map(e => e.id);
  if (!done.length) fail('No expedition has returned yet');
  const total = {};
  const messages = [];
  for (const id of done) {
    const r = claimExpedition(p, { id });
    for (const [k, v] of Object.entries(r.got)) total[k] = (total[k] || 0) + v;
    messages.push(...r.messages);
  }
  return { got: total, count: done.length, messages };
}

// Newly returned expeditions (for notifications); marks them as announced
export function newlyReturned(p, now = Date.now()) {
  const out = [];
  for (const ex of p.expeditions || []) if (ex.endsAt <= now && !ex.announced) { ex.announced = true; out.push(ex); }
  return out;
}
