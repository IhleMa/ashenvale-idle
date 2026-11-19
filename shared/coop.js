// Co-op line-up: a co-op fight has at most CONFIG.coop.partySize characters. Every player's hero always fights;
// the free slots go to recruits:
//   1 player  → their first picks fill every free slot
//   2+ players → at most one recruit per player while there are slots left. A missing role (healer, then tank,
//                as in CONFIG.coop.fillRoles) is filled first by whoever has a fitting recruit among their picks;
//                the rest go round in turn, starting with the player whose turn it is (the turn moves on after
//                every fight, so nobody is always left out).
import { CONFIG } from './config.js';
import { CLASSES } from './data/classes.js';

const roleOf = c => CLASSES[c.classId]?.role;

// players: [{ id, hero, picks: [character in preference order] }] in group order; turn: index of whose turn it is
// returns { byPlayer: { id: [hero, ...recruits] }, reasons: { charId: 'role:healer' | 'turn' | 'solo' } }
export function coopLineup(players, turn = 0) {
  const size = CONFIG.coop.partySize || 4;
  const out = { byPlayer: {}, reasons: {} };
  if (!players.length) return out;
  for (const pl of players) out.byPlayer[pl.id] = pl.hero ? [pl.hero] : [];
  let free = Math.max(0, size - players.filter(pl => pl.hero).length);
  if (players.length === 1) {
    const pl = players[0];
    for (const c of pl.picks.slice(0, free)) { out.byPlayer[pl.id].push(c); out.reasons[c.id] = 'solo'; }
    return out;
  }
  const limit = Math.max(1, Math.ceil(free / players.length));
  const order = players.map((_, i) => players[(turn + i) % players.length]);
  const taken = new Set();
  const count = id => out.byPlayer[id].length - 1;
  const give = (pl, c, why) => { out.byPlayer[pl.id].push(c); out.reasons[c.id] = why; taken.add(c.id); free--; };
  // 1) fill missing roles
  const covered = new Set(players.filter(pl => pl.hero).map(pl => roleOf(pl.hero)));
  for (const role of CONFIG.coop.fillRoles || []) {
    if (free <= 0) break;
    if (covered.has(role)) continue;
    for (const pl of order) {
      if (count(pl.id) >= limit) continue;
      const c = pl.picks.find(x => !taken.has(x.id) && roleOf(x) === role);
      if (c) { give(pl, c, `role:${role}`); covered.add(role); break; }
    }
  }
  // 2) the rest in turn
  let progress = true;
  while (free > 0 && progress) {
    progress = false;
    for (const pl of order) {
      if (free <= 0) break;
      if (count(pl.id) >= limit) continue;
      const c = pl.picks.find(x => !taken.has(x.id));
      if (c) { give(pl, c, 'turn'); progress = true; }
    }
  }
  return out;
}
