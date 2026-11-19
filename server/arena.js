// Arena (server side): arena team, opponent list, attacks, rating for attacker and defender, defense log.
// The fight itself runs live in the attacker's solo battle slot (kind 'arena') and is shown on the Combat page.
import { CONFIG } from '../shared/config.js';
import { ARENA, arenaLevel, eloDelta, refillAttacks, pvpOptions, newArena } from '../shared/arena.js';
import { createBattle, drainEvents, battleSnapshot } from '../shared/combat.js';
import { buildPartyUnits } from '../shared/party.js';
import { computeStats, powerRating } from '../shared/stats.js';
import { randomSeed } from '../shared/rng.js';
import * as L from './playerLogic.js';

const fail = m => { throw new L.GameError(m); };

export class Arena {
  constructor(game) { this.game = game; }

  data(p) {
    if (!p.arena) p.arena = newArena();
    const a = p.arena;
    for (const [k, v] of Object.entries(newArena())) if (a[k] === undefined) a[k] = v;
    refillAttacks(a);
    return a;
  }

  // the arena team of a player: the members of the chosen party setup (hero first), or null
  team(p) {
    const a = this.data(p);
    if (a.party == null) return null;
    const members = (p.parties[a.party]?.members || []).map(id => p.characters[id]).filter(Boolean);
    if (!members.length) return null;
    return [...members.filter(c => c.isMain), ...members.filter(c => !c.isMain)];
  }

  setParty(p, { party }) {
    if (party === null) { this.data(p).party = null; return; }
    const i = Number(party);
    if (!Number.isInteger(i) || !p.parties[i]) fail('Unknown party');
    if (!p.parties[i].members.length) fail('That party is empty');
    this.data(p).party = i;
    this.game.rankings.cache = null; // show up in the opponent pool right away
  }

  playerById(id) {
    const p = this.game.sessions.get(id)?.player || this.game.store.loadPlayer(id);
    if (p) L.migratePlayer(p);
    return p;
  }

  card(p, me) {
    const team = this.team(p) || [];
    const h = L.hero(p);
    const a = this.data(p);
    return {
      id: p.id, name: p.name, bot: this.game.showBot(p.id), rating: a.rating, wins: a.wins, losses: a.losses,
      hero: h ? { name: h.name, classId: h.classId, subclass: h.subclass || null, level: h.level, portrait: h.portrait } : null,
      team: team.map(c => ({ name: c.name, classId: c.classId, subclass: c.subclass || null, level: c.level, portrait: c.portrait, isMain: c.isMain })),
      power: team.reduce((s, c) => s + powerRating(computeStats(c)), 0),
      fightLevel: me && h ? arenaLevel(L.hero(me).level, h.level) : null,
    };
  }

  // a few opponents close to my rating whom I haven't attacked recently
  refresh(p) {
    const a = this.data(p);
    const now = Date.now();
    const cooldown = (ARENA().sameOpponentMinutes ?? 60) * 60_000;
    for (const [id, t] of Object.entries(a.recent)) if (now - t > cooldown) delete a.recent[id];
    const pool = this.game.rankings.all()
      .filter(s => s.id !== p.id && s.arenaReady && !a.recent[s.id])
      .map(s => ({ id: s.id, diff: Math.abs((s.arenaRating ?? 1000) - a.rating) + Math.random() * 60 }))
      .sort((x, y) => x.diff - y.diff);
    // pick from the closest few, so the list changes when refreshed
    const near = pool.slice(0, Math.max(ARENA().opponentChoices ?? 3, 8));
    for (let i = near.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [near[i], near[j]] = [near[j], near[i]]; }
    a.opponents = near.slice(0, ARENA().opponentChoices ?? 3).map(x => x.id);
    return a.opponents;
  }

  view(p) {
    const a = this.data(p);
    if (!a.opponents.length) this.refresh(p);
    const opponents = a.opponents.map(id => this.playerById(id)).filter(o => o && this.team(o)).map(o => this.card(o, p));
    return { opponents, nextAttackAt: refillAttacks(a) };
  }

  attack(s, { opponentId }) {
    const p = s.player;
    const a = this.data(p);
    const g = this.game;
    g.ensureNotInCoop(p.id);
    if (s.solo?.kind === 'arena' && s.solo.battle) fail('You are already in an arena fight');
    const mine = this.team(p) || fail('Choose your arena team first');
    if (!a.opponents.includes(opponentId)) fail('Pick an opponent from your list');
    if (a.attacks <= 0) fail('No attacks left — they refill over time');
    const o = this.playerById(opponentId) || fail('Opponent not found');
    const theirs = this.team(o) || fail('That player has no arena team any more');
    const level = arenaLevel(L.hero(p).level, L.hero(o).level);
    const allies = buildPartyUnits(mine, { ownerId: p.id, ownerName: p.name, syncLevel: level });
    const foes = buildPartyUnits(theirs, { ownerId: o.id, ownerName: o.name, syncLevel: level });
    foes.forEach((u, i) => { u.position = i; });
    const battle = createBattle({
      seed: randomSeed(), allies, waves: [foes.map(unit => ({ unit }))], pvp: pvpOptions(),
      meta: { kind: 'arena', title: `Arena: ${p.name} vs ${o.name}`, level, opponentId: o.id, opponentName: o.name, timeLimit: pvpOptions().timeLimit },
    });
    a.attacks--;
    a.recent[o.id] = Date.now();
    a.opponents = a.opponents.filter(id => id !== o.id);
    g.abortSolo(s);
    s.solo = { battle, kind: 'arena', chars: mine.map(c => c.id), arena: { opponentId: o.id, level } };
    drainEvents(battle);
    g.sendTo(p.id, { t: 'battle_start', k: 'solo', battle: battleSnapshot(battle) });
  }

  // after the fight: ratings, logs, reward
  finish(s) {
    const g = this.game;
    const p = s.player;
    const { battle: b, arena: info } = s.solo;
    const won = b.state === 'victory';
    const a = this.data(p);
    const o = this.playerById(info.opponentId);
    const oa = o ? this.data(o) : null;
    const delta = eloDelta(a.rating, oa?.rating ?? a.rating, won);
    a.rating = Math.max(0, a.rating + delta);
    a.best = Math.max(a.best || 0, a.rating);
    if (won) a.wins++; else a.losses++;
    const gold = won ? Math.round((ARENA().winGoldPerLevel ?? 15) * info.level * g.settings.get('goldRate')) : 0;
    p.gold += gold;
    const size = ARENA().logSize ?? 20;
    const at = Date.now();
    const byTime = b.time >= (b.pvp?.timeLimit || Infinity);
    a.log = [{ at, type: 'attack', opponent: o?.name || '???', won, delta, rating: a.rating, level: info.level, time: Math.round(b.time), byTime }, ...a.log].slice(0, size);
    if (o && oa) {
      oa.rating = Math.max(0, oa.rating - delta);
      oa.best = Math.max(oa.best || 0, oa.rating);
      if (won) oa.defLosses++; else oa.defWins++;
      oa.log = [{ at, type: 'defense', opponent: p.name, won: !won, delta: -delta, rating: oa.rating, level: info.level, time: Math.round(b.time), byTime }, ...oa.log].slice(0, size);
      const os = g.sessions.get(o.id);
      if (os) { g.markDirty(os); g.toast(o.id, `🏟 ${p.name} attacked your arena team and ${won ? 'won' : 'lost'} (${-delta >= 0 ? '+' : ''}${-delta} rating).`, won ? 'info' : 'success'); }
      else g.store.savePlayerSoon(o);
    }
    g.rankings.cache = null;
    const summary = { result: b.state, kind: 'arena', opponent: o?.name || '???', delta, rating: a.rating, gold, xp: 0, items: [], byTime };
    g.sendTo(p.id, { t: 'battle_end', k: 'solo', summary });
    s.solo = { restUntil: Date.now() + CONFIG.combat.restBetweenFights * 1000 };
    g.markDirty(s);
  }
}
