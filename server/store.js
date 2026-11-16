// JSON-file persistence. Writes are atomic (write temp file, then rename).
import fs from 'node:fs';
import path from 'node:path';

export class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.playersDir = path.join(dataDir, 'players');
    fs.mkdirSync(this.playersDir, { recursive: true });
    this.accountsFile = path.join(dataDir, 'accounts.json');
    this.accounts = this.#readJson(this.accountsFile, {});
    this.players = new Map();   // id -> player (loaded lazily)
    this.dirty = new Set();
    this.accountsDirty = false;
  }

  #readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
  }

  #writeJson(file, data) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  }

  getAccount(username) { return this.accounts[username.toLowerCase()] || null; }
  findAccountById(id) { return Object.values(this.accounts).find(a => a.id === id) || null; }
  setAccount(acc) { this.accounts[acc.username.toLowerCase()] = acc; this.accountsDirty = true; }

  loadPlayer(id) {
    if (this.players.has(id)) return this.players.get(id);
    if (!/^[a-z0-9]+$/i.test(id)) return null;
    const p = this.#readJson(path.join(this.playersDir, id + '.json'), null);
    if (p) this.players.set(id, p);
    return p;
  }

  savePlayerSoon(player) { this.players.set(player.id, player); this.dirty.add(player.id); }

  flush() {
    for (const id of this.dirty) {
      const p = this.players.get(id);
      if (p) this.#writeJson(path.join(this.playersDir, id + '.json'), p);
    }
    this.dirty.clear();
    if (this.accountsDirty) { this.#writeJson(this.accountsFile, this.accounts); this.accountsDirty = false; }
  }

  allPlayerNames() {
    return Object.values(this.accounts).map(a => ({ id: a.id, username: a.username }));
  }
}
