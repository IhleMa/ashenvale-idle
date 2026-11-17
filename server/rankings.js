// Leaderboards and public player profiles ("inspect").
import { computeStats, powerRating } from '../shared/stats.js';
import { classTier, CLASSES } from '../shared/data/classes.js';
import { ZONES, COOP_ENCOUNTERS } from '../shared/data/zones.js';
import { ACHIEVEMENTS } from '../shared/data/achievements.js';
import { treeStats, spentPoints, totalSkillPoints } from '../shared/skilltree.js';
import { getTree } from '../shared/data/skilltree.js';
import * as L from './playerLogic.js';

export const RANKING_CATEGORIES = {
  level:        { label: 'Hero level', value: s => s.heroLevel * 1e9 + s.heroXp, display: s => `Lv ${s.heroLevel}` },
  power:        { label: 'Party power', value: s => s.partyPower, display: s => s.partyPower },
  heroPower:    { label: 'Hero power', value: s => s.heroPower, display: s => s.heroPower },
  kills:        { label: 'Enemies slain', value: s => s.kills, display: s => s.kills },
  bossKills:    { label: 'Bosses slain', value: s => s.bossKills, display: s => s.bossKills },
  coopWins:     { label: 'Co-op victories', value: s => s.coopWins, display: s => s.coopWins },
  achievements: { label: 'Achievements', value: s => s.achievements, display: s => `${s.achievements}/${Object.keys(ACHIEVEMENTS).length}` },
  rift:         { label: 'Highest rift', value: s => s.riftBest * 1e5 - (s.riftTime || 0), display: s => (s.riftBest ? `Tier ${s.riftBest}${s.riftTime ? ` · ${Math.floor(s.riftTime / 60)}:${String(Math.round(s.riftTime % 60)).padStart(2, '0')}` : ''}` : '—') },
  progress:     { label: 'World progress', value: s => s.zonesUnlocked * 1e6 + s.bossKills, display: s => `${s.zonesUnlocked} zone${s.zonesUnlocked === 1 ? '' : 's'}` },
};

export class Rankings {
  constructor(game) {
    this.game = game;
    this.cache = null;
    this.cachedAt = 0;
  }

  loadAll() {
    const out = [];
    for (const acc of this.game.store.allPlayerNames()) {
      const p = this.game.sessions.get(acc.id)?.player || this.game.store.loadPlayer(acc.id);
      if (!p || !p.heroId) continue;
      L.migratePlayer(p);
      out.push(p);
    }
    return out;
  }

  summary(p) {
    const h = L.hero(p);
    const party = L.activePartyChars(p);
    const heroPower = powerRating(computeStats(h));
    return {
      id: p.id, name: p.name, online: this.game.sessions.has(p.id),
      hero: { name: h.name, classId: h.classId, level: h.level, portrait: h.portrait, title: classTier(h.classId, h.level, true)?.title },
      heroLevel: h.level, heroXp: h.xp, heroPower,
      partyPower: party.reduce((s, c) => s + powerRating(computeStats(c)), 0),
      partyClasses: party.map(c => c.classId),
      kills: p.stats.kills || 0, bossKills: p.stats.bossKills || 0, coopWins: p.stats.coopWins || 0,
      achievements: Object.keys(p.achievements || {}).length, zonesUnlocked: p.unlockedZones.length,
      riftBest: p.rift?.best || 0, riftTime: p.rift?.bestTimes?.[p.rift?.best] || 0,
      bestiary: Object.keys(p.bestiary || {}).length,
      inGroup: !!this.game.groupOf(p.id),
    };
  }

  all() {
    if (!this.cache || Date.now() - this.cachedAt > 30_000) {
      this.cache = this.loadAll().map(p => this.summary(p));
      this.cachedAt = Date.now();
    }
    // online state changes often — refresh it on every request
    for (const s of this.cache) { s.online = this.game.sessions.has(s.id); s.inGroup = !!this.game.groupOf(s.id); }
    return this.cache;
  }

  board({ category = 'level', classId = null, search = '', limit = 100 } = {}, me) {
    const cat = RANKING_CATEGORIES[category] || RANKING_CATEGORIES.level;
    let list = [...this.all()].sort((a, b) => cat.value(b) - cat.value(a) || a.name.localeCompare(b.name));
    if (classId && CLASSES[classId]) list = list.filter(s => s.hero.classId === classId);
    const ranked = list.map((s, i) => ({ ...s, rank: i + 1, value: cat.display(s) }));
    const mine = ranked.find(s => s.id === me) || null;
    const q = String(search || '').trim().toLowerCase().slice(0, 30);
    const filtered = q ? ranked.filter(s => s.name.toLowerCase().includes(q) || s.hero.name.toLowerCase().includes(q)) : ranked;
    return { category, total: ranked.length, mine, rows: filtered.slice(0, Math.min(200, limit)) };
  }

  // Public profile. Gold, inventory and account details are never included.
  inspect(nameOrId) {
    const acc = typeof nameOrId === 'string' ? (this.game.store.getAccount(nameOrId) || this.game.store.findAccountById(nameOrId)) : null;
    if (!acc) return null;
    const session = this.game.sessions.get(acc.id);
    const p = session?.player || this.game.store.loadPlayer(acc.id);
    if (!p || !p.heroId) return null;
    L.migratePlayer(p);
    const g = this.game.groupOf(p.id);
    const hidden = p.settings?.publicProfile === false;
    const sum = this.summary(p);

    let activity = { state: 'offline', lastSeen: p.lastActive || null };
    if (session) {
      if (g?.battle) activity = { state: 'coop', title: g.battle.meta?.title, wave: g.battle.waveIndex + 1, waves: g.battle.waves.length };
      else if (session.solo?.battle) activity = { state: session.solo.kind === 'boss' ? 'boss' : 'fighting', title: session.solo.battle.meta?.title };
      else activity = { state: 'resting', title: ZONES[p.zone]?.name };
    }

    const charView = (ch, full) => {
      const s = computeStats(ch);
      const base = {
        id: ch.id, name: ch.name, classId: ch.classId, level: ch.level, isMain: !!ch.isMain, portrait: ch.portrait, role: ch.role,
        trait: ch.trait || null, title: classTier(ch.classId, ch.level, ch.isMain)?.title, power: powerRating(s),
        loadout: ch.loadout, ranks: ch.abilities,
      };
      if (!full) return base;
      const tree = getTree(ch.classId);
      const allocated = ch.tree?.allocated || ['start'];
      return {
        ...base,
        stats: { attributes: s.attributes, maxHp: s.maxHp, physPower: s.physPower, magPower: s.magPower, healPower: s.healPower, defense: s.defense, critChance: s.critChance, critDamage: s.critDamage, attackSpeed: s.attackSpeed },
        equipment: ch.equipment,
        rules: Object.fromEntries(ch.loadout.map(a => [a, ch.rules[a]])),
        tree: {
          allocated, spent: spentPoints(ch), total: totalSkillPoints(ch), bonuses: treeStats(ch),
          notables: allocated.map(id => tree.nodes[id]).filter(n => n && (n.type === 'notable' || n.type === 'keystone')).map(n => ({ name: n.name, type: n.type, stats: n.stats })),
        },
      };
    };

    const party = L.activePartyChars(p);
    return {
      id: p.id, name: p.name, online: !!session, activity, hidden,
      createdAt: p.createdAt, zone: p.zone, zoneName: ZONES[p.zone]?.name,
      summary: sum,
      // only categories where the player actually has something to show
      ranks: Object.fromEntries(Object.entries(RANKING_CATEGORIES).filter(([k, c]) => k === 'level' || c.value(sum) > 0)
        .map(([k]) => [k, this.board({ category: k, limit: 200 }).rows.find(r => r.id === p.id)?.rank || null])),
      group: g ? {
        leader: this.game.nameOf(g.leaderId), inBattle: !!g.battle,
        encounter: g.battle ? COOP_ENCOUNTERS[g.encounterId]?.name : null,
        members: g.members.map(id => {
          const mp = this.game.sessions.get(id)?.player || this.game.store.loadPlayer(id);
          const mh = mp && L.hero(mp);
          return { name: this.game.nameOf(id), online: this.game.sessions.has(id), bot: this.game.showBot?.(id), leader: id === g.leaderId, hero: mh ? { name: mh.name, classId: mh.classId, level: mh.level, portrait: mh.portrait } : null };
        }),
      } : null,
      hero: charView(L.hero(p), !hidden),
      party: party.map(c => charView(c, !hidden)),
      achievements: Object.keys(p.achievements || {}),
      rift: { best: p.rift?.best || 0, runs: p.rift?.runs || 0, timed: p.rift?.timed || 0 },
      stats: { kills: p.stats.kills, bossKills: p.stats.bossKills, coopWins: p.stats.coopWins, fights: p.stats.fights, recruited: p.stats.recruited, epicFound: p.stats.epicFound, legendaryFound: p.stats.legendaryFound },
      unlockedZones: p.unlockedZones,
    };
  }
}
