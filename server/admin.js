// Admin tools: roles, player management, bans, gifts, settings, audit log.
// Admins come from the ADMIN_USERS environment variable (comma separated usernames)
// plus data/admins.json (managed with the console command "admin add <name>").
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MATERIALS } from '../shared/data/town.js';
import { generateItem, ITEM_BASES } from '../shared/data/items.js';
import { generateUnique, generateSetItem, UNIQUES, SETS } from '../shared/data/legendaries.js';
import { CONFIG } from '../shared/config.js';
import { createRng, randomSeed } from '../shared/rng.js';
import { SETTING_DEFS } from './settings.js';
import { GameError, hero, sendMail } from './playerLogic.js';
import { setPassword } from './auth.js';

const fail = m => { throw new GameError(m); };

export class AdminManager {
  constructor(dataDir, envList = '') {
    this.file = path.join(dataDir, 'admins.json');
    this.logFile = path.join(dataDir, 'admin-log.json');
    this.env = new Set(String(envList || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
    try { this.extra = new Set(JSON.parse(fs.readFileSync(this.file, 'utf8')).map(s => s.toLowerCase())); } catch { this.extra = new Set(); }
    try { this.log = JSON.parse(fs.readFileSync(this.logFile, 'utf8')); } catch { this.log = []; }
  }
  has(name) { const n = String(name || '').toLowerCase(); return this.env.has(n) || this.extra.has(n); }
  list() { return [...new Set([...this.env, ...this.extra])]; }
  add(name) { this.extra.add(name.toLowerCase()); this.persist(); }
  remove(name) { this.extra.delete(name.toLowerCase()); this.persist(); return !this.env.has(name.toLowerCase()); }
  persist() { fs.writeFileSync(this.file, JSON.stringify([...this.extra])); }
  audit(admin, action, target, details = '') {
    this.log.push({ at: Date.now(), admin, action, target, details: String(details).slice(0, 300) });
    if (this.log.length > 500) this.log.splice(0, this.log.length - 500);
    try { fs.writeFileSync(this.logFile, JSON.stringify(this.log)); } catch { /* ignore */ }
  }
}

export function isBanned(acc) {
  if (!acc?.banned) return false;
  if (acc.banned.until && acc.banned.until < Date.now()) return false;
  return true;
}

// ---------------------------------------------------------------- actions (bound to Game)
export function adminActions(game) {
  const store = game.store;
  const admins = game.admins;
  const loadById = id => {
    const acc = store.findAccountById(String(id));
    if (!acc) fail('Player not found');
    const p = game.sessions.get(acc.id)?.player || store.loadPlayer(acc.id);
    return { acc, p };
  };
  const summary = acc => {
    const p = game.sessions.get(acc.id)?.player || store.loadPlayer(acc.id);
    const h = p ? hero(p) : null;
    return {
      id: acc.id, username: acc.username, createdAt: acc.createdAt, online: game.sessions.has(acc.id),
      lastActive: game.sessions.has(acc.id) ? Date.now() : p?.lastActive || null,
      hero: h ? { name: h.name, classId: h.classId, level: h.level } : null, gold: p?.gold || 0, premium: p?.premium || 0,
      banned: isBanned(acc) ? acc.banned : null, admin: admins.has(acc.username),
      kills: p?.stats?.kills || 0, characters: p ? Object.keys(p.characters).length : 0,
    };
  };
  const kick = (id, reason) => {
    const s = game.sessions.get(id);
    if (!s) return;
    for (const ws of s.sockets) { game.send(ws, { t: 'toast', text: reason, kind: 'error' }); ws.close(4001, reason.slice(0, 100)); }
  };

  return {
    admin_overview() {
      const accounts = store.allPlayerNames();
      const mem = process.memoryUsage();
      return {
        online: game.sessions.size, accounts: accounts.length, uptime: Math.round((Date.now() - game.startedAt) / 1000),
        memoryMb: Math.round(mem.rss / 1048576), buildId: game.buildId, node: process.version,
        groups: game.groups.size, coopBattles: [...game.groups.values()].filter(g => g.battle).length,
        auction: game.auction.stats(), settings: game.settings.values, settingDefs: SETTING_DEFS,
        admins: admins.list(), log: admins.log.slice(-60).reverse(),
        onlineNames: [...game.sessions.values()].map(s => s.player.name),
      };
    },
    admin_players(s, d) {
      const q = String(d.query || '').toLowerCase().trim();
      let list = store.allPlayerNames().map(a => store.findAccountById(a.id)).filter(Boolean).map(summary);
      if (q) list = list.filter(x => x.username.toLowerCase().includes(q) || x.hero?.name.toLowerCase().includes(q));
      const sorts = { online: (a, b) => b.online - a.online || (b.lastActive || 0) - (a.lastActive || 0), level: (a, b) => (b.hero?.level || 0) - (a.hero?.level || 0), gold: (a, b) => b.gold - a.gold, newest: (a, b) => b.createdAt - a.createdAt, name: (a, b) => a.username.localeCompare(b.username) };
      list.sort(sorts[d.sort] || sorts.online);
      return { total: list.length, rows: list.slice(0, 300) };
    },
    admin_player(s, d) {
      const { acc, p } = loadById(d.id);
      return {
        ...summary(acc),
        player: p ? {
          gold: p.gold, premium: p.premium || 0, materials: p.town?.materials || {}, inventory: p.inventory, mailbox: (p.mailbox || []).length,
          characters: Object.values(p.characters).map(c => ({ id: c.id, name: c.name, classId: c.classId, level: c.level, isMain: c.isMain, profession: c.profession || null })),
          stats: p.stats, zone: p.zone, unlockedZones: p.unlockedZones, town: Object.fromEntries(Object.entries(p.town?.buildings || {}).map(([k, b]) => [k, b.level])),
          expeditions: (p.expeditions || []).length, auctions: game.auction.data.listings.filter(l => l.sellerId === acc.id).length,
        } : null,
      };
    },
    admin_kick(s, d) {
      const { acc } = loadById(d.id);
      kick(acc.id, 'You were disconnected by an admin.');
      admins.audit(s.player.name, 'kick', acc.username);
    },
    admin_ban(s, d) {
      const { acc } = loadById(d.id);
      if (admins.has(acc.username)) fail('Remove admin rights before banning an admin');
      const hours = Math.max(0, Number(d.hours) || 0);
      acc.banned = { reason: String(d.reason || 'No reason given').slice(0, 200), at: Date.now(), until: hours ? Date.now() + hours * 3600000 : null, by: s.player.name };
      acc.tokens = [];
      store.setAccount(acc);
      kick(acc.id, `You have been banned: ${acc.banned.reason}`);
      admins.audit(s.player.name, 'ban', acc.username, `${hours ? hours + 'h' : 'permanent'} — ${acc.banned.reason}`);
    },
    admin_unban(s, d) {
      const { acc } = loadById(d.id);
      delete acc.banned;
      store.setAccount(acc);
      admins.audit(s.player.name, 'unban', acc.username);
    },
    admin_give(s, d) {
      const { acc, p } = loadById(d.id);
      if (!p) fail('This account has no game data yet');
      const gold = Math.max(0, Math.min(1e9, Math.floor(Number(d.gold) || 0)));
      const premium = Math.max(0, Math.min(1e6, Math.floor(Number(d.premium) || 0)));
      const materials = {};
      for (const [k, v] of Object.entries(d.materials || {})) { const n = Math.floor(Number(v) || 0); if (MATERIALS[k] && n > 0) materials[k] = Math.min(1e6, n); }
      let item = null;
      if (d.item?.type) {
        const rng = createRng(randomSeed());
        const lvl = Math.max(1, Math.min(CONFIG.levelCap, Number(d.item.level) || hero(p)?.level || 1));
        if (d.item.type === 'unique') item = generateUnique(rng, lvl, UNIQUES[d.item.uniqueId] ? d.item.uniqueId : null);
        else if (d.item.type === 'set') item = generateSetItem(rng, lvl, SETS[d.item.setId] ? d.item.setId : null, d.item.baseId || null);
        else item = generateItem(rng, lvl, { baseId: ITEM_BASES[d.item.baseId] ? d.item.baseId : null, rarity: CONFIG.rarities.some(r => r.id === d.item.rarity) ? d.item.rarity : null });
      }
      if (!gold && !premium && !Object.keys(materials).length && !item) fail('Nothing to give');
      const note = String(d.note || 'A gift from the server admins.').slice(0, 200);
      if (item) sendMail(p, { item, from: 'Server', note });
      if (gold || premium || Object.keys(materials).length) sendMail(p, { gold, premium, materials: Object.keys(materials).length ? materials : null, from: 'Server', note });
      store.savePlayerSoon(p);
      const ses = game.sessions.get(acc.id);
      if (ses) { ses.stateDirty = true; game.toast(acc.id, `🎁 You received a gift: ${note} Check your mailbox in the Auction House.`, 'success'); }
      admins.audit(s.player.name, 'give', acc.username, [gold && `${gold} gold`, premium && `${premium} crystals`, ...Object.entries(materials).map(([k, v]) => `${v} ${k}`), item && item.name].filter(Boolean).join(', '));
      return { item };
    },
    admin_reset_password(s, d) {
      const { acc } = loadById(d.id);
      const pw = crypto.randomBytes(6).toString('base64url');
      setPassword(store, acc, pw);
      kick(acc.id, 'Your password was reset by an admin.');
      admins.audit(s.player.name, 'reset_password', acc.username);
      return { password: pw };
    },
    admin_delete(s, d) {
      const { acc } = loadById(d.id);
      if (String(d.confirm || '') !== acc.username) fail('Type the exact username to confirm');
      if (admins.has(acc.username)) fail('Remove admin rights first');
      kick(acc.id, 'Your account was deleted.');
      if (game.groupOf(acc.id)) { try { game.leaveGroup(acc.id); } catch { /* ignore */ } }
      game.sessions.delete(acc.id);
      game.auction.removeSeller(acc.id);
      store.deleteAccount(acc);
      admins.audit(s.player.name, 'delete', acc.username);
    },
    admin_settings(s, d) {
      game.settings.set(d.changes || {});
      admins.audit(s.player.name, 'settings', '-', JSON.stringify(d.changes || {}));
      return game.settings.values;
    },
    admin_broadcast(s, d) {
      const text = String(d.text || '').trim().slice(0, 300);
      if (!text) fail('Message is empty');
      game.broadcast({ t: 'announcement', text, from: s.player.name });
      admins.audit(s.player.name, 'broadcast', '-', text);
    },
  };
}
