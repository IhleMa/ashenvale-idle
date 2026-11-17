// Persistent server announcements: stored in the database so players who were offline see them when they come back.
import crypto from 'node:crypto';

export class Announcements {
  constructor(store) {
    this.store = store;
    this.list = store.getDoc('announcements', []);
  }

  save() { this.store.putDoc('announcements', this.list); this.store.flush(); }

  // hours: how long it stays visible to returning players (0 = until deleted)
  add({ text, from, hours = 168 }) {
    const now = Date.now();
    const a = { id: crypto.randomBytes(5).toString('hex'), text: String(text).slice(0, 500), from, at: now, expiresAt: hours > 0 ? now + hours * 3600000 : null };
    this.list.push(a);
    this.prune();
    this.save();
    return a;
  }

  remove(id) {
    const before = this.list.length;
    this.list = this.list.filter(a => a.id !== id);
    if (this.list.length !== before) this.save();
    return before !== this.list.length;
  }

  prune() {
    const now = Date.now();
    this.list = this.list.filter(a => !a.expiresAt || a.expiresAt > now).slice(-100);
  }

  active() {
    const now = Date.now();
    return this.list.filter(a => !a.expiresAt || a.expiresAt > now).sort((a, b) => b.at - a.at);
  }

  // Announcements the player hasn't acknowledged yet
  unseenFor(p) {
    const seen = p.announcementsSeenAt || 0;
    return this.active().filter(a => a.at > seen);
  }
}
