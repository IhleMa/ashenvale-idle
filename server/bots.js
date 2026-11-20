// Bot players: real accounts driven by a small "brain" that plays through the exact same actions a
// human uses (create a hero, recruit, gear up, fight, push zones and bosses, build the town, send
// expeditions, run rifts, claim quests, trade on the Auction House, form co-op groups and chat).
// Bots log in and out on their own schedule, so they also get offline progress like real players.
// Each bot has a personality: how skilled it is (good decisions), how active it is (time online),
// and what it likes doing (trading, crafting, rifts, groups) — so they progress at different speeds.
import crypto from 'node:crypto';
import { createAccount } from './auth.js';
import * as L from './playerLogic.js';
import { CLASSES } from '../shared/data/classes.js';
import { ZONES, COOP_ENCOUNTERS } from '../shared/data/zones.js';
import { BUILDINGS, MATERIALS } from '../shared/data/town.js';
import { EXPEDITIONS, EXPEDITION_DURATIONS, CAMP_SLOTS, CAMP_MEMBERS } from '../shared/data/expeditions.js';
import { canEquip, itemSellValue } from '../shared/data/items.js';
import { priceKey } from './auction.js';
import { computeStats, powerRating } from '../shared/stats.js';
import { availablePoints } from '../shared/skilltree.js';
import { rosterLimit, upgradeCost, canAfford, upgradeBlocker, bLevel } from '../shared/town.js';
import { busyWith } from '../shared/expeditions.js';
import { maxStartTier, RIFT } from '../shared/rifts.js';
import { featureLock } from '../shared/unlocks.js';
import { GEM_IDS, cutCost, parseGemKey } from '../shared/gems.js';
import { rarityIndex, CONFIG } from '../shared/config.js';
import { PRESETS, newRule } from '../shared/lootfilter.js';

import { CONTENT } from '../shared/content.js';

// names, chat lines and personality archetypes: content/bots.json
const NAMES = CONTENT.bots.names;
const SUFFIX = CONTENT.bots.suffixes;
const CHAT = CONTENT.bots.chat;
export const ARCHETYPES = CONTENT.bots.archetypes;

const clamp01 = v => Math.max(0.05, Math.min(1, v));
const pick = a => a[Math.floor(Math.random() * a.length)];
const chance = p => Math.random() < p;
const MIN = 60_000;

export class BotManager {
  constructor(game, { log = console.log } = {}) {
    this.game = game;
    this.store = game.store;
    this.log = log;
    const doc = this.store.getDoc('bots', { enabled: true, bots: [] });
    this.enabled = doc.enabled !== false;
    this.bots = new Map(); // accountId -> runtime state
    for (const b of doc.bots || []) this.bots.set(b.accountId, { ...b, online: false, nextSwitch: Date.now() + Math.random() * 20_000 });
    this.timer = null;
  }

  persist() {
    this.store.putDoc('bots', { enabled: this.enabled, bots: [...this.bots.values()].map(b => ({ accountId: b.accountId, name: b.name, archetype: b.archetype, persona: b.persona, createdAt: b.createdAt })) });
  }

  start() { if (!this.timer) this.timer = setInterval(() => this.tick(), 1000); }
  stop() { clearInterval(this.timer); this.timer = null; for (const b of this.bots.values()) this.goOffline(b, true); }

  isBot(accountId) { return this.bots.has(accountId); }

  setEnabled(on) {
    this.enabled = !!on;
    if (!this.enabled) for (const b of this.bots.values()) this.goOffline(b, true);
    this.persist();
  }

  // ------------------------------------------------------------------ management
  add(count = 1, archetype = null) {
    const made = [];
    for (let i = 0; i < Math.max(1, Math.min(50, count)); i++) {
      const type = ARCHETYPES[archetype] ? archetype : pick(Object.keys(ARCHETYPES));
      const name = this.freeName();
      const acc = createAccount(this.store, name, crypto.randomBytes(18).toString('base64')); // nobody can log in as a bot
      acc.bot = true;
      this.store.setAccount(acc);
      const a = ARCHETYPES[type];
      const jitter = v => clamp01(v + (Math.random() - 0.5) * 0.25);
      const persona = { skill: jitter(a.skill), activity: jitter(a.activity), trader: jitter(a.trader), crafter: jitter(a.crafter), rifter: jitter(a.rifter), social: jitter(a.social) };
      const b = { accountId: acc.id, name: acc.username, archetype: type, persona, createdAt: Date.now(), online: false, nextSwitch: Date.now() + Math.random() * 10_000 };
      this.bots.set(acc.id, b);
      made.push(b);
    }
    this.persist();
    this.store.flush();
    return made.map(b => ({ name: b.name, archetype: b.archetype }));
  }

  freeName() {
    for (let t = 0; t < 200; t++) {
      const n = pick(NAMES) + (t < 40 ? pick(SUFFIX) : Math.floor(Math.random() * 999));
      if (/^[A-Za-z0-9_]{3,16}$/.test(n) && !this.store.getAccount(n)) return n;
    }
    return 'Bot' + crypto.randomBytes(3).toString('hex');
  }

  remove(nameOrAll) {
    const list = [...this.bots.values()].filter(b => nameOrAll === 'all' || b.name.toLowerCase() === String(nameOrAll).toLowerCase());
    for (const b of list) {
      this.goOffline(b, true);
      if (this.game.groupOf(b.accountId)) { try { this.game.leaveGroup(b.accountId); } catch { /* ignore */ } }
      this.game.sessions.delete(b.accountId);
      this.game.auction.removeSeller(b.accountId);
      const acc = this.store.findAccountById(b.accountId);
      if (acc) this.store.deleteAccount(acc);
      this.bots.delete(b.accountId);
    }
    this.persist();
    this.game.onlineDirty = true;
    return list.length;
  }

  list() {
    return [...this.bots.values()].map(b => {
      const p = this.store.loadPlayer(b.accountId);
      const h = p && L.hero(p);
      return {
        name: b.name, archetype: b.archetype, label: ARCHETYPES[b.archetype]?.label, online: !!b.online, persona: b.persona,
        hero: h ? { name: h.name, classId: h.classId, level: h.level } : null, gold: p?.gold || 0, zone: p?.zone, rift: p?.rift?.best || 0,
        doing: b.doing || (b.online ? 'idle' : 'offline'), since: b.nextSwitch,
      };
    }).sort((a, b) => (b.hero?.level || 0) - (a.hero?.level || 0));
  }

  // ------------------------------------------------------------------ schedule
  tick() {
    if (!this.enabled) return;
    const now = Date.now();
    for (const b of this.bots.values()) {
      try {
        if (now >= b.nextSwitch) b.online ? this.goOffline(b) : this.goOnline(b);
        if (!b.online) continue;
        this.answerInvites(b);
        if (now >= (b.nextThink || 0)) { b.nextThink = now + this.thinkDelay(b); this.think(b); }
      } catch (e) {
        b.errors = (b.errors || 0) + 1;
        if (b.errors < 5) this.log(`[bots] ${b.name}: ${e.message}`);
      }
    }
  }

  thinkDelay(b) { return (12 + Math.random() * 25) * 1000 * (1.6 - b.persona.skill); }

  goOnline(b) {
    const acc = this.store.findAccountById(b.accountId);
    if (!acc) { this.bots.delete(b.accountId); return; }
    b.inbox = [];
    b.ws = { readyState: 1, send: data => this.onMessage(b, data) };
    b.session = this.game.connect(b.ws, acc);
    b.online = true;
    b.recent = b.recent || [];
    // sessions: 20–150 minutes; more active bots stay longer
    const len = (20 + Math.random() * 60 + b.persona.activity * 70) * MIN;
    b.nextSwitch = Date.now() + len;
    b.nextThink = Date.now() + 2000 + Math.random() * 4000;
    b.doing = 'logging in';
  }

  goOffline(b, force = false) {
    if (!b.online) { if (force) b.nextSwitch = Date.now() + 5000; return; }
    try {
      if (this.game.groupOf(b.accountId)) { this.say(b, pick(CHAT.bye)); this.act(b, 'group_leave'); }
    } catch { /* ignore */ }
    this.game.disconnect(b.ws, b.accountId);
    b.ws.readyState = 3;
    b.online = false;
    b.session = null;
    b.doing = 'offline';
    // time away: the less active, the longer (activity 0.9 → ~15 min, 0.2 → several hours)
    const away = (15 + (1 - b.persona.activity) * (1 - b.persona.activity) * 420 * (0.5 + Math.random())) * MIN;
    b.nextSwitch = Date.now() + (force ? 10_000 : away);
  }

  onMessage(b, data) {
    let m;
    try { m = JSON.parse(data); } catch { return; }
    if (m.t === 'result') { b.lastResult = m; return; }
    if (m.t === 'battle_end' && m.summary) {
      b.recent.push({ won: m.summary.result === 'victory', kind: m.summary.kind || m.k, at: Date.now() });
      if (b.recent.length > 12) b.recent.shift();
      if (m.k === 'coop') b.coopRuns = (b.coopRuns || 0) + 1;
      if (m.k === 'coop' && chance(0.35 * b.persona.social)) this.say(b, pick(m.summary.result === 'victory' ? CHAT.win : CHAT.lose));
    }
  }

  // runs an action exactly like a client would; returns the result or null on failure
  act(b, type, payload = {}) {
    if (!b.session) return null;
    b.lastResult = null;
    b.session.actionTokens = Math.max(b.session.actionTokens, 5); // bots don't spam, but never get stuck on the rate limit
    this.game.handleMessage(b.session, b.ws, JSON.stringify({ t: 'action', id: Math.floor(Math.random() * 1e9), type, payload }));
    const r = b.lastResult;
    return r?.ok ? (r.result ?? true) : null;
  }

  say(b, text) { if (this.game.groupOf(b.accountId)) this.act(b, 'group_chat', { text }); }

  // ------------------------------------------------------------------ the brain
  think(b) {
    const p = b.session.player;
    const P = b.persona;
    if (!p.heroId) return this.createHero(b);
    if (p.mailbox?.length) this.act(b, 'collect_mail', {});
    this.act(b, 'quest_claim', { id: 'all' });
    if ((p.expeditions || []).some(e => e.endsAt <= Date.now())) this.act(b, 'expedition_claim', {});
    this.spendSkillPoints(b, p);
    if (chance(0.5 + P.skill / 2)) this.equipUpgrades(b, p);
    this.manageRoster(b, p);
    if (chance(0.25 + P.crafter * 0.5)) this.manageTown(b, p);
    if (chance(0.3 + P.crafter * 0.4)) this.sendExpeditions(b, p);
    if (chance(0.15)) this.cleanInventory(b, p);
    if (chance(P.crafter * 0.5)) this.doGems(b, p);
    if (chance(P.trader * 0.6)) this.trade(b, p);
    const g = this.game.groupOf(p.id);
    if (g) return this.groupPlay(b, p, g);
    if (this.inRift(b)) {
      // like a player, a rift session ends after a while (rifts only give XP for new tiers, so endless repeats go nowhere)
      if (Date.now() - (b.riftSince || Date.now()) > b.riftFor) { this.act(b, 'rift_stop'); b.riftSince = 0; b.doing = 'back from the rift'; }
      else { b.doing = 'running a rift'; return; }
    }
    if (chance(P.social * 0.12) && this.formGroup(b, p)) return;
    if (L.hero(p).level >= RIFT.minLevel && chance(P.rifter * 0.25)) return this.startRift(b, p);
    this.manageZone(b, p);
  }

  createHero(b) {
    const classId = pick(Object.keys(CLASSES));
    const name = b.name.replace(/[^A-Za-z]/g, '').slice(0, 16) || pick(NAMES);
    this.act(b, 'create_hero', { name: name.length >= 2 ? name : pick(NAMES), classId });
    this.act(b, 'tutorial_skip');
    this.act(b, 'set_settings', { autoDevelopRecruits: true, autoDevelopHero: chance(0.7), autoLootAction: chance(0.8) ? 'salvage' : 'sell' });
    b.doing = 'creating a hero';
  }

  spendSkillPoints(b, p) {
    for (const ch of Object.values(p.characters)) if (availablePoints(ch) > 0 && chance(0.4 + b.persona.skill * 0.6)) this.act(b, 'auto_tree', { charId: ch.id });
  }

  power(ch, equipment = ch.equipment) { return powerRating(computeStats({ ...ch, equipment })); }

  bestUpgrade(ch, items) {
    let best = null, bestGain = 0;
    const base = this.power(ch);
    for (const it of items) {
      if (!canEquip(it, ch)) continue;
      const gain = this.power(ch, { ...ch.equipment, [it.slot]: it }) - base;
      if (gain > bestGain) { best = it; bestGain = gain; }
    }
    return best ? { item: best, gain: bestGain / Math.max(1, base) } : null;
  }

  fighters(p) { return Object.values(p.characters).filter(c => !this.isWorker(p, c.id) && !busyWith(p, c.id)); }
  isWorker(p, id) { return Object.values(p.town?.buildings || {}).some(x => x.worker === id); }

  equipUpgrades(b, p) {
    for (const ch of this.fighters(p)) {
      for (let n = 0; n < 4; n++) {
        const up = this.bestUpgrade(ch, p.inventory);
        // weaker bots sometimes miss upgrades or pick "shiny" ones
        if (!up || (b.persona.skill < 0.5 && chance(0.4))) break;
        if (!this.act(b, 'equip', { charId: ch.id, itemUid: up.item.uid })) break;
      }
    }
  }

  manageRoster(b, p) {
    const recruits = Object.values(p.characters).filter(c => !c.isMain);
    const limit = rosterLimit(p);
    const h = L.hero(p);
    if (recruits.length < limit && p.recruitment?.offers?.length) {
      const party = p.parties[p.activeParty].members.map(id => p.characters[id]).filter(Boolean);
      const roles = new Set(party.map(c => CLASSES[c.classId].role));
      const wantRole = !roles.has('healer') ? 'healer' : !roles.has('tank') ? 'tank' : 'damage';
      const offers = [...p.recruitment.offers].sort((x, y) => (CLASSES[y.classId].role === wantRole) - (CLASSES[x.classId].role === wantRole) || y.level - x.level);
      const offer = offers[0];
      const cost = L.recruitCost(p, offer);
      const reserve = recruits.length >= CONFIG.party.size - 1 ? 0.5 : 0.1; // first party fills fast, extra (workers) later
      if (offer && p.gold * (1 - reserve) >= cost && (recruits.length < CONFIG.party.size - 1 || chance(0.3 + b.persona.crafter * 0.4))) {
        if (this.act(b, 'recruit', { offerId: offer.offerId })) b.doing = `recruited ${offer.name}`;
      }
    }
    // best fighters into the active party (hero always)
    const fighters = this.fighters(p).filter(c => !c.isMain).sort((x, y) => this.power(y) - this.power(x));
    const party = p.parties[p.activeParty];
    const want = [p.heroId, ...this.balancedPick(fighters, CONFIG.party.size - 1)];
    if (want.join() !== party.members.join() && chance(0.4 + b.persona.skill * 0.6)) this.act(b, 'set_party', { index: p.activeParty, members: want });
    // arena: bots defend with their active party, so the arena has opponents (they don't attack)
    if (p.arena && p.arena.party == null && !featureLock(p, 'arena') && p.parties[p.activeParty]?.members.length) this.act(b, 'arena_set_party', { party: p.activeParty });
    void h;
  }

  balancedPick(chars, n) {
    const out = [];
    const take = role => { const c = chars.find(x => CLASSES[x.classId].role === role && !out.includes(x)); if (c) out.push(c); };
    take('healer'); take('tank');
    for (const c of chars) if (out.length < n && !out.includes(c)) out.push(c);
    return out.slice(0, n).map(c => c.id);
  }

  winRate(b, n = 8) {
    const r = (b.recent || []).filter(x => x.kind !== 'coop').slice(-n);
    return r.length ? r.filter(x => x.won).length / r.length : null;
  }

  manageZone(b, p) {
    const zones = Object.values(ZONES).sort((a, c) => a.order - c.order);
    const unlocked = zones.filter(z => p.unlockedZones.includes(z.id));
    const cur = ZONES[p.zone];
    const h = L.hero(p);
    const wr = this.winRate(b);
    const idx = unlocked.findIndex(z => z.id === p.zone);
    // losing too much → step back
    if (wr !== null && wr < 0.45 && idx > 0 && (b.recent || []).length >= 4) {
      this.act(b, 'set_zone', { zoneId: unlocked[idx - 1].id });
      b.recent = []; b.doing = `retreating to ${unlocked[idx - 1].name}`;
      return;
    }
    // a newer zone is open and we're strong enough → move up
    const next = unlocked[idx + 1];
    if (next && h.level >= next.levelRange[0] - (b.persona.skill > 0.8 ? 2 : 0) && (wr === null || wr >= 0.7)) {
      this.act(b, 'set_zone', { zoneId: next.id });
      b.recent = []; b.doing = `moving on to ${next.name}`;
      return;
    }
    // boss of the current zone: try when winning comfortably and high enough level (tryhards go earlier)
    const bossReady = h.level >= cur.levelRange[1] - Math.round(1 + b.persona.skill * 3);
    const notYetBeaten = !p.bossKills?.[cur.id];
    if (bossReady && (notYetBeaten || chance(0.08)) && (wr ?? 0) >= 0.85 && (b.recent || []).length >= 6 && Date.now() - (b.lastBoss || 0) > 4 * MIN) {
      b.lastBoss = Date.now();
      if (this.act(b, 'challenge_boss', { zoneId: cur.id })) { b.doing = `fighting the boss of ${cur.name}`; b.recent = []; return; }
    }
    b.doing = `farming ${cur.name}`;
  }

  inRift(b) {
    const s = b.session;
    return s?.solo?.kind === 'rift' || s?.solo?.next?.kind === 'rift';
  }

  startRift(b, p) {
    const max = maxStartTier(p);
    // careful bots repeat their best tier, ambitious ones push
    const tier = b.persona.rifter > 0.6 || chance(b.persona.skill) ? max : Math.max(1, max - 1);
    if (this.act(b, 'rift_settings', { auto: b.persona.rifter > 0.75 ? 'push' : chance(0.5) ? 'repeat' : 'off' }) !== null && this.act(b, 'rift_start', { tier })) {
      b.doing = `running rift tier ${tier}`;
      b.riftSince = Date.now();
      b.riftFor = (10 + Math.random() * 30 * (0.5 + b.persona.rifter)) * MIN; // 10–55 minutes, longer for rift lovers
    }
  }

  // ------------------------------------------------------------------ town, expeditions, crafting
  manageTown(b, p) {
    if (!p.town) return;
    const order = ['inn', 'town_hall', 'expedition_camp', 'salvage_yard', 'jeweler', 'blacksmith', 'alchemy_lab', 'enchanter', 'leatherworker', 'tailor'];
    const reserve = 0.25;
    for (const id of order) {
      const bl = p.town.buildings[id];
      if (!bl || upgradeBlocker(p, id)) continue;
      const cost = upgradeCost(id, bl.level + 1);
      if (p.gold - cost.gold < p.gold * reserve) continue;
      if (this.act(b, 'town_upgrade', { buildingId: id })) { b.doing = `upgrading the ${BUILDINGS[id].name}`; break; }
    }
    // assign spare recruits with a matching profession (not in the active party)
    const party = new Set(p.parties[p.activeParty].members);
    for (const [id, def] of Object.entries(BUILDINGS)) {
      const bl = p.town.buildings[id];
      if (!def.profession || !bl || bl.level < 1 || bl.worker) continue;
      const c = Object.values(p.characters).find(ch => !ch.isMain && !party.has(ch.id) && ch.profession?.id === def.profession && !this.isWorker(p, ch.id) && !busyWith(p, ch.id));
      if (c) this.act(b, 'town_assign', { buildingId: id, charId: c.id });
    }
  }

  sendExpeditions(b, p) {
    const camp = bLevel(p, 'expedition_camp');
    if (camp < 1) return;
    const slots = CAMP_SLOTS[camp] - (p.expeditions || []).length;
    if (slots <= 0) return;
    const party = new Set(p.parties[p.activeParty].members);
    let idle = Object.values(p.characters).filter(c => !c.isMain && !party.has(c.id) && !busyWith(p, c.id) && !this.isWorker(p, c.id));
    let short = false;
    if (!idle.length) {
      // like a real player: lend the weakest party member for a short trip when the town needs materials
      if (!this.neededMaterial(p) && (p.town.materials.ore || 0) >= 20) return;
      if ((p.expeditions || []).length) return;
      const weakest = Object.values(p.characters).filter(c => !c.isMain && party.has(c.id) && !busyWith(p, c.id)).sort((x, y) => this.power(x) - this.power(y))[0];
      if (!weakest || chance(0.5)) return;
      idle = [weakest];
      short = true;
    }
    const h = L.hero(p);
    const dests = Object.values(EXPEDITIONS).filter(d => d.campLevel <= camp && d.level <= h.level + 5);
    const need = this.neededMaterial(p);
    const dest = (need && dests.filter(d => need in d.yields).pop()) || pick(dests.slice(-3));
    if (!dest) return;
    const members = idle.slice(0, CAMP_MEMBERS[camp]).map(c => c.id);
    const hoursLeft = (b.nextSwitch - Date.now()) / 3600000;
    const dur = short || need ? EXPEDITION_DURATIONS[1] : EXPEDITION_DURATIONS.filter(d => d.hours <= Math.max(0.25, hoursLeft + 2)).pop() || EXPEDITION_DURATIONS[0];
    if (this.act(b, 'expedition_start', { destId: dest.id, charIds: members, hours: dur.hours })) b.doing = `sent an expedition to ${dest.name}`;
  }

  cleanInventory(b, p) {
    // set up a loot filter once (better bots use it)
    if (!p.lootFilter?.enabled && chance(0.3 + b.persona.skill * 0.7)) {
      const rules = [newRule(PRESETS.junk.rule), newRule(PRESETS.unusable.rule)];
      if (b.persona.skill > 0.7) rules.push(newRule(PRESETS.outdated.rule));
      this.act(b, 'loot_filter_save', { filter: { enabled: true, protectUpgrades: true, rules } });
    }
    if (p.inventory.length > CONFIG.inventory.limit * 0.7) {
      if (bLevel(p, 'salvage_yard') >= 1 && chance(0.6)) this.act(b, 'salvage_by_rarity', { maxRarity: 'uncommon' });
      else this.act(b, 'sell_by_rarity', { maxRarity: 'uncommon' });
    }
  }

  doGems(b, p) {
    if (!p.town || !p.town.buildings.jeweler?.worker) return;
    const cc = cutCost(1);
    if (p.gold > 2000 + cc.gold && Object.entries(cc.mats).every(([k, v]) => (p.town.materials[k] || 0) >= v) && chance(0.3)) { this.act(b, 'gem_cut', { kind: GEM_IDS[Math.floor(Math.random() * GEM_IDS.length)] }); b.doing = 'cutting gems'; }
    for (const [key, n] of Object.entries(p.town.gems || {})) {
      const g = parseGemKey(key);
      if (g && n >= 3 && g.tier < 5 && chance(0.5)) this.act(b, 'gem_fuse', { kind: g.kind, tier: g.tier });
    }
    // socket the best gem into an empty socket on a fighter
    const gems = Object.entries(p.town.gems || {}).filter(([, n]) => n > 0).map(([k]) => k).sort((x, y) => parseGemKey(y).tier - parseGemKey(x).tier);
    if (!gems.length) return;
    for (const ch of this.fighters(p)) {
      for (const it of Object.values(ch.equipment)) {
        const i = (it?.sockets || []).indexOf(null);
        if (i >= 0) { this.act(b, 'gem_socket', { itemUid: it.uid, charId: ch.id, index: i, gem: gems[0] }); return; }
      }
    }
  }

  // ------------------------------------------------------------------ auction house
  marketPrice(key) {
    const hist = (this.game.auction.data.history || []).filter(h => h.key === key).slice(-10);
    if (!hist.length) return null;
    const s = hist.map(h => h.unit).sort((a, c) => a - c);
    return s[Math.floor(s.length / 2)];
  }

  trade(b, p) {
    const ah = this.game.auction;
    const mine = ah.data.listings.filter(l => l.sellerId === p.id).length;
    // sell: spare good items nobody in the roster wants
    if (mine < 6) {
      const roster = Object.values(p.characters);
      const spare = p.inventory.filter(it => !it.locked && rarityIndex(it.rarity) >= 2 && !roster.some(ch => canEquip(it, ch) && this.power(ch, { ...ch.equipment, [it.slot]: it }) > this.power(ch)));
      const it = spare.sort((x, y) => rarityIndex(y.rarity) - rarityIndex(x.rarity) || y.level - x.level)[0];
      if (it) {
        const base = this.marketPrice(priceKey({ kind: 'item', item: it })) || itemSellValue(it) * (2 + rarityIndex(it.rarity) * 1.5) * (it.unique || it.set ? 4 : 1);
        const price = Math.max(5, Math.round(base * (0.8 + Math.random() * 0.6) * (1.3 - b.persona.skill * 0.4)));
        if (this.act(b, 'ah_list', { itemUid: it.uid, price, hours: pick([12, 24, 48]) })) { b.doing = `selling ${it.name}`; return; }
      }
      // surplus materials
      const mats = Object.entries(p.town?.materials || {}).filter(([k, v]) => MATERIALS[k] && v >= (MATERIALS[k].group === 'shard' ? 120 : 80));
      if (mats.length && chance(0.5)) {
        const [mat, have] = pick(mats);
        const qty = Math.min(Math.floor(have / 3), 50);
        const unit = this.marketPrice(`mat:${mat}`) || (MATERIALS[mat].group === 'shard' ? 6 : ['void_crystal', 'prismatic_shard', 'magic_essence'].includes(mat) ? 60 : 4);
        if (qty >= 5 && this.act(b, 'ah_list', { material: mat, qty, price: Math.max(qty, Math.round(unit * qty * (0.85 + Math.random() * 0.4))), hours: 24 })) { b.doing = `selling ${MATERIALS[mat].name}`; return; }
      }
    }
    // buy: a cheap upgrade for someone in the party
    if (p.inventory.length < CONFIG.inventory.limit - 2) {
      const budget = p.gold * (0.15 + b.persona.trader * 0.25);
      const listings = ah.data.listings.filter(l => l.kind === 'item' && l.sellerId !== p.id && l.expiresAt > Date.now() && l.price <= budget);
      let best = null;
      for (const ch of this.fighters(p)) {
        const up = this.bestUpgrade(ch, listings.map(l => l.item));
        if (up && up.gain > 0.02 && (!best || up.gain > best.gain)) best = { ...up, listing: listings.find(l => l.item === up.item) };
      }
      if (best && this.act(b, 'ah_buy', { id: best.listing.id })) { b.doing = `bought ${best.item.name}`; return; }
      // materials needed for the next building upgrade
      const want = this.neededMaterial(p);
      if (want) {
        const l = ah.data.listings.filter(x => x.kind === 'material' && x.material === want && x.sellerId !== p.id && x.expiresAt > Date.now() && x.price <= budget).sort((x, y) => x.price / x.qty - y.price / y.qty)[0];
        if (l && this.act(b, 'ah_buy', { id: l.id })) b.doing = `bought ${MATERIALS[want].name}`;
      }
    }
  }

  neededMaterial(p) {
    if (!p.town) return null;
    for (const id of ['town_hall', 'inn', 'expedition_camp', 'salvage_yard', 'jeweler']) {
      const bl = p.town.buildings[id];
      if (!bl || bl.upgrade || bl.level >= BUILDINGS[id].maxLevel) continue;
      const cost = upgradeCost(id, bl.level + 1);
      if (canAfford(p, cost)) continue;
      const miss = Object.entries(cost.mats || {}).find(([k, v]) => (p.town.materials[k] || 0) < v);
      if (miss) return miss[0];
    }
    return null;
  }

  // ------------------------------------------------------------------ groups & co-op
  answerInvites(b) {
    const busy = !!this.game.groupOf(b.accountId);
    for (const g of this.game.groups.values()) {
      const exp = g.invites.get(b.accountId);
      if (!exp || exp < Date.now()) continue;
      b.inviteSeen ||= {};
      const seen = b.inviteSeen[g.id] || (b.inviteSeen[g.id] = Date.now() + (3 + Math.random() * 10) * 1000); // "notices" it after a few seconds
      if (Date.now() < seen) return;
      if (busy) { this.act(b, 'group_decline', { groupId: g.id }); continue; } // already in a group
      const fromHuman = !this.bots.has(g.leaderId);
      if (chance(fromHuman ? 0.6 + b.persona.social * 0.4 : 0.4 + b.persona.social * 0.5) && !this.inRift(b)) {
        if (this.act(b, 'group_accept', { groupId: g.id })) { b.doing = `grouped with ${this.game.nameOf(g.leaderId)}`; b.groupSince = Date.now(); this.prepareCoop(b, b.session.player); if (chance(0.5)) this.say(b, pick(CHAT.hello)); }
      } else this.act(b, 'group_decline', { groupId: g.id });
      return;
    }
  }

  prepareCoop(b, p) {
    const best = this.fighters(p).filter(c => !c.isMain).sort((x, y) => this.power(y) - this.power(x));
    this.act(b, 'set_coop_chars', { charIds: this.balancedPick(best, CONFIG.coop.recruitsPerPlayer ?? 1) });
  }

  formGroup(b, p) {
    const h = L.hero(p);
    if (h.level < Math.min(...Object.values(COOP_ENCOUNTERS).map(e => e.minLevel)) + 2) return false; // nothing to do together yet
    const others = [...this.bots.values()].filter(o => o !== b && o.online && !this.game.groupOf(o.accountId) && !this.inRift(o));
    const candidates = others.filter(o => { const oh = L.hero(o.session.player); return oh && Math.abs(oh.level - h.level) <= 8; });
    if (!candidates.length) return false;
    if (!this.act(b, 'group_create')) return false;
    this.prepareCoop(b, p);
    for (const o of candidates.sort(() => Math.random() - 0.5).slice(0, 1 + Math.floor(Math.random() * 3))) this.act(b, 'group_invite', { name: o.name });
    b.groupSince = Date.now();
    b.doing = 'looking for a group';
    return true;
  }

  inviteMore(b, p, g) {
    const h = L.hero(p);
    const o = [...this.bots.values()].find(x => x !== b && x.online && !this.game.groupOf(x.accountId) && !this.inRift(x) && Math.abs((L.hero(x.session.player)?.level || 0) - h.level) <= 8);
    if (o) this.act(b, 'group_invite', { name: o.name });
  }

  groupPlay(b, p, g) {
    b.doing = `in a group with ${g.members.filter(id => id !== p.id).map(id => this.game.nameOf(id)).join(', ') || 'nobody yet'}`;
    const tired = Date.now() - (b.groupSince || 0) > (20 + b.persona.social * 40) * MIN;
    if (g.leaderId !== p.id) {
      if (tired && !g.battle && chance(0.3)) { this.say(b, pick(CHAT.bye)); this.act(b, 'group_leave'); }
      return;
    }
    if (g.battle) return;
    const alone = g.members.length < 2;
    if ((alone && g.invites.size === 0 && Date.now() - (b.groupSince || 0) > 3 * MIN) || tired) { this.act(b, 'group_leave'); return; }
    if (alone) return;
    const minLevel = Math.min(...g.members.map(id => L.hero(this.game.sessions.get(id)?.player || {})?.level || 0));
    const coop = (b.recent || []).filter(x => x.kind === 'coop');
    const streak = coop.slice(-3);
    if (streak.length === 3 && streak.every(x => !x.won)) { this.say(b, pick(CHAT.lose)); this.act(b, 'group_leave'); b.recent = b.recent.filter(x => x.kind !== 'coop'); return; }
    // small groups only try encounters well below their level
    const margin = g.members.length >= 3 ? 0 : 6;
    const encs = Object.values(COOP_ENCOUNTERS).filter(e => e.minLevel + margin <= minLevel).sort((x, y) => x.minLevel - y.minLevel);
    if (!encs.length) { if (g.members.length < CONFIG.coop.maxPlayers && g.invites.size === 0) this.inviteMore(b, p, g); return; }
    const lost = streak.filter(x => !x.won).length;
    const enc = lost >= 1 ? encs[0] : chance(0.5 + b.persona.skill * 0.3) ? encs[encs.length - 1] : pick(encs);
    if (this.act(b, 'group_start', { encounterId: enc.id })) b.doing = `leading ${enc.name}`;
  }
}
