// SQLite persistence (data/ashenvale.db).
//
// The game keeps players and shared state in memory and writes everything that changed in ONE
// transaction (flush). Because the server is single-threaded, every flush is a consistent snapshot:
// a trade that changes the buyer, the seller's mailbox and the auction house is saved completely or
// not at all — never half.
//
// Driver: better-sqlite3 (preferred) or Node's built-in node:sqlite as a fallback (Node 22.13+).
// Old JSON saves (accounts.json, players/*.json, ...) are imported automatically on first start and
// moved to data/json-backup-<date>/.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DB_FILE = 'ashenvale.db';
const SCHEMA_VERSION = 1;
// legacy JSON file -> document key
const LEGACY_DOCS = { 'settings.json': 'settings', 'admins.json': 'admins', 'admin-log.json': 'admin-log', 'auction.json': 'auction', 'groups.json': 'groups', 'announcements.json': 'announcements' };

function openDatabase(file) {
  const errors = [];
  try {
    const Database = require('better-sqlite3');
    return { db: new Database(file), driver: 'better-sqlite3' };
  } catch (e) { errors.push(`better-sqlite3: ${e.message.split('\n')[0]}`); }
  try {
    const { DatabaseSync } = require('node:sqlite');
    return { db: new DatabaseSync(file), driver: 'node:sqlite' };
  } catch (e) { errors.push(`node:sqlite: ${e.message.split('\n')[0]}`); }
  throw new Error(`No SQLite driver available. Run "npm install" (or "npm rebuild better-sqlite3" after changing the Node version), or use Node.js 22.13 or newer.\n  ${errors.join('\n  ')}`);
}

export class Store {
  constructor(dataDir, { log = console.log } = {}) {
    this.dataDir = dataDir;
    this.log = log;
    fs.mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, DB_FILE);
    const { db, driver } = openDatabase(this.file);
    this.db = db;
    this.driver = driver;
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, name TEXT, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS docs (key TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
    `);
    this.q = {
      getMeta: db.prepare('SELECT value FROM meta WHERE key = ?'),
      setMeta: db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
      allAccounts: db.prepare('SELECT data FROM accounts'),
      putAccount: db.prepare('INSERT INTO accounts (id, username, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET username = excluded.username, data = excluded.data'),
      delAccount: db.prepare('DELETE FROM accounts WHERE id = ?'),
      getPlayer: db.prepare('SELECT data FROM players WHERE id = ?'),
      putPlayer: db.prepare('INSERT INTO players (id, name, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, data = excluded.data, updated_at = excluded.updated_at'),
      delPlayer: db.prepare('DELETE FROM players WHERE id = ?'),
      getDoc: db.prepare('SELECT data FROM docs WHERE key = ?'),
      putDoc: db.prepare('INSERT INTO docs (key, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'),
      counts: db.prepare('SELECT (SELECT COUNT(*) FROM accounts) AS accounts, (SELECT COUNT(*) FROM players) AS players'),
    };
    if (!this.q.getMeta.get('schema')) this.q.setMeta.run('schema', String(SCHEMA_VERSION));
    this.importLegacyJson();

    this.accounts = {};          // lowercase username -> account (all accounts stay in memory; they are small)
    for (const row of this.q.allAccounts.all()) { const a = JSON.parse(row.data); this.accounts[a.username.toLowerCase()] = a; }
    this.players = new Map();    // id -> player (loaded lazily)
    this.dirty = new Set();      // player ids
    this.dirtyAccounts = new Set();
    this.dirtyDocs = new Map();  // key -> value
  }

  // Runs fn inside one transaction (all or nothing)
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { try { this.db.exec('ROLLBACK'); } catch { /* already rolled back */ } throw e; }
  }

  // ------------------------------------------------------------------ accounts
  getAccount(username) { return this.accounts[String(username).toLowerCase()] || null; }
  findAccountById(id) { return Object.values(this.accounts).find(a => a.id === id) || null; }
  setAccount(acc) { this.accounts[acc.username.toLowerCase()] = acc; this.dirtyAccounts.add(acc.username.toLowerCase()); }
  allPlayerNames() { return Object.values(this.accounts).map(a => ({ id: a.id, username: a.username })); }

  // ------------------------------------------------------------------ players
  loadPlayer(id) {
    if (this.players.has(id)) return this.players.get(id);
    if (typeof id !== 'string' || !/^[a-z0-9]+$/i.test(id)) return null;
    const row = this.q.getPlayer.get(id);
    if (!row) return null;
    const p = JSON.parse(row.data);
    this.players.set(id, p);
    return p;
  }
  savePlayerSoon(player) { this.players.set(player.id, player); this.dirty.add(player.id); }

  // ------------------------------------------------------------------ shared documents (settings, auction house, ...)
  getDoc(key, fallback) {
    if (this.dirtyDocs.has(key)) return this.dirtyDocs.get(key);
    const row = this.q.getDoc.get(key);
    if (!row) return fallback;
    try { return JSON.parse(row.data); } catch { return fallback; }
  }
  putDoc(key, value) { this.dirtyDocs.set(key, value); }
  // documents whose key is in [from, to) — e.g. all hourly balance buckets of a time range (flush first)
  docsBetween(from, to) {
    this.q.docsBetween ||= this.db.prepare('SELECT key, data FROM docs WHERE key >= ? AND key < ? ORDER BY key');
    const out = [];
    for (const row of this.q.docsBetween.all(from, to)) { try { out.push(JSON.parse(row.data)); } catch { /* skip broken */ } }
    return out;
  }
  deleteDocsBetween(from, to) {
    this.q.deleteDocsBetween ||= this.db.prepare('DELETE FROM docs WHERE key >= ? AND key < ?');
    this.q.deleteDocsBetween.run(from, to);
  }

  // ------------------------------------------------------------------ saving
  // Writes everything that changed since the last flush in one transaction.
  flush() {
    if (!this.dirty.size && !this.dirtyAccounts.size && !this.dirtyDocs.size) return;
    const now = Date.now();
    this.transaction(() => {
      for (const key of this.dirtyAccounts) {
        const a = this.accounts[key];
        if (a) this.q.putAccount.run(a.id, key, JSON.stringify(a));
      }
      for (const id of this.dirty) {
        const p = this.players.get(id);
        if (p) this.q.putPlayer.run(id, p.name ?? null, JSON.stringify(p), now);
      }
      for (const [key, value] of this.dirtyDocs) this.q.putDoc.run(key, JSON.stringify(value), now);
    });
    this.dirty.clear();
    this.dirtyAccounts.clear();
    this.dirtyDocs.clear();
  }

  // how many saved players mention this string as a JSON value (used to warn before removing content)
  countPlayersMentioning(id) {
    this.flush();
    const esc = String(id).replace(/[\\%_]/g, c => '\\' + c);
    if (!this.q.countMention) this.q.countMention = this.db.prepare("SELECT COUNT(*) AS n FROM players WHERE data LIKE ? ESCAPE '\\'");
    return this.q.countMention.get(`%"${esc}"%`).n;
  }

  deleteAccount(acc) {
    const key = acc.username.toLowerCase();
    delete this.accounts[key];
    this.dirtyAccounts.delete(key);
    this.players.delete(acc.id);
    this.dirty.delete(acc.id);
    this.flush();
    this.transaction(() => { this.q.delAccount.run(acc.id); this.q.delPlayer.run(acc.id); });
  }

  // Consistent copy of the whole database (safe while the server runs). Keeps the newest `keep` files.
  backup(dir = path.join(this.dataDir, 'backups'), keep = 7) {
    this.flush();
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const target = path.join(dir, `ashenvale-${stamp}.db`);
    this.db.prepare('VACUUM INTO ?').run(target);
    const old = fs.readdirSync(dir).filter(f => /^ashenvale-.*\.db$/.test(f)).sort();
    for (const f of old.slice(0, Math.max(0, old.length - keep))) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ } }
    return target;
  }

  // ---- wipe (console "wipe"): scheduled now, carried out on the next start before anything is loaded
  scheduleWipe(mode) { this.q.setMeta.run('wipe', mode || ''); }
  pendingWipe() { return this.q.getMeta.get('wipe')?.value || null; }
  // progress: every player's progress, the auction house, groups and balance statistics go; accounts (logins),
  //           admins, settings, announcements, bots and content overrides stay. Players create a new hero on login.
  // accounts: the same, and all accounts (and the bot list) go too.
  wipe(mode) {
    this.flush();
    this.transaction(() => {
      this.db.exec("DELETE FROM players; DELETE FROM docs WHERE key IN ('auction', 'groups') OR key LIKE 'balance:%';");
      if (mode === 'accounts') {
        this.db.exec('DELETE FROM accounts;');
        const bots = this.q.getDoc.get('bots');
        if (bots) this.q.putDoc.run('bots', JSON.stringify({ ...JSON.parse(bots.data), bots: [] }), Date.now());
      }
      this.q.setMeta.run('wipe', '');
    });
    this.players.clear(); this.dirty.clear(); this.dirtyDocs.clear();
    if (mode === 'accounts') { this.accounts = {}; this.dirtyAccounts.clear(); }
    try { this.db.exec('VACUUM'); } catch { /* ignore */ }
  }

  stats() { return { ...this.q.counts.get(), driver: this.driver, sizeMb: Math.round(fs.statSync(this.file).size / 1048576 * 10) / 10 }; }

  close() { this.flush(); try { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ } this.db.close(); }

  // ------------------------------------------------------------------ one-time import of the old JSON saves
  importLegacyJson() {
    if (this.q.getMeta.get('legacy_json_imported')) return;
    const dir = this.dataDir;
    const playersDir = path.join(dir, 'players');
    const accountsFile = path.join(dir, 'accounts.json');
    const docFiles = Object.keys(LEGACY_DOCS).filter(f => fs.existsSync(path.join(dir, f)));
    const playerFiles = fs.existsSync(playersDir) ? fs.readdirSync(playersDir).filter(f => /^[a-z0-9]+\.json$/i.test(f)) : [];
    if (!fs.existsSync(accountsFile) && !playerFiles.length && !docFiles.length) {
      this.q.setMeta.run('legacy_json_imported', 'none');
      return;
    }
    const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
    const now = Date.now();
    let accounts = 0, players = 0;
    const skipped = [];
    this.transaction(() => {
      if (fs.existsSync(accountsFile)) {
        for (const a of Object.values(read(accountsFile))) {
          if (!a?.id || !a?.username) continue;
          this.q.putAccount.run(a.id, a.username.toLowerCase(), JSON.stringify(a));
          accounts++;
        }
      }
      for (const f of playerFiles) {
        try {
          const p = read(path.join(playersDir, f));
          this.q.putPlayer.run(p.id || f.replace(/\.json$/, ''), p.name ?? null, JSON.stringify(p), now);
          players++;
        } catch { skipped.push(f); }
      }
      for (const f of docFiles) {
        try { this.q.putDoc.run(LEGACY_DOCS[f], JSON.stringify(read(path.join(dir, f))), now); } catch { skipped.push(f); }
      }
      this.q.setMeta.run('legacy_json_imported', new Date(now).toISOString());
    });
    // keep the old files as a backup, out of the way
    const backupDir = path.join(dir, `json-backup-${new Date(now).toISOString().slice(0, 10)}`);
    fs.mkdirSync(backupDir, { recursive: true });
    const move = name => { const from = path.join(dir, name); if (fs.existsSync(from)) fs.renameSync(from, path.join(backupDir, name)); };
    move('accounts.json');
    for (const f of docFiles) move(f);
    if (fs.existsSync(playersDir)) move('players');
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.json.tmp')) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ } }
    this.log(`Imported old JSON saves into the database: ${accounts} accounts, ${players} players, ${docFiles.length} other files${skipped.length ? ` (could not read: ${skipped.join(', ')})` : ''}. Old files moved to ${path.basename(backupDir)}/`);
  }
}
