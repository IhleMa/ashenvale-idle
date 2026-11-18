// Live balance statistics (Admin → ⚖ Balance): every real fight is added to hourly buckets in the database.
// Bots and real players are kept apart, so the dashboard can show either. Buckets older than 90 days are removed.
//
// bucket "balance:<YYYY-MM-DDTHH>" = { human: Segment, bot: Segment }
// Segment = {
//   classes: { "<class>|<band>|<activity>": { n, wins, sec, dmg, heal, taken, deaths } }   per character per fight
//   casts:   { "<class>|<ability>": count }
//   fights:  { "<activity>|<place>": { n, wins, sec, deaths, chars } }                       per party per fight
//   econ:    { "<band>|<activity>": { n, sec, xp, gold } }                                     per party per fight
//   rifts:   { "<tier band>": { n, wins, timed } }
//   levels:  { "<class>|<level>": [seconds, …] }   time heroes needed to reach that level (samples)
//   players: { "<playerId>": 1 }
// }
import { CONFIG } from '../shared/config.js';

const PREFIX = 'balance:';
const KEEP_DAYS = 90;
const SAMPLES = 60; // level-time samples kept per class, level and hour
export const LEVEL_BANDS = [[1, 10], [11, 20], [21, 30], [31, 40], [41, 50], [51, 60], [61, 1000]];
export const bandOf = level => LEVEL_BANDS.findIndex(([a, b]) => level >= a && level <= b);
const hourKey = t => PREFIX + new Date(t).toISOString().slice(0, 13);
const newSeg = () => ({ classes: {}, casts: {}, fights: {}, econ: {}, rifts: {}, levels: {}, players: {} });
const add = (o, k, v) => { o[k] = (o[k] || 0) + v; };

export class BalanceStats {
  constructor(store, { isBot = () => false } = {}) {
    this.store = store;
    this.isBot = isBot;
    this.key = null;
    this.bucket = null;
    this.lastPrune = 0;
  }

  current(now = Date.now()) {
    const key = hourKey(now);
    if (key !== this.key) {
      if (this.bucket) this.store.putDoc(this.key, this.bucket);
      this.key = key;
      this.bucket = this.store.getDoc(key, null) || { human: newSeg(), bot: newSeg() };
      if (now - this.lastPrune > 6 * 3600_000) { this.lastPrune = now; this.prune(now); }
    }
    this.store.putDoc(this.key, this.bucket); // written with the next regular save
    return this.bucket;
  }

  // b: a finished battle; activity: idle (zone farming) | boss | rift | coop | offline
  recordBattle(p, b, { activity = b.meta?.kind || 'idle', place = null, gold = 0, xp = 0, now = Date.now() } = {}) {
    if (!b || b.state === 'running') return;
    const seg = this.current(now)[this.isBot(p.id) ? 'bot' : 'human'];
    const won = b.state === 'victory';
    const sec = b.time || 0;
    const chars = b.units.filter(u => u.kind === 'character' && u.side === 'A' && u.ownerId === p.id && u.stat);
    if (!chars.length) return;
    seg.players[p.id] = 1;
    let deaths = 0;
    for (const u of chars) {
      const k = `${u.classId}|${bandOf(u.level)}|${activity}`;
      const c = seg.classes[k] ||= { n: 0, wins: 0, sec: 0, dmg: 0, heal: 0, taken: 0, deaths: 0 };
      c.n++; if (won) c.wins++;
      c.sec += sec; c.dmg += u.stat.dmg; c.heal += u.stat.heal; c.taken += u.stat.taken; c.deaths += u.stat.deaths;
      deaths += u.stat.deaths;
      for (const [a, n] of Object.entries(u.stat.casts)) add(seg.casts, `${u.classId}|${a}`, n);
    }
    place ||= activity === 'coop' ? b.meta?.encounterId : activity === 'rift' ? `tier${b.meta?.tier}` : b.meta?.zoneId;
    const f = seg.fights[`${activity}|${place || '?'}`] ||= { n: 0, wins: 0, sec: 0, deaths: 0, chars: 0 };
    f.n++; if (won) f.wins++; f.sec += sec; f.deaths += deaths; f.chars += chars.length;
    const heroLevel = chars.find(u => u.isMain)?.level || Math.max(...chars.map(u => u.level));
    const e = seg.econ[`${bandOf(heroLevel)}|${activity}`] ||= { n: 0, sec: 0, xp: 0, gold: 0 };
    e.n++; e.sec += sec + (won ? CONFIG.combat.restBetweenFights : CONFIG.combat.reviveDelay); e.xp += xp || 0; e.gold += gold || 0;
    if (activity === 'rift' && b.meta?.tier) {
      const r = seg.rifts[Math.floor((b.meta.tier - 1) / 10)] ||= { n: 0, wins: 0, timed: 0 };
      r.n++; if (won) { r.wins++; if (sec <= (b.meta.timeLimit || Infinity)) r.timed++; }
    }
  }

  // a hero reached `level` after `seconds` at the previous level
  recordLevel(p, ch, level, seconds, now = Date.now()) {
    if (!(seconds > 0)) return;
    const seg = this.current(now)[this.isBot(p.id) ? 'bot' : 'human'];
    const list = seg.levels[`${ch.classId}|${level}`] ||= [];
    if (list.length < SAMPLES) list.push(Math.round(seconds));
  }

  prune(now = Date.now()) {
    try { this.store.deleteDocsBetween(PREFIX, hourKey(now - KEEP_DAYS * 86400_000)); } catch { /* older stores */ }
  }

  // ---------------------------------------------------------------- reading
  query({ hours = 168, who = 'human', activity = 'all', now = Date.now() } = {}) {
    if (this.bucket) this.store.putDoc(this.key, this.bucket);
    this.store.flush();
    const docs = this.store.docsBetween(hourKey(now - hours * 3600_000), PREFIX + '￿');
    const pick = d => (who === 'all' ? [d.human, d.bot] : [d[who]]).filter(Boolean);
    const want = a => activity === 'all' || a === activity;
    const out = { hours, who, activity, buckets: docs.length, classes: {}, casts: {}, fights: {}, econ: {}, rifts: {}, levels: {}, players: 0, characterFights: 0, partyFights: 0 };
    const players = new Set();
    const sum = (target, src) => { for (const [k, v] of Object.entries(src)) target[k] = (target[k] || 0) + v; };
    for (const d of docs) {
      for (const seg of pick(d)) {
        for (const id of Object.keys(seg.players || {})) players.add(id);
        for (const [k, v] of Object.entries(seg.classes || {})) {
          const [cls, band, act] = k.split('|');
          if (!want(act)) continue;
          sum(out.classes[`${cls}|${band}`] ||= {}, v);
          out.characterFights += v.n;
        }
        if (activity === 'all') sum(out.casts, seg.casts || {});
        for (const [k, v] of Object.entries(seg.fights || {})) { if (want(k.split('|')[0])) { sum(out.fights[k] ||= {}, v); out.partyFights += v.n; } }
        for (const [k, v] of Object.entries(seg.econ || {})) { const [band, act] = k.split('|'); if (want(act)) sum(out.econ[band] ||= {}, v); }
        for (const [k, v] of Object.entries(seg.rifts || {})) sum(out.rifts[k] ||= {}, v);
        for (const [k, v] of Object.entries(seg.levels || {})) (out.levels[k] ||= []).push(...v);
      }
    }
    out.players = players.size;
    // level times: median per class & level, plus all classes together
    const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
    const all = {};
    const levels = {};
    for (const [k, v] of Object.entries(out.levels)) {
      const [cls, lvl] = k.split('|');
      levels[k] = { median: median(v), n: v.length };
      (all[lvl] ||= []).push(...v);
    }
    for (const [lvl, v] of Object.entries(all)) levels[`*|${lvl}`] = { median: median(v), n: v.length };
    out.levels = levels;
    return out;
  }
}
