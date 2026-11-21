// Player suggestions (💡 in the top bar): stored in the database, read and answered in the admin panel.
import crypto from 'node:crypto';

export const SUGGESTION_CATEGORIES = { feature: 'Feature idea', balance: 'Balance', bug: 'Bug report', ui: 'Interface', other: 'Other' };
export const SUGGESTION_STATUSES = { new: 'New', read: 'Read', planned: 'Planned', done: 'Done', declined: 'Declined' };
const LIMITS = { min: 10, max: 1500, perDay: 5, keep: 2000 };

export class Suggestions {
  constructor(store) {
    this.store = store;
    this.list = store.getDoc('suggestions', []);
  }
  save() { this.store.putDoc('suggestions', this.list); }

  add(player, { category, text }) {
    const body = String(text || '').trim().replace(/\r\n/g, '\n');
    if (body.length < LIMITS.min) throw new Error(`Please write at least ${LIMITS.min} characters`);
    if (body.length > LIMITS.max) throw new Error(`Please keep it under ${LIMITS.max} characters`);
    const since = Date.now() - 86400000;
    if (this.list.filter(s => s.playerId === player.id && s.at > since).length >= LIMITS.perDay) throw new Error(`You can send ${LIMITS.perDay} suggestions per day — thank you for all the ideas!`);
    const s = {
      id: crypto.randomBytes(5).toString('hex'), at: Date.now(), playerId: player.id, name: player.name,
      category: SUGGESTION_CATEGORIES[category] ? category : 'other', text: body, status: 'new', reply: '',
    };
    this.list.push(s);
    if (this.list.length > LIMITS.keep) this.list = this.list.slice(-LIMITS.keep);
    this.save();
    return s;
  }
  mine(playerId) { return this.list.filter(s => s.playerId === playerId).sort((a, b) => b.at - a.at).slice(0, 30); }
  all() { return [...this.list].sort((a, b) => b.at - a.at); }
  counts() { const c = {}; for (const s of this.list) c[s.status] = (c[s.status] || 0) + 1; return c; }
  update(id, { status, reply }) {
    const s = this.list.find(x => x.id === id);
    if (!s) return null;
    if (status && SUGGESTION_STATUSES[status]) s.status = status;
    if (reply !== undefined) s.reply = String(reply).slice(0, 500);
    s.updatedAt = Date.now();
    this.save();
    return s;
  }
  remove(id) {
    const n = this.list.length;
    this.list = this.list.filter(s => s.id !== id);
    if (n !== this.list.length) this.save();
    return n !== this.list.length;
  }
}
