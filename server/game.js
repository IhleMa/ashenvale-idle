// Game server: sessions, action dispatch, server-authoritative battle loop, offline progression, groups.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../shared/config.js';
import { ZONES, COOP_ENCOUNTERS } from '../shared/data/zones.js';
import { generateItem, itemSellValue } from '../shared/data/items.js';
import { createBattle, stepBattle, drainEvents, battleSnapshot, dynamicUnit, runToEnd } from '../shared/combat.js';
import { buildPartyUnits, partyBonuses } from '../shared/party.js';
import { idleWaves, bossWaves, coopWaves, coopScale, computeRewards, zoneLevel } from '../shared/encounters.js';
import { createRng, randomSeed } from '../shared/rng.js';
import { ABILITIES } from '../shared/data/abilities.js';
import { Rankings } from './rankings.js';
import { AuctionHouse } from './auction.js';
import { adminActions } from './admin.js';
import * as TL from './townLogic.js';
import * as XL from './expeditionLogic.js';
import { EXPEDITIONS } from '../shared/data/expeditions.js';
import { elixirBonuses } from '../shared/town.js';
import { speedUpCost } from '../shared/premium.js';
import { BUILDINGS } from '../shared/data/town.js';
import * as L from './playerLogic.js';

const { GameError } = L;
const READ_ONLY = new Set(['get_rankings', 'inspect_player', 'ah_search', 'ah_mine']);
const fail = m => { throw new GameError(m); };

export class Game {
  constructor({ store, assets, settings, admins = null, buildId = 'dev', log = console.log }) {
    this.buildId = buildId;
    this.settings = settings;
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
    this.auction = new AuctionHouse(this);
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
    this.store.flush();
    this.auction.save();
    this.saveGroups();
  }

  // Groups survive restarts (battles and pending invites do not)
  get groupsFile() { return path.join(this.store.dataDir, 'groups.json'); }
  saveGroups() {
    const data = [...this.groups.values()].map(g => ({ id: g.id, leaderId: g.leaderId, members: g.members, chat: g.chat.slice(-30) }));
    try { fs.writeFileSync(this.groupsFile, JSON.stringify(data)); } catch (e) { this.log('Could not save groups', e.message); }
  }
  loadGroups() {
    let data = [];
    try { data = JSON.parse(fs.readFileSync(this.groupsFile, 'utf8')); } catch { return; }
    for (const g of data) {
      if (!Array.isArray(g.members) || !g.members.length) continue;
      const group = { id: g.id, leaderId: g.members.includes(g.leaderId) ? g.leaderId : g.members[0], members: g.members, invites: new Map(), battle: null, chat: g.chat || [] };
      this.groups.set(group.id, group);
      for (const m of group.members) this.playerGroup.set(m, group.id);
    }
    if (data.length) this.log(`Restored ${data.length} group(s)`);
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const s of this.sessions.values()) for (const ws of s.sockets) if (ws.readyState === 1) ws.send(data);
  }

  save() {
    const now = Date.now();
    for (const s of this.sessions.values()) { s.player.lastActive = now; this.store.savePlayerSoon(s.player); }
    this.store.flush();
    this.auction.save();
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
    const s = this.sessions.get(playerId);
    if (!s) return;
    const data = JSON.stringify(msg);
    for (const ws of s.sockets) if (ws.readyState === 1) ws.send(data);
  }
  toast(playerId, text, kind = 'info') { this.sendTo(playerId, { t: 'toast', text, kind }); }

  flushState(s) {
    if (!s.stateDirty) return;
    s.stateDirty = false;
    this.sendTo(s.player.id, { t: 'state', player: L.publicPlayer(s.player) });
  }

  markDirty(s) { s.stateDirty = true; this.store.savePlayerSoon(s.player); }

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
      const result = handler.call(this, s, payload);
      if (!READ_ONLY.has(msg.type) && !isAdminAction) this.markDirty(s);
      this.send(ws, { t: 'result', id: msg.id, ok: true, result: result ?? null });
      this.flushState(s);
    } catch (e) {
      if (!(e instanceof GameError)) this.log('Action error', msg.type, e);
      this.send(ws, { t: 'result', id: msg.id, ok: false, error: e instanceof GameError ? e.message : 'Server error' });
    }
  }

  actions = {
    create_hero(s, d) {
      const ch = L.createHero(s.player, d, this.assets.get());
      this.toast(s.player.id, `Welcome to Ashenvale, ${ch.name}! Your first companion is free — visit Recruitment.`, 'success');
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
    toggle_lock(s, d) { L.toggleLock(s.player, d); },
    set_settings(s, d) { L.setSettings(s.player, d); },
    // ---- town
    town_upgrade(s, d) { const r = TL.upgradeBuilding(s.player, { buildingId: String(d.buildingId) }); return r; },
    town_assign(s, d) { this.ensureNotInCoop(s.player.id); TL.assignWorker(s.player, { buildingId: String(d.buildingId), charId: d.charId ? String(d.charId) : null }); this.abortSoloIfUsing(s, d.charId); },
    expedition_start(s, d) {
      this.ensureNotInCoop(s.player.id);
      const ex = XL.startExpedition(s.player, { destId: String(d.destId), charIds: d.charIds, hours: Number(d.hours) });
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
      return { cost };
    },
    expedition_cancel(s, d) { XL.cancelExpedition(s.player, { id: String(d.id) }); },
    expedition_claim(s, d) {
      const r = d.id ? XL.claimExpedition(s.player, { id: String(d.id) }) : XL.claimAll(s.player);
      this.profToast(s, r.messages);
      L.checkAchievements(s.player);
      return r;
    },
    salvage_items(s, d) { return TL.salvageItems(s.player, d); },
    salvage_by_rarity(s, d) { return TL.salvageByRarity(s.player, d); },
    craft_item(s, d) { const r = TL.craft(s.player, d, L.hero(s.player).level); this.profToast(s, r.msg); return r; },
    reforge_item(s, d) { const r = TL.reforge(s.player, d, L.hero(s.player).level); this.profToast(s, r.msg); return r; },
    enchant_item(s, d) { const r = TL.enchant(s.player, d); this.profToast(s, r.msg); return r; },
    brew_elixir(s, d) { const r = TL.brew(s.player, d, L.hero(s.player).level); this.profToast(s, r.msg); return r; },

    collect_mail(s, d) { return L.collectMail(s.player, { id: d.id }); },
    ah_search(s, d) { return this.auction.search(s.player, d); },
    ah_mine(s) { return this.auction.mine(s.player); },
    ah_list(s, d) { return this.auction.list(s.player, { itemUid: d.itemUid ? String(d.itemUid) : null, material: d.material ? String(d.material) : null, qty: d.qty, price: d.price, hours: d.hours }); },
    ah_cancel(s, d) { this.auction.cancel(s.player, { id: String(d.id) }); },
    ah_buy(s, d) { return this.auction.buy(s.player, { id: String(d.id) }); },

    get_rankings(s, d) {
      return this.rankings.board({ category: String(d.category || 'level'), classId: d.classId ? String(d.classId) : null, search: d.search, limit: Number(d.limit) || 100 }, s.player.id);
    },
    inspect_player(s, d) {
      const prof = this.rankings.inspect(String(d.name || ''));
      if (!prof) fail('Player not found');
      return prof;
    },
    refresh_recruits(s) { L.refreshRecruits(s.player, false, this.assets.get()); },
    recruit(s, d) { const ch = L.recruit(s.player, d); this.toast(s.player.id, `${ch.name} joined your roster!`, 'success'); },
    dismiss(s, d) { this.ensureNotInCoop(s.player.id); L.dismiss(s.player, d); this.abortSolo(s); },
    set_party(s, d) { L.setParty(s.player, d); },
    rename_party(s, d) { L.renameParty(s.player, d); },
    activate_party(s, d) { L.activateParty(s.player, d); this.abortSolo(s); },
    set_zone(s, d) { L.setZone(s.player, d); this.abortSolo(s); },
    challenge_boss(s, d) {
      const zoneId = d.zoneId;
      if (!ZONES[zoneId] || !s.player.unlockedZones.includes(zoneId)) fail('Zone locked');
      this.ensureNotInCoop(s.player.id);
      this.abortSolo(s);
      s.solo = { next: { kind: 'boss', zoneId }, restUntil: 0 };
    },
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
      this.groupMessage(g, `${this.nameOf(d.playerId)} is now the group leader.`);
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
    group_start(s, d) { this.startCoop(s, d.encounterId); },
  };

  // A companion who just left for work/expedition must not keep fighting in the running battle
  abortSoloIfUsing(s, charId) {
    if (charId && s.solo?.battle && s.solo.chars?.includes(String(charId))) this.abortSolo(s);
  }

  profToast(s, msg) {
    for (const m of [].concat(msg || [])) if (m) this.toast(s.player.id, m, 'success');
  }

  ensureNotInCoop(playerId) {
    if (this.groupOf(playerId)?.battle) fail('Not possible during a co-op encounter');
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

  startSoloBattle(s) {
    const p = s.player;
    const chars = L.activePartyChars(p);
    if (!chars.length) return;
    const h = L.hero(p);
    const next = s.solo?.next || { kind: 'idle', zoneId: p.zone };
    const zone = ZONES[next.zoneId] || ZONES.whispering_woods;
    const rng = createRng(randomSeed());
    const waves = next.kind === 'boss' ? bossWaves(zone.id, h.level) : idleWaves(zone.id, h.level, rng, chars.length);
    const battle = createBattle({
      seed: randomSeed(), allies: buildPartyUnits(chars, { ownerId: p.id, ownerName: p.name, buffs: elixirBonuses(p) }), waves,
      scale: (next.kind === 'boss' ? zone.bossScale : zone.scale) || { hp: 1, damage: 1 },
      meta: { kind: next.kind, zoneId: zone.id, title: next.kind === 'boss' ? `Boss: ${zone.name}` : zone.name, level: zoneLevel(zone, h.level) },
    });
    s.solo = { battle, kind: next.kind, zoneId: zone.id, chars: chars.map(c => c.id) };
    drainEvents(battle);
    this.sendTo(p.id, { t: 'battle_start', k: 'solo', battle: battleSnapshot(battle) });
  }

  finishSoloBattle(s) {
    const p = s.player;
    const { battle, kind, zoneId } = s.solo;
    const rest = battle.state === 'victory' ? CONFIG.combat.restBetweenFights : CONFIG.combat.reviveDelay;
    const summary = { result: battle.state, kind, zoneId };
    p.stats.fights++;
    if (battle.state === 'victory') {
      const rewards = this.applyElixirRewards(p, computeRewards(battle.kills, createRng(randomSeed()), { lootMult: this.settings.get('lootRate') }));
      rewards.kills = battle.kills.length;
      const chars = s.solo.chars.map(id => p.characters[id]).filter(Boolean);
      if (kind === 'boss') {
        p.stats.bossKills++;
        const unlocked = L.onBossDefeated(p, zoneId);
        for (const z of unlocked) this.toast(p.id, `New zone unlocked: ${z.name}!`, 'success');
        summary.unlocked = unlocked.map(z => z.id);
      }
      const res = L.applyRewards(p, chars, rewards);
      Object.assign(summary, this.rewardSummary(rewards, res));
      for (const lu of res.levelUps) this.toast(p.id, `${lu.name} reached level ${lu.level}!`, 'success');
    }
    for (const a of L.checkAchievements(p)) this.toast(p.id, `Achievement unlocked: ${a.name} (+${a.reward.gold} gold)`, 'achievement');
    this.sendTo(p.id, { t: 'battle_end', k: 'solo', summary });
    L.maybeAutoRefreshRecruits(p, this.assets.get());
    s.solo = { restUntil: Date.now() + rest * 1000 };
    this.markDirty(s);
  }

  applyElixirRewards(p, rewards, at = Date.now()) {
    const eb = elixirBonuses(p, at);
    rewards.xp = Math.round(rewards.xp * (1 + eb.xpPct) * this.settings.get('xpRate'));
    rewards.gold = Math.round(rewards.gold * (1 + eb.goldPct) * this.settings.get('goldRate'));
    return rewards;
  }

  rewardSummary(rewards, res) {
    return {
      xp: rewards.xp, gold: rewards.gold,
      items: rewards.items.map(i => ({ name: i.name, rarity: i.rarity, baseId: i.baseId })),
      sold: res.sold, levelUps: res.levelUps,
    };
  }

  tick() {
    const now = Date.now();
    if (!this.lastAuctionSweep || now - this.lastAuctionSweep > 30000) { this.lastAuctionSweep = now; this.auction.sweepExpired(); }
    if (!this.lastTownCheck || now - this.lastTownCheck > 1000) {
      this.lastTownCheck = now;
      for (const s of this.sessions.values()) {
        if (!s.player.town) continue;
        for (const d of TL.finishConstructions(s.player, now)) { this.toast(s.player.id, `🏗 ${d.name} upgraded to level ${d.level}!`, 'success'); this.markDirty(s); }
        for (const ex of XL.newlyReturned(s.player, now)) { this.toast(s.player.id, `🧭 Your expedition to ${EXPEDITIONS[ex.destId]?.name} has returned — claim the rewards!`, 'success'); this.markDirty(s); }
      }
    }
    for (const s of this.sessions.values()) {
      const p = s.player;
      if (!p.heroId || this.groupOf(p.id)?.battle) { this.flushState(s); continue; }
      if (!s.solo) s.solo = { restUntil: 0 };
      if (!s.solo.battle) {
        if (now >= (s.solo.restUntil || 0)) this.startSoloBattle(s);
      } else {
        const b = s.solo.battle;
        stepBattle(b);
        const events = drainEvents(b);
        this.sendTo(p.id, { t: 'bt', k: 'solo', time: Math.round(b.time * 10) / 10, wave: b.waveIndex + 1, u: b.units.map(dynamicUnit), e: events });
        if (b.state !== 'running') this.finishSoloBattle(s);
      }
      this.flushState(s);
    }
    for (const g of this.groups.values()) if (g.battle) this.tickCoop(g);
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
    while (simTime < seconds && fights < CONFIG.offline.maxSimulatedFights) {
      const h = L.hero(p);
      const at = (p.lastActive || Date.now()) + simTime * 1000;
      const b = createBattle({ seed: rng.int(1, 2 ** 31), allies: buildPartyUnits(chars, { ownerId: p.id, ownerName: p.name, buffs: elixirBonuses(p, at) }), waves: idleWaves(zone.id, h.level, rng, chars.length), scale: zone.scale || { hp: 1, damage: 1 } });
      runToEnd(b);
      fights++;
      simTime += b.time + (b.state === 'victory' ? CONFIG.combat.restBetweenFights : CONFIG.combat.reviveDelay);
      if (b.state !== 'victory') continue;
      wins++;
      const r = this.applyElixirRewards(p, computeRewards(b.kills, rng, { rewardMult: CONFIG.offline.efficiency, lootMult: this.settings.get('lootRate') }), at);
      r.kills = b.kills.length;
      xp += r.xp; gold += r.gold; kills += r.kills;
      const res = L.applyRewards(p, chars, r);
      itemsKept += res.kept; itemsSold += res.sold;
      for (const it of r.items) if (['epic', 'legendary', 'mythic'].includes(it.rarity)) found.push({ name: it.name, rarity: it.rarity });
    }
    // Extrapolate the remaining time from the simulated average (only if the cap was hit)
    if (simTime < seconds && simTime > 0 && wins > 0) {
      const factor = (seconds - simTime) / simTime;
      const ex = { xp: Math.round(xp * factor), gold: Math.round(gold * factor), items: [], kills: Math.round(kills * factor) };
      const extraItems = Math.min(20, Math.round((itemsKept + itemsSold) * factor));
      const h = L.hero(p);
      for (let i = 0; i < extraItems; i++) ex.items.push(generateItem(rng, zoneLevel(zone, h.level), {}));
      const res = L.applyRewards(p, chars, ex);
      xp += ex.xp; gold += ex.gold; kills += ex.kills; itemsKept += res.kept; itemsSold += res.sold;
    }
    p.stats.fights += fights;
    const achievements = L.checkAchievements(p).map(a => a.name);
    return {
      seconds: Math.round(seconds), zone: zone.name, fights, wins, kills, xp, gold, itemsKept, itemsSold, found: found.slice(0, 10), achievements,
      levels: chars.filter(c => c.level > startLevels[c.id]).map(c => ({ name: c.name, from: startLevels[c.id], to: c.level })),
    };
  }

  // ------------------------------------------------------------------ groups & co-op
  groupOf(playerId) { const id = this.playerGroup.get(playerId); return id ? this.groups.get(id) : null; }

  publicGroup(g) {
    const now = Date.now();
    return {
      id: g.id, leaderId: g.leaderId,
      members: g.members.map(id => {
        const p = this.sessions.get(id)?.player || this.store.loadPlayer(id);
        const chars = p ? L.coopCharacters(p) : [];
        return {
          id, name: this.nameOf(id), online: this.sessions.has(id),
          characters: chars.map(c => ({ id: c.id, name: c.name, classId: c.classId, level: c.level, isMain: c.isMain, portrait: c.portrait, role: c.role })),
        };
      }),
      invites: [...g.invites.entries()].filter(([, exp]) => exp > now).map(([id]) => this.nameOf(id)),
      inBattle: !!g.battle, encounterId: g.encounterId || null, chat: g.chat.slice(-30),
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
    this.groupMessage(g, `${this.nameOf(playerId)} ${verb}.`);
    this.broadcastGroup(g);
  }

  startCoop(s, encounterId) {
    const g = this.groupOf(s.player.id) || fail('Create a group first (you can also go alone)');
    if (g.leaderId !== s.player.id) fail('Only the group leader can start encounters');
    if (g.battle) fail('Already in an encounter');
    const enc = COOP_ENCOUNTERS[encounterId] || fail('Unknown encounter');
    const players = g.members.map(id => this.sessions.get(id)?.player);
    if (players.some(p => !p)) fail('All group members must be online');
    for (const p of players) {
      const h = L.hero(p);
      if (!h) fail(`${p.name} has no hero yet`);
      if (h.level < enc.minLevel) fail(`${p.name}'s hero must be level ${enc.minLevel}+`);
    }
    const allChars = players.flatMap(p => L.coopCharacters(p));
    const bonuses = partyBonuses(allChars);
    let offset = 0;
    const allies = [];
    for (const p of players) {
      const chars = L.coopCharacters(p);
      allies.push(...buildPartyUnits(chars, { ownerId: p.id, ownerName: p.name, positionOffset: offset, extraBonuses: bonuses, buffs: elixirBonuses(p) }));
      offset += chars.length;
    }
    const groupLevel = Math.round(players.reduce((sum, p) => sum + L.hero(p).level, 0) / players.length);
    g.battle = createBattle({
      seed: randomSeed(), allies, waves: coopWaves(enc.id, groupLevel), scale: coopScale(players.length),
      meta: { kind: 'coop', encounterId: enc.id, title: enc.name, level: Math.max(enc.minLevel, groupLevel), players: players.length },
    });
    drainEvents(g.battle);
    g.encounterId = enc.id;
    g.participants = players.map(p => ({ id: p.id, chars: L.coopCharacters(p).map(c => c.id) }));
    for (const p of players) {
      const ss = this.sessions.get(p.id);
      if (ss?.solo?.battle) this.sendTo(p.id, { t: 'battle_abort', k: 'solo' });
      if (ss) ss.solo = { restUntil: 0 };
      this.sendTo(p.id, { t: 'battle_start', k: 'coop', battle: battleSnapshot(g.battle) });
    }
    this.groupMessage(g, `The group engages: ${enc.name}!`);
    this.broadcastGroup(g);
  }

  tickCoop(g) {
    const b = g.battle;
    stepBattle(b);
    const msg = { t: 'bt', k: 'coop', time: Math.round(b.time * 10) / 10, wave: b.waveIndex + 1, u: b.units.map(dynamicUnit), e: drainEvents(b) };
    for (const id of g.members) this.sendTo(id, msg);
    if (b.state === 'running') return;

    const enc = COOP_ENCOUNTERS[g.encounterId];
    for (const part of g.participants) {
      if (!g.members.includes(part.id)) continue;
      const p = this.sessions.get(part.id)?.player || this.store.loadPlayer(part.id);
      if (!p) continue;
      const summary = { result: b.state, kind: 'coop', encounterId: enc.id };
      if (b.state === 'victory') {
        const rewards = this.applyElixirRewards(p, computeRewards(b.kills, createRng(randomSeed()), { rewardMult: enc.rewardMult, lootBoost: 0.5, lootMult: this.settings.get('lootRate') }));
        rewards.kills = b.kills.length;
        p.stats.coopWins++;
        p.stats.bossKills += b.kills.filter(k => k.boss).length;
        const res = L.applyRewards(p, part.chars.map(id => p.characters[id]).filter(Boolean), rewards);
        Object.assign(summary, this.rewardSummary(rewards, res));
        for (const lu of res.levelUps) this.toast(p.id, `${lu.name} reached level ${lu.level}!`, 'success');
      }
      for (const a of L.checkAchievements(p)) this.toast(p.id, `Achievement unlocked: ${a.name} (+${a.reward.gold} gold)`, 'achievement');
      this.sendTo(p.id, { t: 'battle_end', k: 'coop', summary });
      const ss = this.sessions.get(p.id);
      if (ss) { ss.solo = { restUntil: Date.now() + 4000 }; this.markDirty(ss); } else this.store.savePlayerSoon(p);
    }
    this.groupMessage(g, b.state === 'victory' ? `Victory! ${enc.name} has been conquered.` : `The group was defeated by ${enc.name}.`);
    g.battle = null;
    g.encounterId = null;
    this.broadcastGroup(g);
  }

  broadcastOnline() {
    this.onlineDirty = false;
    this.lastOnlineSent = Date.now();
    const list = [...this.sessions.values()].map(s => {
      const h = L.hero(s.player);
      return { id: s.player.id, name: s.player.name, hero: h ? { name: h.name, classId: h.classId, level: h.level } : null, inGroup: !!this.groupOf(s.player.id) };
    });
    for (const s of this.sessions.values()) this.sendTo(s.player.id, { t: 'online', players: list });
  }
}

export { itemSellValue };
