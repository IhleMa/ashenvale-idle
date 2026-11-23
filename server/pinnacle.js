// Pinnacle bosses (content/pinnacle/): entry with a Pinnacle Sigil, rewards per participant and the fastest-kill
// leaderboard (stored in the database).
import { PINNACLE, PINNACLE_BOSSES, pinnacleList, pinnacleState, weekKey } from '../shared/pinnacle.js';
import { generateUnique } from '../shared/data/legendaries.js';
import { computeRewards } from '../shared/encounters.js';
import { createRng, randomSeed } from '../shared/rng.js';
import * as L from './playerLogic.js';

const fail = msg => { throw new L.GameError(msg); };

export class Pinnacle {
  constructor(game) {
    this.game = game;
    this.board = game.store.getDoc('pinnacleBoard', {});
  }
  save() { this.game.store.putDoc('pinnacleBoard', this.board); }

  // every participant's hero must be high enough; the leader (or the solo player) pays one sigil
  check(payer, players, bossId) {
    const def = PINNACLE_BOSSES[bossId] || fail('Unknown pinnacle boss');
    for (const p of players) {
      const h = L.hero(p);
      if (!h || h.level < PINNACLE.minLevel) fail(`${p.name}'s hero must be level ${PINNACLE.minLevel} for pinnacle bosses`);
    }
    if (pinnacleState(payer).sigils < 1) fail('You need a Pinnacle Sigil — a very rare drop from high-level enemies (not from rifts)');
    return def;
  }
  pay(payer) {
    const s = pinnacleState(payer);
    s.sigils -= 1;
    s.attempts += 1;
  }

  // rewards of one participant (after a won fight); returns the summary fields
  reward(p, b, bossId, lootMult, now = Date.now()) {
    const def = PINNACLE_BOSSES[bossId];
    const s = pinnacleState(p);
    const rng = createRng(randomSeed());
    const rewards = computeRewards(b.kills, rng, { rewardMult: PINNACLE.rewardMult ?? 3, lootBoost: PINNACLE.lootBoost ?? 1.5, lootMult });
    const uniques = [];
    const dropUnique = () => {
      const ids = (def.uniques || []).filter(Boolean);
      if (!ids.length) return;
      const it = generateUnique(rng, PINNACLE.level, ids[Math.floor(rng() * ids.length)]);
      if (it) { rewards.items.push(it); uniques.push(it.name); }
    };
    if (rng() < (def.uniqueChance ?? 0.3)) dropUnique();
    const out = { pinnacle: bossId, time: Math.round(b.time * 10) / 10 };
    // first kill of the week: crystals and a guaranteed pinnacle unique
    const week = weekKey(now);
    if (s.weekly[bossId] !== week) {
      s.weekly[bossId] = week;
      const w = PINNACLE.weekly || {};
      if (w.crystals) { p.premium = (p.premium || 0) + w.crystals; out.crystals = w.crystals; }
      if (w.extraUnique) dropUnique();
      out.weekly = true;
    }
    if (!s.firstKill[bossId]) { s.firstKill[bossId] = now; out.firstKill = true; }
    s.kills[bossId] = (s.kills[bossId] || 0) + 1;
    if (!s.best[bossId] || b.time < s.best[bossId]) { s.best[bossId] = out.time; out.personalBest = true; }
    out.uniques = uniques;
    return { rewards, out };
  }

  // fastest kills: one entry per group of players (their best), the top leaderboardSize per boss
  record(bossId, b, participants, now = Date.now()) {
    const key = participants.map(x => x.id).sort().join(',');
    const entry = {
      key, time: Math.round(b.time * 10) / 10, at: now,
      players: participants.map(x => x.name),
      chars: b.units.filter(u => u.side === 'A' && u.kind === 'character').map(u => ({ name: u.name, classId: u.classId, subclass: u.subclass || null, owner: u.ownerName })),
    };
    const list = (this.board[bossId] ||= []);
    const i = list.findIndex(e => e.key === key);
    if (i >= 0 && list[i].time <= entry.time) return false;
    if (i >= 0) list.splice(i, 1);
    list.push(entry);
    list.sort((a, c) => a.time - c.time || a.at - c.at);
    list.length = Math.min(list.length, PINNACLE.leaderboardSize || 10);
    this.save();
    return list.includes(entry) ? list.indexOf(entry) + 1 : false;
  }

  view(p) {
    return {
      bosses: pinnacleList().map(d => ({ id: d.id, board: (this.board[d.id] || []).map(({ key, ...e }) => e) })),
      week: weekKey(),
      me: pinnacleState(p),
    };
  }
}
