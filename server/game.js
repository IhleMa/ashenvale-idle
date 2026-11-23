// Game server: sessions, action dispatch, server-authoritative battle loop, offline progression, groups.
import { ACTION_FEATURE, FEATURE_LABELS, featureLock, unlockHeroLevel } from '../shared/unlocks.js';
import crypto from 'node:crypto';
import { CONFIG } from '../shared/config.js';
import { ZONES, COOP_ENCOUNTERS } from '../shared/data/zones.js';
import { generateItem, itemSellValue } from '../shared/data/items.js';
import { createBattle, stepBattle, drainEvents, battleSnapshot, dynamicUnit, runToEnd } from '../shared/combat.js';
import { buildPartyUnits, partyBonuses } from '../shared/party.js';
import { idleWaves, bossWaves, coopWaves, coopScale, computeRewards, zoneLevel } from '../shared/encounters.js';
import { coopLineup } from '../shared/coop.js';
import { createRng, randomSeed } from '../shared/rng.js';
import { ABILITIES } from '../shared/data/abilities.js';
import { Rankings } from './rankings.js';
import { COSMETICS, COSMETIC_KINDS, cosmetic, ownsCosmetic, publicCosmetics } from '../shared/data/cosmetics.js';
import { Arena } from './arena.js';
import { Pinnacle } from './pinnacle.js';
import { PINNACLE, PINNACLE_BOSSES, pinnacleWaves, pinnacleScale, pinnacleState } from '../shared/pinnacle.js';
import { AuctionHouse } from './auction.js';
import { adminActions } from './admin.js';
import { Announcements } from './announcements.js';
import { Suggestions, SUGGESTION_CATEGORIES } from './suggestions.js';
import * as TL from './townLogic.js';
import * as XL from './expeditionLogic.js';
import * as TU from './tutorialLogic.js';
import { TUTORIAL, currentStep } from '../shared/tutorial.js';
import { BalanceStats } from './balance.js';
import { EXPEDITIONS } from '../shared/data/expeditions.js';
import { elixirBonuses } from '../shared/town.js';
import { speedUpCost } from '../shared/premium.js';
import { BUILDINGS } from '../shared/data/town.js';
import * as L from './playerLogic.js';
import * as Q from './questLogic.js';
import { masteryMap } from '../shared/bestiary.js';
import { RIFT, riftWaves, riftScale, riftHooks, affixesFor, maxStartTier, riftTheme, riftRewardOptions, riftChest, firstClearCrystals, riftCleared, repeatXpGold, riftLevel } from '../shared/rifts.js';

const { GameError } = L;
const SAVE_NOW = new Set(['ascend', 'ah_list', 'ah_buy', 'ah_cancel', 'collect_mail', 'town_speedup', 'expedition_speedup']);
const READ_ONLY = new Set(['get_rankings', 'inspect_player', 'ah_search', 'ah_mine', 'arena_view', 'my_suggestions']);
const fail = m => { throw new GameError(m); };

export class Game {
  constructor({ store, assets, settings, admins = null, buildId = 'dev', log = console.log }) {
    this.buildId = buildId;
    this.settings = settings;
    // live balance statistics (Admin → ⚖ Balance); bots are counted separately
    this.balance = new BalanceStats(store, { isBot: id => !!this.bots?.bots?.has(id) });
    L.levelHooks.push((p, ch, level, seconds) => { if (ch.isMain) this.balance.recordLevel(p, ch, level, seconds); });
    this.admins = admins;
    this.startedAt = Date.now();

    this.store = store;
    this.assets = assets;
    this.log = log;
    this.sessions = new Map(); // playerId -> session
    this.groups = new Map();   // groupId -> group
    this.playerGroup = new Map(); // playerId -> groupId
    this.tickHandle = null;
    this.saveHandle = null;
    this.onlineDirty = true;
    this.rankings = new Rankings(this);
    this.arena = new Arena(this);
    this.pinnacle = new Pinnacle(this);
    this.auction = new AuctionHouse(this);
    this.announcements = new Announcements(store);
    this.suggestions = new Suggestions(store);
    this.adminActions = adminActions(this);
  }

  start() {
    this.tickHandle = setInterval(() => this.tick(), CONFIG.combat.tickMs);
    this.saveHandle = setInterval(() => this.save(), 5000);
  }

  stop() {
    clearInterval(this.tickHandle);
    clearInterval(this.saveHandle);
    const now = Date.now();
    for (const s of this.sessions.values()) { s.player.lastActive = now; this.store.savePlayerSoon(s.player); }
    this.auction.save();
    this.saveGroups();
    this.store.flush();
  }

  // Groups survive restarts (battles and pending invites do not)
  saveGroups() {
    const data = [...this.groups.values()].map(g => ({ id: g.id, leaderId: g.leaderId, members: g.members, leaderRecruits: g.leaderRecruits || null, chat: g.chat.slice(-30) }));
    this.store.putDoc('groups', data);
  }
  loadGroups() {
    const data = this.store.getDoc('groups', []);
    if (!Array.isArray(data)) return;
    for (const g of data) {
      if (!Array.isArray(g.members) || !g.members.length) continue;
      const group = { id: g.id, leaderId: g.members.includes(g.leaderId) ? g.leaderId : g.members[0], members: g.members, leaderRecruits: Array.isArray(g.leaderRecruits) ? g.leaderRecruits : null, invites: new Map(), battle: null, chat: g.chat || [] };
      this.groups.set(group.id, group);
      for (const m of group.members) this.playerGroup.set(m, group.id);
    }
    if (data.length) this.log(`Restored ${data.length} group(s)`);
  }

  // Creates a persistent announcement and shows it to everyone online right now
  announce(text, from, hours = 168) {
    const a = this.announcements.add({ text, from, hours });
    this.broadcast({ t: 'announcement', announcement: a });
    return a;
  }

  // name → worn cosmetics of every player who wears any (built once, then kept up to date)
  cosmeticMap() {
    if (!this._cosmetics) {
      this._cosmetics = {};
      for (const acc of this.store.allPlayerNames()) {
        const p = this.sessions.get(acc.id)?.player || this.store.loadPlayer(acc.id);
        const c = p && publicCosmetics(p);
        if (c) this._cosmetics[p.name] = c;
      }
    }
    return this._cosmetics;
  }
  cosmeticChanged(p) {
    const c = publicCosmetics(p), map = this.cosmeticMap();
    if (c) map[p.name] = c; else delete map[p.name];
    this.broadcast({ t: 'cosmetic', name: p.name, cosmetics: c });
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const s of this.sessions.values()) for (const ws of s.sockets) if (ws.readyState === 1) ws.send(data);
  }

  save() {
    const now = Date.now();
    for (const s of this.sessions.values()) { s.player.lastActive = now; this.store.savePlayerSoon(s.player); }
    this.auction.save();
    this.store.flush(); // one transaction: players, accounts, auction house, logs
  }

  // ------------------------------------------------------------------ connections
  isAdmin(account) { return !!this.admins?.has(account.username.toLowerCase()); }

  connect(ws, account) {
    let player = this.store.loadPlayer(account.id);
    if (!player) { player = L.newPlayer(account); this.store.savePlayerSoon(player); }
    L.migratePlayer(player);
    let s = this.sessions.get(player.id);
    const first = !s;
    if (!s) {
      s = { player, sockets: new Set(), solo: null, stateDirty: true, actionTokens: 40, lastRefill: Date.now() };
      this.sessions.set(player.id, s);
    }
    if (s.graceTimer) { clearTimeout(s.graceTimer); s.graceTimer = null; } // reconnected within the grace period
    s.sockets.add(ws);
    this.send(ws, { t: 'welcome', playerId: player.id, name: player.name, serverTime: Date.now(), buildId: this.buildId, config: { version: CONFIG.version }, isAdmin: this.isAdmin(account), motd: this.settings.get('motd') || '', auction: { feePct: this.settings.get('auctionFeePct'), taxPct: this.settings.get('auctionTaxPct') }, premium: { minutesPerCrystal: this.settings.get('premiumMinutesPerCrystal') } });
    this.send(ws, { t: 'cosmetics', map: this.cosmeticMap() });
    Q.ensureQuests(player); // before offline progress, so it counts toward today's quests
    if (first) this.handleOffline(s);
    L.maybeAutoRefreshRecruits(player, this.assets.get());
    s.stateDirty = true;
    this.flushState(s);
    // current battle snapshot
    const g = this.groupOf(player.id);
    if (g?.battle) this.send(ws, { t: 'battle_start', k: 'coop', battle: battleSnapshot(g.battle) });
    else if (s.solo?.battle) this.send(ws, { t: 'battle_start', k: 'solo', battle: battleSnapshot(s.solo.battle) });
    if (g) this.send(ws, { t: 'group', group: this.publicGroup(g) });
    this.sendInvites(player.id);
    // announcements: full recent list + which ones this player hasn't read yet (also after being offline)
    this.send(ws, { t: 'announcements', list: this.announcements.active().slice(0, 20), unseen: this.announcements.unseenFor(player).map(a => a.id) });
    this.onlineDirty = true;
    return s;
  }

  disconnect(ws, playerId) {
    const s = this.sessions.get(playerId);
    if (!s) return;
    s.sockets.delete(ws);
    if (s.sockets.size === 0 && !s.graceTimer) {
      // Keep the session (and its running fight) alive briefly so page reloads and
      // short connection drops don't interrupt anything.
      s.graceTimer = setTimeout(() => {
        s.graceTimer = null;
        if (s.sockets.size > 0) return;
        s.player.lastActive = Date.now();
        this.store.savePlayerSoon(s.player);
        this.sessions.delete(playerId);
        this.onlineDirty = true;
        const g = this.groupOf(playerId);
        if (g) this.broadcastGroup(g);
      }, 30_000);
    }
  }

  send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
  sendTo(playerId, msg) {
    // headless (levelling simulation): only bots listen, and they only read action results and fight endings
    if (this.headless && msg.t !== 'result' && msg.t !== 'battle_end') return;
    const s = this.sessions.get(playerId);
    if (!s) return;
    const data = JSON.stringify(msg);
    for (const ws of s.sockets) if (ws.readyState === 1) ws.send(data);
  }
  toast(playerId, text, kind = 'info') { this.sendTo(playerId, { t: 'toast', text, kind }); }

  flushState(s) {
    if (!s.stateDirty) return;
    s.stateDirty = false;
    if (s.player.tutorial && !s.player.tutorial.done) this.tutorialToasts(s, TU.checkTutorial(s.player));
    if (this.headless) return; // nobody to show the state to
    this.sendTo(s.player.id, { t: 'state', player: L.publicPlayer(s.player) });
  }

  tutorialToasts(s, done) {
    for (const d of done) {
      this.toast(s.player.id, `✔ ${d.step.title}${d.reward.length ? ` — ${d.reward.join(', ')}` : ''}`, 'success');
      this.store.savePlayerSoon(s.player);
    }
    if (done.length) this.sendTo(s.player.id, { t: 'tutorial', done: done.map(d => ({ id: d.step.id, reward: d.reward })), next: done[done.length - 1].next?.id || null });
  }

  markDirty(s) { s.stateDirty = true; this.store.savePlayerSoon(s.player); }

  // after a content change: uniques of everyone online and in the auction house follow their new definition
  // (offline players are updated when they next log in)
  syncUniquesEverywhere() {
    let n = 0;
    for (const s of this.sessions.values()) { const c = L.syncUniques(s.player); if (c) { n += c; this.markDirty(s); } }
    return n + (this.auction?.syncUniques() || 0);
  }

  // ------------------------------------------------------------------ actions
  handleMessage(s, ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    // simple token bucket against spam
    const now = Date.now();
    s.actionTokens = Math.min(40, s.actionTokens + ((now - s.lastRefill) / 1000) * 15);
    s.lastRefill = now;
    if (s.actionTokens < 1) return this.send(ws, { t: 'result', id: msg.id, ok: false, error: 'Slow down!' });
    s.actionTokens -= 1;

    if (msg.t === 'ping') return this.send(ws, { t: 'pong', id: msg.id, serverTime: now });
    if (msg.t !== 'action') return;
    const isAdminAction = typeof msg.type === 'string' && msg.type.startsWith('admin_');
    if (isAdminAction && !this.admins?.has(s.player.name)) return this.send(ws, { t: 'result', id: msg.id, ok: false, error: 'Admins only' });
    const handler = isAdminAction ? this.adminActions[msg.type] : this.actions[msg.type];
    if (!handler) return this.send(ws, { t: 'result', id: msg.id, ok: false, error: 'Unknown action' });
    try {
      const payload = msg.payload && typeof msg.payload === 'object' ? msg.payload : {};
      const p = s.player;
      if (!p.heroId && msg.type !== 'create_hero' && !isAdminAction) fail('Create your hero first');
      const feature = ACTION_FEATURE[msg.type];
      if (feature && featureLock(p, feature)) fail(`${FEATURE_LABELS[feature] || feature} unlocks at hero level ${featureLock(p, feature)}`);
      const result = handler.call(this, s, payload);
      if (!READ_ONLY.has(msg.type) && !isAdminAction) this.markDirty(s);
      // value moving between players (trades, mail, admin gifts) is written to disk right away, in one transaction
      if (isAdminAction || SAVE_NOW.has(msg.type)) this.save();
      this.send(ws, { t: 'result', id: msg.id, ok: true, result: result ?? null });
      this.flushState(s);
    } catch (e) {
      if (!(e instanceof GameError)) this.log('Action error', msg.type, e);
      this.send(ws, { t: 'result', id: msg.id, ok: false, error: e instanceof GameError ? e.message : 'Server error', ...(e instanceof GameError && e.details ? { details: e.details } : {}) });
    }
  }

  actions = {
    create_hero(s, d) {
      const ch = L.createHero(s.player, d, this.assets.get());
      TU.startTutorial(s.player);
      if (s.player.tutorial.done) this.toast(s.player.id, `Welcome to Ashenvale, ${ch.name}! Your first companion is free — visit Recruitment.`, 'success');
      this.onlineDirty = true;
    },
    allocate_nodes(s, d) {
      const r = L.allocateNodes(s.player, d);
      this.liveUpdateChar(s.player, d.charId);
      const names = r.notEquipped.map(a => ABILITIES[a]?.name).filter(Boolean);
      if (names.length) this.toast(s.player.id, `${names.join(', ')} learned — but the loadout is full. Equip it on the Abilities page or it won't be used.`, 'info');
      return r;
    },
    refund_node(s, d) { const r = L.refundNode(s.player, d); this.liveUpdateChar(s.player, d.charId); return r; },
    tree_plan_set(s, d) { const r = L.setTreePlan(s.player, d); this.liveUpdateChar(s.player, d.charId); return r; },
    build_save(s, d) { const r = L.saveBuild(s.player, d); this.liveUpdateChar(s.player, d.charId); return r; },
    build_load(s, d) { const r = L.loadBuild(s.player, d); this.liveUpdateChar(s.player, d.charId); return r; },
    build_rename(s, d) { return L.renameBuild(s.player, d); },
    build_delete(s, d) { L.deleteBuild(s.player, d); },
    reset_tree(s, d) { const r = L.resetTree(s.player, d); this.liveUpdateChar(s.player, d.charId); return r; },
    auto_tree(s, d) { L.autoTree(s.player, d); this.liveUpdateChar(s.player, d.charId); },
    set_loadout(s, d) { L.setLoadout(s.player, d); this.liveUpdateChar(s.player, d.charId); },
    set_rule(s, d) { L.setRule(s.player, d); this.liveUpdateChar(s.player, d.charId); },
    reset_rule(s, d) { L.resetRule(s.player, d); this.liveUpdateChar(s.player, d.charId); },
    set_role(s, d) { L.setRole(s.player, d); },
    rename_character(s, d) { L.renameCharacter(s.player, d); },
    equip(s, d) { L.equip(s.player, d); },
    unequip(s, d) { L.unequip(s.player, d); },
    sell_item(s, d) { return { gold: L.sellItem(s.player, d) }; },
    sell_by_rarity(s, d) { return L.sellByRarity(s.player, d); },
    loot_filter_save(s, d) { return L.setLootFilter(s.player, { filter: d.filter }); },
    loot_filter_apply(s, d) { return L.applyLootFilter(s.player, { dryRun: !!d.dryRun }); },
    loot_log_clear(s) { s.player.lootLog = []; },
    toggle_lock(s, d) { L.toggleLock(s.player, d); },
    set_settings(s, d) { L.setSettings(s.player, d); },
    // ---- cosmetics (gold sink, no power)
    cosmetic_buy(s, d) {
      const p = s.player, kind = String(d.kind), id = String(d.id);
      const c = COSMETIC_KINDS[kind] && cosmetic(kind, id);
      if (!c) fail('Unknown cosmetic');
      if (c.achievement) fail('This title is earned through an achievement');
      if (c.pinnacle) fail('This is earned by defeating a pinnacle boss');
      if (ownsCosmetic(p, kind, id)) fail('You already own this');
      const price = Math.max(0, Math.round(c.price || 0));
      if (p.gold < price) fail(`You need ${price.toLocaleString('en')} gold`);
      p.gold -= price;
      p.cosmetics.owned.push(`${kind}:${id}`);
      p.stats.cosmeticGold = (p.stats.cosmeticGold || 0) + price;
      p.cosmetics.equipped[kind] = id; // wear it right away
      this.cosmeticChanged(p);
      return { price };
    },
    cosmetic_equip(s, d) {
      const p = s.player, kind = String(d.kind), id = d.id == null ? null : String(d.id);
      if (!COSMETIC_KINDS[kind]) fail('Unknown cosmetic');
      if (id && !ownsCosmetic(p, kind, id)) fail("You don't own this");
      if (id) p.cosmetics.equipped[kind] = id; else delete p.cosmetics.equipped[kind];
      this.cosmeticChanged(p);
    },
    // ---- town
    town_upgrade(s, d) { const r = TL.upgradeBuilding(s.player, { buildingId: String(d.buildingId) }); return r; },
    town_assign(s, d) { this.ensureNotInCoop(s.player.id); TL.assignWorker(s.player, { buildingId: String(d.buildingId), charId: d.charId ? String(d.charId) : null }); this.abortSoloIfUsing(s, d.charId); },
    expedition_start(s, d) {
      this.ensureNotInCoop(s.player.id);
      const ex = XL.startExpedition(s.player, { destId: String(d.destId), charIds: d.charIds, hours: Number(d.hours) });
      s.player.stats.expeditionsSent = (s.player.stats.expeditionsSent || 0) + 1;
      for (const id of ex.charIds) this.abortSoloIfUsing(s, id);
      return ex;
    },
    town_speedup(s, d) {
      const p = s.player;
      const b = p.town.buildings[String(d.buildingId)] || fail('Unknown building');
      if (!b.upgrade) fail('Nothing is being built there');
      const cost = speedUpCost(b.upgrade.endsAt - Date.now(), this.settings.get('premiumMinutesPerCrystal'));
      if (cost > 0) L.spendPremium(p, cost, d.maxCost);
      b.upgrade.endsAt = Date.now();
      const done = TL.finishConstructions(p);
      for (const x of done) this.toast(p.id, `🏗 ${x.name} upgraded to level ${x.level}!`, 'success');
      return { cost };
    },
    expedition_speedup(s, d) {
      const p = s.player;
      const ex = (p.expeditions || []).find(e => e.id === String(d.id)) || fail('Expedition not found');
      const cost = speedUpCost(ex.endsAt - Date.now(), this.settings.get('premiumMinutesPerCrystal'));
      if (cost > 0) L.spendPremium(p, cost, d.maxCost);
      ex.endsAt = Date.now();
      ex.announced = true;
      p.stats.expeditionSpeedups = (p.stats.expeditionSpeedups || 0) + 1;
      return { cost };
    },
    // ---- ascension (subclasses)
    ascend(s, d) {
      const r = L.ascendHero(s.player, { subclassId: String(d.subclassId || '') });
      const h = L.hero(s.player);
      this.toast(s.player.id, `🌟 ${h.name} ascended as ${r.name}! Back to level 1 — with new skill-tree branches and ${CONFIG.ascension.bonusSkillPoints} bonus skill points.${r.rescaled ? ` ${h.name} keeps all ${r.rescaled} equipped items, now at item level 1 — reforge them back up in town as you level.` : ''}`, 'success');
      for (const id of this.sessions.keys()) if (id !== s.player.id) this.toast(id, `🌟 ${s.player.name}'s ${h.name} ${r.switched ? 'became' : 'ascended as'} a ${r.name}!`, 'info');
      this.store.savePlayerSoon(s.player);
      return r;
    },
    // ---- tutorial
    tutorial_ack(s, d) { this.tutorialToasts(s, TU.ackTutorial(s.player, { stepId: d.stepId ? String(d.stepId) : null })); },
    tutorial_skip(s) { TU.skipTutorial(s.player); },
    expedition_cancel(s, d) { XL.cancelExpedition(s.player, { id: String(d.id) }); },
    expedition_claim(s, d) {
      const r = d.id ? XL.claimExpedition(s.player, { id: String(d.id) }) : XL.claimAll(s.player);
      s.player.stats.expeditionsClaimed = (s.player.stats.expeditionsClaimed || 0) + (r.count || 1);
      this.profToast(s, r.messages);
      this.questDone(s.player, Q.track(s.player, 'expedition', r.count || 1));
      L.checkAchievements(s.player);
      return r;
    },
    salvage_items(s, d) { const r = TL.salvageItems(s.player, d); this.questDone(s.player, Q.track(s.player, 'salvage', r.count)); return r; },
    salvage_by_rarity(s, d) { const r = TL.salvageByRarity(s.player, d); this.questDone(s.player, Q.track(s.player, 'salvage', r.count)); return r; },
    craft_item(s, d) { const r = TL.craft(s.player, d, L.hero(s.player).level); this.profToast(s, r.msg); this.questDone(s.player, Q.track(s.player, 'craft', 1)); return r; },
    reforge_item(s, d) { const r = TL.reforge(s.player, d, L.hero(s.player).level); this.profToast(s, r.msg); this.questDone(s.player, Q.track(s.player, 'craft', 1)); return r; },
    enchant_item(s, d) { const r = TL.enchant(s.player, d); this.profToast(s, r.msg); this.questDone(s.player, Q.track(s.player, 'craft', 1)); return r; },
    brew_elixir(s, d) { const r = TL.brew(s.player, d, L.hero(s.player).level); this.profToast(s, r.msg); this.questDone(s.player, Q.track(s.player, 'craft', 1)); return r; },

    // ---- gems & sockets
    gem_cut(s, d) { const r = TL.cutGem(s.player, { kind: String(d.kind || d.stat), count: d.count }); this.profToast(s, r.msg); this.questDone(s.player, Q.track(s.player, 'craft', 1)); return r; },
    gem_fuse(s, d) { const r = TL.fuseGems(s.player, { kind: String(d.kind || d.stat), tier: d.tier, count: d.count }); this.profToast(s, r.msg); this.questDone(s.player, Q.track(s.player, 'craft', 1)); return r; },
    gem_socket(s, d) { return TL.socketGem(s.player, { itemUid: String(d.itemUid), charId: d.charId, index: d.index, gem: String(d.gem) }); },
    gem_unsocket(s, d) { return TL.unsocketGem(s.player, { itemUid: String(d.itemUid), charId: d.charId, index: d.index }); },
    gem_drill(s, d) { const r = TL.drillSocket(s.player, { itemUid: String(d.itemUid), charId: d.charId }); this.profToast(s, r.msg); this.questDone(s.player, Q.track(s.player, 'craft', 1)); return r; },

    // ---- quests
    quest_claim(s, d) { return d.id === 'all' ? Q.claimAll(s.player) : Q.claim(s.player, { id: String(d.id) }); },
    quest_reroll(s, d) { return Q.reroll(s.player, { id: String(d.id), maxCost: d.maxCost }); },

    // ---- rifts
    rift_start(s, d) {
      const p = s.player;
      const h = L.hero(p);
      if (unlockHeroLevel(p) < RIFT.minLevel) fail(`Rifts open at hero level ${RIFT.minLevel}`);
      const tier = Math.floor(Number(d.tier));
      if (!(tier >= 1 && tier <= maxStartTier(p))) fail(`You can start tiers 1–${maxStartTier(p)} (time a tier to unlock the next)`);
      const theme = riftTheme(tier); // every tier has a fixed theme
      const g = this.leaderGroup(p);
      if (g) {
        for (const m of this.groupPlayers(g)) if (unlockHeroLevel(m) < RIFT.minLevel) fail(`${m.name}'s hero must be level ${RIFT.minLevel} for rifts`);
        this.setGroupNext(g, { kind: 'rift', tier, theme });
        this.groupMessage(g, `${p.name} opens Rift Tier ${tier}.`);
        return { tier, theme, group: true };
      }
      if (!L.activePartyChars(p).length) fail('Your active party is empty');
      this.abortSolo(s);
      s.solo = { next: { kind: 'rift', tier, theme }, restUntil: 0 };
      return { tier, theme };
    },
    rift_stop(s) {
      const g = this.leaderGroup(s.player);
      if (g) {
        if (g.fight?.kind !== 'rift' && g.next?.kind !== 'rift') fail('No rift running');
        this.setGroupNext(g, null);
        return;
      }
      if (s.solo?.kind !== 'rift' && s.solo?.next?.kind !== 'rift') fail('No rift running');
      this.abortSolo(s);
    },
    // ---- pinnacle bosses
    pinnacle_view(s) { return this.pinnacle.view(s.player); },
    pinnacle_start(s, d) {
      const p = s.player;
      const bossId = String(d.bossId || '');
      const g = this.leaderGroup(p);
      if (g) {
        this.pinnacle.check(p, this.groupPlayers(g), bossId); // the sigil is used when the fight starts
        this.setGroupNext(g, { kind: 'pinnacle', bossId });
        this.groupMessage(g, `${p.name} uses a Pinnacle Sigil: ${PINNACLE_BOSSES[bossId].name}!`);
        return { group: true };
      }
      this.pinnacle.check(p, [p], bossId);
      if (!L.activePartyChars(p).length) fail('Your active party is empty');
      this.abortSolo(s);
      s.solo = { next: { kind: 'pinnacle', bossId }, restUntil: 0 };
      return {};
    },
    rift_settings(s, d) {
      if (['off', 'repeat', 'push'].includes(d.auto)) s.player.rift.auto = d.auto;
    },

    // 💡 player suggestions (read in the admin panel); online admins get a toast
    suggest(s, d) {
      let sg;
      try { sg = this.suggestions.add(s.player, d || {}); } catch (e) { fail(e.message); }
      for (const o of this.sessions.values()) if (o.player.id !== s.player.id && this.admins?.has(o.player.name)) this.toast(o.player.id, `💡 New suggestion from ${s.player.name}`);
      return { id: sg.id };
    },
    my_suggestions(s) { return { list: this.suggestions.mine(s.player.id), categories: SUGGESTION_CATEGORIES }; },
    ack_announcements(s, d) {
      const upTo = Math.min(Date.now(), Number(d.upTo) || Date.now());
      s.player.announcementsSeenAt = Math.max(s.player.announcementsSeenAt || 0, upTo);
    },
    collect_mail(s, d) { return L.collectMail(s.player, { id: d.id }); },
    ah_search(s, d) { return this.auction.search(s.player, d); },
    ah_mine(s) { return this.auction.mine(s.player); },
    ah_list(s, d) {
      const r = this.auction.list(s.player, { itemUid: d.itemUid ? String(d.itemUid) : null, material: d.material ? String(d.material) : null, qty: d.qty, price: d.price, hours: d.hours });
      this.questDone(s.player, Q.track(s.player, 'auction', 1));
      return r;
    },
    ah_cancel(s, d) { this.auction.cancel(s.player, { id: String(d.id) }); },
    ah_buy(s, d) { return this.auction.buy(s.player, { id: String(d.id) }); },

    get_rankings(s, d) {
      const b = this.rankings.board({ category: String(d.category || 'level'), classId: d.classId ? String(d.classId) : null, search: d.search, limit: Number(d.limit) || 100 }, s.player.id);
      for (const r of b.rows) r.bot = this.showBot(r.id);
      return b;
    },
    inspect_player(s, d) {
      const prof = this.rankings.inspect(String(d.name || ''));
      if (!prof) fail('Player not found');
      prof.bot = this.showBot(prof.id || this.store.getAccount(String(d.name || ''))?.id);
      return prof;
    },
    refresh_recruits(s) { L.refreshRecruits(s.player, false, this.assets.get()); },
    recruit(s, d) { const ch = L.recruit(s.player, d); this.toast(s.player.id, `${ch.name} joined your roster!`, 'success'); },
    dismiss(s, d) { this.ensureNotInCoop(s.player.id); L.dismiss(s.player, d); this.abortSolo(s); },
    set_party(s, d) { L.setParty(s.player, d); },
    rename_party(s, d) { L.renameParty(s.player, d); },
    activate_party(s, d) { L.activateParty(s.player, d); this.abortSolo(s); },
    set_zone(s, d) {
      L.setZone(s.player, d);
      // the group leader takes the group along; members only change where they fight alone
      const g = this.groupOf(s.player.id);
      if (g && this.groupActive(g) && g.leaderId === s.player.id) { if (!g.fight || g.fight.kind === 'idle' || g.fight.kind === 'boss') this.setGroupNext(g, null); this.groupMessage(g, `${s.player.name} leads the group to ${ZONES[s.player.zone]?.name}.`); this.broadcastGroup(g); return; }
      if (!this.inGroupFight(s.player.id)) this.abortSolo(s);
    },
    challenge_boss(s, d) {
      const zoneId = d.zoneId;
      if (!ZONES[zoneId] || !s.player.unlockedZones.includes(zoneId)) fail('Zone locked');
      const g = this.leaderGroup(s.player);
      if (g) { this.setGroupNext(g, { kind: 'boss', zoneId }); return; }
      this.abortSolo(s);
      s.solo = { next: { kind: 'boss', zoneId }, restUntil: 0 };
    },
    // ---- arena
    arena_set_party(s, d) { this.arena.setParty(s.player, d); },
    arena_view(s) { return this.arena.view(s.player); },
    arena_refresh(s) { this.arena.refresh(s.player); return this.arena.view(s.player); },
    arena_attack(s, d) { this.arena.attack(s, { opponentId: String(d.opponentId || '') }); },
    set_coop_chars(s, d) { L.setCoopChars(s.player, d); const g = this.groupOf(s.player.id); if (g) this.broadcastGroup(g); },

    // ---- groups
    group_create(s) {
      if (this.groupOf(s.player.id)) fail('Already in a group');
      const g = { id: crypto.randomBytes(5).toString('hex'), leaderId: s.player.id, members: [s.player.id], invites: new Map(), battle: null, chat: [] };
      this.groups.set(g.id, g);
      this.playerGroup.set(s.player.id, g.id);
      this.broadcastGroup(g);
    },
    group_invite(s, d) {
      const g = this.groupOf(s.player.id) || fail('Create a group first');
      if (g.leaderId !== s.player.id) fail('Only the leader can invite');
      if (g.members.length + g.invites.size >= CONFIG.coop.maxPlayers) fail('Group is full');
      const acc = typeof d.name === 'string' ? this.store.getAccount(d.name) : null;
      if (!acc) fail('Player not found');
      if (!this.sessions.has(acc.id)) fail('Player is not online');
      if (this.groupOf(acc.id)) fail('Player is already in a group');
      if (acc.id === s.player.id) fail('You cannot invite yourself');
      g.invites.set(acc.id, Date.now() + CONFIG.coop.inviteTimeoutSeconds * 1000);
      this.sendInvites(acc.id);
      this.toast(acc.id, `${s.player.name} invited you to a group!`, 'info');
      this.broadcastGroup(g);
    },
    group_accept(s, d) {
      if (this.groupOf(s.player.id)) fail('Leave your current group first');
      const g = this.groups.get(d.groupId) || fail('Group no longer exists');
      const exp = g.invites.get(s.player.id);
      if (!exp || exp < Date.now()) fail('Invitation expired');
      if (g.members.length >= CONFIG.coop.maxPlayers) fail('Group is full');
      g.invites.delete(s.player.id);
      g.members.push(s.player.id);
      g.leaderRecruits = null; // the group changed: back to automatic
      this.playerGroup.set(s.player.id, g.id);
      this.sendInvites(s.player.id);
      this.groupMessage(g, `${s.player.name} joined the group.`);
      this.broadcastGroup(g);
      if (g.battle) this.send([...s.sockets][0], { t: 'battle_start', k: 'coop', battle: battleSnapshot(g.battle) });
    },
    group_decline(s, d) {
      const g = this.groups.get(d.groupId);
      if (g) { g.invites.delete(s.player.id); this.broadcastGroup(g); }
      this.sendInvites(s.player.id);
    },
    group_leave(s) { this.leaveGroup(s.player.id); },
    group_kick(s, d) {
      const g = this.groupOf(s.player.id) || fail('Not in a group');
      if (g.leaderId !== s.player.id) fail('Only the leader can remove members');
      if (!g.members.includes(d.playerId) || d.playerId === s.player.id) fail('Invalid member');
      this.leaveGroup(d.playerId, 'was removed from the group');
    },
    group_promote(s, d) {
      const g = this.groupOf(s.player.id) || fail('Not in a group');
      if (g.leaderId !== s.player.id) fail('Only the leader can promote');
      if (!g.members.includes(d.playerId)) fail('Invalid member');
      g.leaderId = d.playerId;
      g.leaderRecruits = null; // the new leader decides afresh
      this.groupMessage(g, `${this.nameOf(d.playerId)} is now the group leader.`);
      this.broadcastGroup(g);
    },
    // the leader decides which members' offered recruits fight (null = automatic: missing roles first, then in turn)
    group_set_recruits(s, d) {
      const g = this.groupOf(s.player.id) || fail('Not in a group');
      if (g.leaderId !== s.player.id) fail('Only the leader can choose the recruits');
      if (d.playerIds == null) g.leaderRecruits = null;
      else {
        if (!Array.isArray(d.playerIds)) fail('Invalid selection');
        const ids = [...new Set(d.playerIds.map(String))].filter(id => g.members.includes(id));
        const players = g.members.map(id => this.sessions.get(id)?.player || this.store.loadPlayer(id)).filter(Boolean);
        const free = Math.max(0, (CONFIG.coop.partySize || 4) - players.filter(p => L.hero(p)).length);
        if (ids.length > free) fail(`Only ${free} recruit place${free === 1 ? '' : 's'} left`);
        g.leaderRecruits = ids;
      }
      this.broadcastGroup(g);
    },
    group_chat(s, d) {
      const g = this.groupOf(s.player.id) || fail('Not in a group');
      const text = String(d.text || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 200);
      if (!text) return;
      g.chat.push({ from: s.player.name, text, at: Date.now() });
      if (g.chat.length > 50) g.chat.shift();
      this.broadcastGroup(g);
    },
    group_start(s, d) {
      const g = this.groupOf(s.player.id) || fail('Create a group first (you can also go alone)');
      if (g.leaderId !== s.player.id) fail('Only the group leader can start encounters');
      const enc = COOP_ENCOUNTERS[d.encounterId] || fail('Unknown encounter');
      for (const p of this.groupPlayers(g)) if (L.hero(p).level < enc.minLevel) fail(`${p.name}'s hero must be level ${enc.minLevel}+`);
      if (g.fight && g.fight.kind !== 'idle') fail('The group is in the middle of something — stop it first');
      this.setGroupNext(g, { kind: 'coop', encounterId: enc.id });
    },
    // the client lost track of its fight (e.g. a race between two co-op fights): send the current snapshot again
    battle_resync(s) {
      const g = this.groupOf(s.player.id);
      if (g?.battle) this.sendTo(s.player.id, { t: 'battle_start', k: 'coop', battle: battleSnapshot(g.battle) });
      else if (s.solo?.battle) this.sendTo(s.player.id, { t: 'battle_start', k: 'solo', battle: battleSnapshot(s.solo.battle) });
    },
  };

  // A companion who just left for work/expedition must not keep fighting in the running battle
  abortSoloIfUsing(s, charId) {
    if (charId && s.solo?.battle && s.solo.chars?.includes(String(charId))) this.abortSolo(s);
  }

  profToast(s, msg) {
    for (const m of [].concat(msg || [])) if (m) this.toast(s.player.id, m, 'success');
  }

  // during a group encounter, rift or pinnacle fight the line-up can't change (zone fights don't mind)
  ensureNotInCoop(playerId) {
    const g = this.groupOf(playerId);
    if (g?.battle && g.fight?.kind !== 'idle' && g.fight?.participants.some(x => x.id === playerId)) fail('Not possible during a group encounter');
  }
  // the group this player leads, if it fights together — leader actions then steer the group
  leaderGroup(p) {
    const g = this.groupOf(p.id);
    if (!g || !this.groupActive(g)) return null;
    if (g.leaderId !== p.id) fail('In a group, the leader decides what the group fights');
    return g;
  }

  nameOf(playerId) { return this.store.findAccountById(playerId)?.username || '???'; }

  // Rule / loadout changes take effect immediately in the running battle
  liveUpdateChar(p, charId) {
    const ch = p.characters[charId];
    if (!ch) return;
    const battles = [this.sessions.get(p.id)?.solo?.battle, this.groupOf(p.id)?.battle].filter(Boolean);
    for (const b of battles) {
      for (const u of b.units) {
        if (u.charId === charId && u.ownerId === p.id) {
          u.rules = JSON.parse(JSON.stringify(ch.rules));
          u.loadout = [...ch.loadout];
          u.ranks = { ...ch.abilities };
        }
      }
    }
  }

  // ------------------------------------------------------------------ solo idle loop
  abortSolo(s) {
    if (s.solo?.battle) this.sendTo(s.player.id, { t: 'battle_abort', k: 'solo' });
    s.solo = { restUntil: Date.now() + 500 };
  }

  // ------------------------------------------------------------------ fights
  // Every fight except the Arena is built here: alone (session.solo, the player's active party) or as a group
  // (group.battle: every online member's line-up together — zones, zone bosses, rifts, co-op encounters and
  // pinnacle bosses alike). players[0] decides (the leader). lineup: { playerId: [characters] }.
  buildFight(next, players, lineup, { group = false } = {}) {
    players = players.filter(p => lineup[p.id]?.length);
    const allChars = players.flatMap(p => lineup[p.id]);
    if (!allChars.length) return null;
    const leader = players[0];
    const bonuses = group ? partyBonuses(allChars) : null;
    const allies = [];
    let offset = 0;
    for (const p of players) {
      allies.push(...buildPartyUnits(lineup[p.id], { ownerId: p.id, ownerName: p.name, positionOffset: offset, extraBonuses: bonuses, buffs: elixirBonuses(p), vsEnemy: masteryMap(p) }));
      offset += lineup[p.id].length;
    }
    const heroLevel = Math.round(players.reduce((n, p) => n + (L.hero(p)?.level || 1), 0) / players.length);
    const rng = createRng(randomSeed());
    const fight = { kind: next.kind, group, participants: players.map(p => ({ id: p.id, name: p.name, chars: lineup[p.id].map(c => c.id) })) };
    if (next.kind === 'rift') {
      const zone = ZONES[next.theme] || ZONES[leader.zone];
      const affixes = affixesFor(next.tier);
      fight.zoneId = zone.id; fight.rift = next;
      fight.battle = createBattle({
        seed: randomSeed(), allies, waves: riftWaves(zone.id, next.tier, rng, allChars.length), scale: riftScale(next.tier), hooks: riftHooks(affixes),
        meta: { kind: 'rift', zoneId: zone.id, tier: next.tier, affixes, timeLimit: RIFT.timeLimit, title: `Rift Tier ${next.tier} · ${zone.name}`, level: riftLevel(next.tier), group },
      });
    } else if (next.kind === 'pinnacle') {
      const def = PINNACLE_BOSSES[next.bossId];
      fight.bossId = def.id;
      fight.battle = createBattle({
        seed: randomSeed(), allies, waves: pinnacleWaves(def.id), scale: pinnacleScale(def.id),
        meta: { kind: 'pinnacle', bossId: def.id, title: `Pinnacle: ${def.name}`, level: PINNACLE.level, group },
      });
    } else if (next.kind === 'coop') {
      const enc = COOP_ENCOUNTERS[next.encounterId];
      fight.encounterId = enc.id;
      fight.battle = createBattle({
        seed: randomSeed(), allies, waves: coopWaves(enc.id, heroLevel), scale: coopScale(allChars.length),
        meta: { kind: 'coop', encounterId: enc.id, title: enc.name, level: Math.max(enc.minLevel, heroLevel), players: players.length, group },
      });
    } else {
      const zone = ZONES[next.zoneId] || ZONES[leader.zone] || ZONES.whispering_woods;
      const boss = next.kind === 'boss';
      fight.kind = boss ? 'boss' : 'idle';
      fight.zoneId = zone.id;
      fight.battle = createBattle({
        seed: randomSeed(), allies, waves: boss ? bossWaves(zone.id, heroLevel) : idleWaves(zone.id, heroLevel, rng, allChars.length),
        scale: (boss ? zone.bossScale : zone.scale) || { hp: 1, damage: 1 },
        meta: { kind: fight.kind, zoneId: zone.id, title: boss ? `Boss: ${zone.name}` : zone.name, level: zoneLevel(zone, heroLevel), group, players: players.length },
      });
    }
    for (const p of players) L.recordBestiary(p, { seen: fight.battle.waves.flat().map(w => w.enemyId).filter(Boolean) });
    drainEvents(fight.battle);
    return fight;
  }

  // Hands out every participant's rewards and tells them how it went. Returns { playerId: summary }.
  settleFight(fight) {
    const b = fight.battle;
    const won = b.state === 'victory';
    const out = {};
    const k = fight.group ? 'coop' : 'solo';
    const players = fight.participants.map(part => ({ part, ss: this.sessions.get(part.id) })).map(x => ({ ...x, p: x.ss?.player || this.store.loadPlayer(x.part.id) })).filter(x => x.p);
    // pinnacle: one leaderboard entry for the whole party
    let rank = false;
    if (fight.kind === 'pinnacle' && won) rank = this.pinnacle.record(fight.bossId, b, players.map(x => ({ id: x.p.id, name: x.p.name })));
    for (const { part, ss, p } of players) {
      const chars = part.chars.map(id => p.characters[id]).filter(Boolean);
      const summary = { result: b.state, kind: fight.kind, zoneId: fight.zoneId || null, group: fight.group };
      if (fight.kind !== 'coop') p.stats.fights++;
      if (fight.kind === 'rift') this.riftRewards(p, chars, fight, summary);
      else if (won) {
        let rewards;
        const lootMult = this.settings.get('lootRate');
        if (fight.kind === 'pinnacle') {
          const r = this.pinnacle.reward(p, b, fight.bossId, lootMult);
          rewards = r.rewards;
          Object.assign(summary, r.out, rank ? { rank } : {});
          const def = PINNACLE_BOSSES[fight.bossId];
          if (r.out.firstKill) this.toast(p.id, `🏔 First victory over ${def.name}! You earned a new title and portrait frame (Wardrobe).`, 'achievement');
          if (r.out.weekly) this.toast(p.id, `🏔 Weekly bonus for ${def.name}: ${r.out.crystals ? `+${r.out.crystals} 💠 and ` : ''}an extra pinnacle unique.`, 'achievement');
          for (const u of r.out.uniques) this.toast(p.id, `✦ ${u} — a pinnacle unique!`, 'achievement');
          if (rank) this.toast(p.id, `🏆 Your group is #${rank} on the ${def.name} leaderboard (${r.out.time} s)!`, 'achievement');
          p.stats.bossKills += b.kills.filter(x => x.boss).length;
        } else if (fight.kind === 'coop') {
          const enc = COOP_ENCOUNTERS[fight.encounterId];
          rewards = computeRewards(b.kills, createRng(randomSeed()), { rewardMult: enc.rewardMult, lootBoost: 0.5, lootMult });
          summary.encounterId = enc.id;
          p.stats.coopWins++;
          p.stats.bossKills += b.kills.filter(x => x.boss).length;
          this.questDone(p, Q.track(p, 'coop', 1));
        } else {
          rewards = computeRewards(b.kills, createRng(randomSeed()), { lootMult, zoneId: fight.zoneId });
          if (fight.kind === 'boss') {
            p.stats.bossKills++;
            const unlocked = L.onBossDefeated(p, fight.zoneId);
            for (const z of unlocked) this.toast(p.id, `New zone unlocked: ${z.name}!`, 'success');
            summary.unlocked = unlocked.map(z => z.id);
          }
        }
        rewards = this.applyElixirRewards(p, rewards);
        rewards.kills = b.kills.length;
        const res = L.applyRewards(p, chars, rewards);
        Object.assign(summary, this.rewardSummary(rewards, res));
        for (const lu of res.levelUps) this.toast(p.id, `${lu.name} reached level ${lu.level}!`, 'success');
        if (rewards.sigils) this.toast(p.id, `✨ A Pinnacle Sigil dropped! (${pinnacleState(p).sigils} owned) — challenge a pinnacle boss on the Pinnacle page.`, 'achievement');
      }
      this.afterBattle(p, b, summary.gold || 0, summary.xp || 0);
      for (const a of L.checkAchievements(p)) this.toast(p.id, `Achievement unlocked: ${a.name} (+${a.reward.gold} gold)`, 'achievement');
      this.sendTo(p.id, { t: 'battle_end', k, summary });
      L.maybeAutoRefreshRecruits(p, this.assets.get());
      if (ss) this.markDirty(ss); else this.store.savePlayerSoon(p);
      out[p.id] = summary;
    }
    return out;
  }

  // rift rewards of one participant (won or lost: the history always counts)
  riftRewards(p, chars, fight, summary) {
    const b = fight.battle;
    const tier = fight.rift.tier;
    const won = b.state === 'victory';
    const timed = won && b.time <= RIFT.timeLimit;
    Object.assign(summary, { tier, time: Math.round(b.time), timeLimit: RIFT.timeLimit, timed });
    const r = p.rift;
    r.runs = (r.runs || 0) + 1;
    if (won) {
      const rng = createRng(randomSeed());
      // XP & gold: in full (as if timed) on the first clear of a tier, then only repeatXpGold of it; loot always
      const firstClear = !riftCleared(p, tier);
      // enemies above the level cap still drop items (and give XP) of the level cap
      const rewardKills = b.kills.map(k => (k.level > CONFIG.levelCap ? { ...k, level: CONFIG.levelCap } : k));
      const rewards = this.applyElixirRewards(p, computeRewards(rewardKills, rng, { ...riftRewardOptions(tier, timed), lootMult: this.settings.get('lootRate'), zoneId: fight.zoneId, noSigils: true }));
      if (firstClear) {
        if (!timed && RIFT.untimedRewardMult > 0) { rewards.xp = Math.round(rewards.xp / RIFT.untimedRewardMult); rewards.gold = Math.round(rewards.gold / RIFT.untimedRewardMult); }
        r.cleared = [...(r.cleared || []), tier].sort((a, c) => a - c);
        summary.firstClear = true;
      } else {
        const m = repeatXpGold();
        rewards.xp = Math.round(rewards.xp * m);
        rewards.gold = Math.round(rewards.gold * m);
        summary.repeat = true;
      }
      rewards.kills = b.kills.length;
      const h = L.hero(p);
      if (timed) {
        const chest = riftChest(tier);
        for (let i = 0; i < chest.count; i++) rewards.items.push(generateItem(rng, Math.min(CONFIG.levelCap, h.level + chest.itemLevelBonus), { minRarity: chest.minRarity, boost: chest.boost }));
        r.timed = (r.timed || 0) + 1;
        if (!r.bestTimes[tier] || b.time < r.bestTimes[tier]) r.bestTimes[tier] = Math.round(b.time * 10) / 10;
        if (tier > (r.best || 0)) {
          const crystals = firstClearCrystals(tier);
          r.best = tier;
          p.premium = (p.premium || 0) + crystals;
          summary.crystals = crystals;
          summary.newBest = true;
          this.toast(p.id, `🌀 Rift tier ${tier} timed for the first time! +${crystals} 💠 — tier ${Math.min(RIFT.maxTier, tier + 1)} unlocked.`, 'achievement');
        }
      }
      p.stats.bossKills += b.kills.filter(k => k.boss && !k.summoned).length;
      const res = L.applyRewards(p, chars, rewards);
      Object.assign(summary, this.rewardSummary(rewards, res));
      for (const lu of res.levelUps) this.toast(p.id, `${lu.name} reached level ${lu.level}!`, 'success');
      this.questDone(p, Q.track(p, 'rift', 1));
      if (timed) this.questDone(p, Q.track(p, 'rift_timed', 1));
    }
    p.stats.riftBest = r.best || 0;
    r.history = [{ tier, theme: fight.zoneId, time: Math.round(b.time), timed, result: b.state, affixes: b.meta.affixes, at: Date.now(), ...(fight.group ? { group: true } : {}) }, ...(r.history || [])].slice(0, 12);
  }

  // what comes after a finished fight: rifts continue as the leader set it (repeat / push), everything else goes
  // back to the zone
  nextAfter(fight, leader) {
    if (fight.kind !== 'rift' || fight.battle.state !== 'victory') return null;
    const tier = fight.rift.tier, timed = fight.battle.time <= RIFT.timeLimit, auto = leader.rift?.auto;
    let next = null;
    if (auto === 'repeat') next = { kind: 'rift', tier };
    if (auto === 'push') next = { kind: 'rift', tier: timed ? Math.min(maxStartTier(leader), tier + 1) : tier };
    if (next) next.theme = riftTheme(next.tier);
    return next;
  }

  // ------------------------------------------------------------------ solo
  startSoloBattle(s) {
    const p = s.player;
    const chars = L.activePartyChars(p);
    if (!chars.length) return;
    const next = s.solo?.next || { kind: 'idle', zoneId: p.zone };
    let fight;
    try {
      if (next.kind === 'pinnacle') { this.pinnacle.check(p, [p], next.bossId); this.pinnacle.pay(p); }
      fight = this.buildFight(next, [p], { [p.id]: chars });
    } catch (e) { this.toast(p.id, e.message, 'error'); fight = null; }
    if (!fight) { s.solo = { restUntil: Date.now() + 2000 }; return; }
    const battle = fight.battle;
    // the first tutorial fights can't be lost: the party never drops below 1 health (tutorial.json "protectedSteps")
    const step = currentStep(p);
    if (step && (TUTORIAL.protectedSteps || []).includes(step.id) && fight.kind === 'idle') { battle.protected = true; for (const u of battle.units) if (u.side === 'A') u.undying = true; }
    s.solo = { battle, fight, kind: fight.kind, zoneId: fight.zoneId, chars: chars.map(c => c.id), rift: fight.rift || null };
    this.sendTo(p.id, { t: 'battle_start', k: 'solo', battle: battleSnapshot(battle) });
  }

  finishSoloBattle(s) {
    if (s.solo.kind === 'arena') return this.arena.finish(s);
    const p = s.player;
    const fight = s.solo.fight;
    const won = fight.battle.state === 'victory';
    this.settleFight(fight);
    const next = this.nextAfter(fight, p);
    const rest = fight.kind === 'rift' ? (won ? 3 : CONFIG.combat.reviveDelay) : won ? CONFIG.combat.restBetweenFights : CONFIG.combat.reviveDelay;
    s.solo = { restUntil: Date.now() + rest * 1000, ...(next ? { next } : {}) };
    this.markDirty(s);
  }

  // bestiary kills + quest progress after any finished battle
  afterBattle(p, b, gold = 0, xp = 0) {
    try { this.balance.recordBattle(p, b, { gold, xp }); } catch (e) { this.log(`balance stats: ${e.message}`); }
    for (const m of L.recordBestiary(p, { kills: b.kills })) this.toast(p.id, `📖 Bestiary mastery ${'★'.repeat(m.level)} — ${m.name}: you now deal more damage to it.`, 'achievement');
    this.questDone(p, Q.onBattle(p, { won: b.state === 'victory', kills: b.kills, gold }));
  }

  questDone(p, titles) {
    for (const t of titles || []) this.toast(p.id, `📜 Quest complete: ${t} — claim your reward on the Quests page.`, 'achievement');
  }

  applyElixirRewards(p, rewards, at = Date.now()) {
    const eb = elixirBonuses(p, at);
    rewards.xp = Math.round(rewards.xp * (1 + eb.xpPct) * this.settings.get('xpRate') * L.xpBoostMult(p, at)); // admin XP boost
    rewards.gold = Math.round(rewards.gold * (1 + eb.goldPct) * this.settings.get('goldRate'));
    return rewards;
  }

  rewardSummary(rewards, res) {
    return {
      xp: rewards.xp, gold: rewards.gold,
      items: rewards.items.map(i => ({ name: i.name, rarity: i.rarity, baseId: i.baseId })),
      sold: res.sold, levelUps: res.levelUps, materials: rewards.materials || {}, gems: rewards.gems || {},
    };
  }

  tick() {
    const now = Date.now();
    if (!this.lastAuctionSweep || now - this.lastAuctionSweep > 30000) { this.lastAuctionSweep = now; this.auction.sweepExpired(); }
    if (!this.lastTownCheck || now - this.lastTownCheck > 1000) {
      this.lastTownCheck = now;
      for (const s of this.sessions.values()) {
        const fresh = Q.ensureQuests(s.player, now);
        if (fresh.daily || fresh.weekly) { this.toast(s.player.id, `📜 New ${fresh.daily ? 'daily' : 'weekly'} quests are available!`, 'info'); this.markDirty(s); }
        if (!s.player.town) continue;
        for (const d of TL.finishConstructions(s.player, now)) { this.toast(s.player.id, `🏗 ${d.name} upgraded to level ${d.level}!`, 'success'); this.markDirty(s); }
        for (const ex of XL.newlyReturned(s.player, now)) { this.toast(s.player.id, `🧭 Your expedition to ${EXPEDITIONS[ex.destId]?.name} has returned — claim the rewards!`, 'success'); this.markDirty(s); }
      }
    }
    for (const s of this.sessions.values()) {
      const p = s.player;
      // in a group every fight is fought together (tickGroups) — only an Arena fight runs on its own
      if (!p.heroId || (this.inGroupFight(p.id) && !(s.solo?.kind === 'arena' && s.solo.battle))) { this.flushState(s); continue; }
      if (!s.solo) s.solo = { restUntil: 0 };
      if (!s.solo.battle) {
        if (now >= (s.solo.restUntil || 0)) this.startSoloBattle(s);
      } else {
        const b = s.solo.battle;
        stepBattle(b);
        const events = drainEvents(b);
        if (!this.headless) this.sendTo(p.id, { t: 'bt', k: 'solo', time: Math.round(b.time * 10) / 10, wave: b.waveIndex + 1, u: b.units.map(u => dynamicUnit(u, b)), e: events });
        if (b.state !== 'running') this.finishSoloBattle(s);
      }
      this.flushState(s);
    }
    this.tickGroups(now);
    if (this.onlineDirty && (!this.lastOnlineSent || now - this.lastOnlineSent > 2000)) this.broadcastOnline();
  }

  // ------------------------------------------------------------------ offline progression
  handleOffline(s) {
    const p = s.player;
    if (!p.heroId) return;
    const elapsedMs = Math.min(Date.now() - (p.lastActive || Date.now()), this.settings.get('offlineMaxHours') * 3600 * 1000);
    if (elapsedMs < CONFIG.offline.minSeconds * 1000) return;
    const summary = this.simulateOffline(p, elapsedMs / 1000);
    p.lastActive = Date.now();
    this.markDirty(s);
    if (summary) this.sendTo(p.id, { t: 'offline', summary });
  }

  // Same combat engine and reward rules as live play, fast-forwarded on the server clock.
  simulateOffline(p, seconds) {
    const chars = L.activePartyChars(p);
    if (!chars.length) return null;
    const zone = ZONES[p.zone];
    const rng = createRng(randomSeed());
    const startLevels = Object.fromEntries(chars.map(c => [c.id, c.level]));
    let simTime = 0, fights = 0, wins = 0, xp = 0, gold = 0, kills = 0, itemsKept = 0, itemsSold = 0;
    const found = [];
    const mats = {}; // zone materials found
    const gemsFound = {};
    let lastKills = null; // kills of the last simulated fight (for per-character XP adjustments)
    while (simTime < seconds && fights < CONFIG.offline.maxSimulatedFights) {
      const h = L.hero(p);
      const at = (p.lastActive || Date.now()) + simTime * 1000;
      const b = createBattle({ seed: rng.int(1, 2 ** 31), allies: buildPartyUnits(chars, { ownerId: p.id, ownerName: p.name, buffs: elixirBonuses(p, at), vsEnemy: masteryMap(p) }), waves: idleWaves(zone.id, h.level, rng, chars.length), scale: zone.scale || { hp: 1, damage: 1 } });
      runToEnd(b);
      if (b.kills.length) lastKills = b.kills;
      fights++;
      simTime += b.time + (b.state === 'victory' ? CONFIG.combat.restBetweenFights : CONFIG.combat.reviveDelay);
      L.recordBestiary(p, { kills: b.kills });
      if (b.state !== 'victory') { Q.onBattle(p, { won: false, kills: b.kills }); this.balance.recordBattle(p, b, { activity: 'offline', place: zone.id }); continue; }
      wins++;
      const r = this.applyElixirRewards(p, computeRewards(b.kills, rng, { rewardMult: CONFIG.offline.efficiency, lootMult: this.settings.get('lootRate'), zoneId: zone.id }), at);
      for (const [k, v] of Object.entries(r.materials || {})) mats[k] = (mats[k] || 0) + v;
      for (const [k, v] of Object.entries(r.gems || {})) gemsFound[k] = (gemsFound[k] || 0) + v;
      r.kills = b.kills.length;
      xp += r.xp; gold += r.gold; kills += r.kills;
      Q.onBattle(p, { won: true, kills: b.kills, gold: r.gold });
      this.balance.recordBattle(p, b, { activity: 'offline', place: zone.id, gold: r.gold, xp: r.xp });
      const res = L.applyRewards(p, chars, r);
      itemsKept += res.kept; itemsSold += res.sold;
      for (const it of r.items) if (['epic', 'legendary', 'mythic'].includes(it.rarity)) found.push({ name: it.name, rarity: it.rarity });
    }
    // Extrapolate the remaining time from the simulated average (only if the cap was hit)
    if (simTime < seconds && simTime > 0 && wins > 0) {
      const factor = (seconds - simTime) / simTime;
      const ex = { xp: Math.round(xp * factor), gold: Math.round(gold * factor), items: [], kills: Math.round(kills * factor), killList: lastKills,
        materials: Object.fromEntries(Object.entries(mats).map(([k, v]) => [k, Math.floor(v * factor)]).filter(([, v]) => v > 0)) };
      for (const [k, v] of Object.entries(ex.materials)) mats[k] += v;
      const extraItems = Math.min(20, Math.round((itemsKept + itemsSold) * factor));
      const h = L.hero(p);
      for (let i = 0; i < extraItems; i++) ex.items.push(generateItem(rng, zoneLevel(zone, h.level), {}));
      const res = L.applyRewards(p, chars, ex);
      xp += ex.xp; gold += ex.gold; kills += ex.kills; itemsKept += res.kept; itemsSold += res.sold;
    }
    p.stats.fights += fights;
    const achievements = L.checkAchievements(p).map(a => a.name);
    return {
      seconds: Math.round(seconds), zone: zone.name, fights, wins, kills, xp, gold, itemsKept, itemsSold, found: found.slice(0, 10), achievements, materials: mats, gems: gemsFound,
      levels: chars.filter(c => c.level > startLevels[c.id]).map(c => ({ name: c.name, from: startLevels[c.id], to: c.level })),
    };
  }

  // ------------------------------------------------------------------ groups & co-op
  groupOf(playerId) { const id = this.playerGroup.get(playerId); return id ? this.groups.get(id) : null; }

  // who fights in the group's next co-op fight (max CONFIG.coop.partySize characters)
  coopLineupOf(g, players) {
    return coopLineup(players.map(p => ({ id: p.id, hero: L.hero(p), picks: L.coopPicks(p) })), g.recruitTurn || 0, g.leaderRecruits || null);
  }

  publicGroup(g) {
    const now = Date.now();
    const players = g.members.map(id => this.sessions.get(id)?.player || this.store.loadPlayer(id)).filter(Boolean);
    const lineup = this.coopLineupOf(g, players);
    return {
      id: g.id, leaderId: g.leaderId, leaderRecruits: g.leaderRecruits || null,
      freeSlots: Math.max(0, (CONFIG.coop.partySize || 4) - players.filter(p => L.hero(p)).length),
      members: g.members.map(id => {
        const p = players.find(x => x.id === id);
        const chars = p ? lineup.byPlayer[id] || [] : [];
        const card = c => ({ id: c.id, name: c.name, classId: c.classId, level: c.level, isMain: c.isMain, portrait: c.portrait, role: c.role, reason: lineup.reasons[c.id] || null });
        return {
          id, name: this.nameOf(id), online: this.sessions.has(id), bot: this.showBot(id),
          characters: chars.map(card),
          bench: p ? L.coopPicks(p).filter(c => !chars.includes(c)).map(card) : [],
        };
      }),
      invites: [...g.invites.entries()].filter(([, exp]) => exp > now).map(([id]) => this.nameOf(id)),
      inBattle: !!g.battle, encounterId: g.encounterId || null, chat: g.chat.slice(-30),
      together: this.groupActive(g), fight: g.fight ? { kind: g.fight.kind, title: g.battle?.meta?.title || '' } : null, next: g.next || null,
    };
  }

  broadcastGroup(g) {
    this.onlineDirty = true;
    const pg = this.publicGroup(g);
    for (const id of g.members) this.sendTo(id, { t: 'group', group: pg });
  }

  groupMessage(g, text) {
    g.chat.push({ from: null, text, at: Date.now() });
    if (g.chat.length > 50) g.chat.shift();
  }

  sendInvites(playerId) {
    const now = Date.now();
    const invites = [];
    for (const g of this.groups.values()) {
      const exp = g.invites.get(playerId);
      if (exp && exp > now) invites.push({ groupId: g.id, leader: this.nameOf(g.leaderId), members: g.members.length });
    }
    this.sendTo(playerId, { t: 'invites', invites });
  }

  leaveGroup(playerId, verb = 'left the group') {
    const g = this.groupOf(playerId);
    if (!g) fail('Not in a group');
    g.members = g.members.filter(id => id !== playerId);
    this.playerGroup.delete(playerId);
    this.sendTo(playerId, { t: 'group', group: null });
    if (g.battle) this.sendTo(playerId, { t: 'battle_abort', k: 'coop' });
    if (g.members.length === 0) { this.groups.delete(g.id); return; }
    if (g.leaderId === playerId) g.leaderId = g.members[0];
    g.leaderRecruits = null; // the group changed: back to automatic
    this.groupMessage(g, `${this.nameOf(playerId)} ${verb}.`);
    this.broadcastGroup(g);
  }

  // ------------------------------------------------------------------ group fights
  // the members fighting together: online, with a hero (the leader first)
  groupPlayers(g) {
    const ids = [g.leaderId, ...g.members.filter(id => id !== g.leaderId)];
    return ids.map(id => this.sessions.get(id)?.player).filter(p => p && L.hero(p));
  }
  // a group fights together when at least two members are online — or when the leader picked an encounter
  groupActive(g) { return !!g && (this.groupPlayers(g).length >= 2 || !!g.battle || !!g.next); }
  inGroupFight(playerId) { const g = this.groupOf(playerId); return !!g && this.groupActive(g); }

  // leader only: what the group fights next (starts right away; the running fight is dropped)
  setGroupNext(g, next) {
    if (g.battle) this.abortGroupFight(g);
    g.next = next;
    g.restUntil = 0;
  }
  abortGroupFight(g) {
    if (!g.battle) return;
    for (const id of g.members) this.sendTo(id, { t: 'battle_abort', k: 'coop' });
    g.battle = null; g.fight = null; g.encounterId = null;
    this.broadcastGroup(g);
  }

  startGroupFight(g) {
    const players = this.groupPlayers(g);
    if (!players.length) { g.next = null; return; }
    const next = g.next || { kind: 'idle', zoneId: players[0].zone };
    const lineup = this.coopLineupOf(g, players).byPlayer;
    let fight = null;
    try {
      if (next.kind === 'pinnacle') { this.pinnacle.check(players[0], players.filter(p => lineup[p.id]?.length), next.bossId); this.pinnacle.pay(players[0]); this.markDirty(this.sessions.get(players[0].id)); }
      fight = this.buildFight(next, players, lineup, { group: true });
    } catch (e) {
      this.groupMessage(g, `Could not start: ${e.message}`);
      g.next = null; g.restUntil = Date.now() + 5000;
      this.broadcastGroup(g);
      return;
    }
    if (!fight) { g.next = null; g.restUntil = Date.now() + 5000; return; }
    // the next fight is the zone again unless a rift continues (nextAfter) — encounters and pinnacle bosses are one-offs
    g.next = next.kind === 'rift' ? next : null;
    g.battle = fight.battle;
    g.fight = fight;
    g.encounterId = fight.encounterId || null;
    g.participants = fight.participants;
    if (players.length > 1) g.recruitTurn = ((g.recruitTurn || 0) + 1) % players.length; // next fight, the next player goes first for the recruit slots
    for (const p of players) {
      const ss = this.sessions.get(p.id);
      if (ss?.solo?.battle && ss.solo.kind !== 'arena') { this.sendTo(p.id, { t: 'battle_abort', k: 'solo' }); ss.solo = { restUntil: 0 }; }
      this.sendTo(p.id, { t: 'battle_start', k: 'coop', battle: battleSnapshot(g.battle) });
    }
    if (next.kind !== 'idle') this.groupMessage(g, `The group engages: ${fight.battle.meta.title}!`);
    this.broadcastGroup(g);
  }

  tickGroup(g) {
    const b = g.battle;
    stepBattle(b);
    const msg = { t: 'bt', k: 'coop', time: Math.round(b.time * 10) / 10, wave: b.waveIndex + 1, u: b.units.map(u => dynamicUnit(u, b)), e: drainEvents(b) };
    if (!this.headless) for (const id of g.members) this.sendTo(id, msg);
    if (b.state === 'running') return;
    const fight = g.fight;
    const won = b.state === 'victory';
    this.settleFight(fight);
    const leader = this.sessions.get(g.leaderId)?.player;
    const after = leader ? this.nextAfter(fight, leader) : null;
    g.next = after; // a rift continues as the leader set it; everything else goes back to the leader's zone
    if (fight.kind !== 'idle') this.groupMessage(g, won ? `Victory! ${b.meta.title} has been conquered.` : `The group was defeated by ${b.meta.title}.`);
    g.battle = null; g.fight = null; g.encounterId = null;
    g.restUntil = Date.now() + (won ? (fight.kind === 'idle' ? CONFIG.combat.restBetweenFights : 3) : CONFIG.combat.reviveDelay) * 1000;
    this.broadcastGroup(g);
  }

  tickGroups(now) {
    for (const g of this.groups.values()) {
      if (g.battle) { this.tickGroup(g); continue; }
      if (!this.groupActive(g) || now < (g.restUntil || 0)) continue;
      this.startGroupFight(g);
    }
  }

  // bot players are marked with 🤖 unless the admin turned the tag off
  showBot(id) { return !!(this.bots?.isBot(id) && this.settings.get('botTag')); }

  broadcastOnline() {
    this.onlineDirty = false;
    this.lastOnlineSent = Date.now();
    const list = [...this.sessions.values()].map(s => {
      const h = L.hero(s.player);
      return { id: s.player.id, name: s.player.name, bot: this.showBot(s.player.id), hero: h ? { name: h.name, classId: h.classId, subclass: h.subclass || null, level: h.level } : null, inGroup: !!this.groupOf(s.player.id) };
    });
    for (const s of this.sessions.values()) this.sendTo(s.player.id, { t: 'online', players: list });
  }
}

export { itemSellValue };
