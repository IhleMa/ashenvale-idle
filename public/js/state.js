// Client-side state container and a tiny event bus.
export const bus = {
  handlers: new Map(),
  on(ev, fn) { if (!this.handlers.has(ev)) this.handlers.set(ev, new Set()); this.handlers.get(ev).add(fn); return () => this.handlers.get(ev).delete(fn); },
  emit(ev, data) { for (const fn of this.handlers.get(ev) || []) { try { fn(data); } catch (e) { console.error(e); } } },
};

export const state = {
  player: null,       // full player data from the server
  group: null,
  invites: [],
  online: [],
  connection: 'offline',
  battles: { solo: null, coop: null }, // live battle snapshots (kept up to date by combat view)
  lastResults: { solo: null, coop: null },
  selectedCharId: null,
};

export function hero() { return state.player?.heroId ? state.player.characters[state.player.heroId] : null; }
export function chars() {
  const p = state.player;
  if (!p) return [];
  return Object.values(p.characters).sort((a, b) => (b.isMain - a.isMain) || b.level - a.level || a.name.localeCompare(b.name));
}
export function selectedChar() {
  const p = state.player;
  if (!p) return null;
  return p.characters[state.selectedCharId] || hero();
}
