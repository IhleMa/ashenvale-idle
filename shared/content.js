// Game content (items, classes, abilities, enemies, zones, …) lives in content/*.json.
// On the server it is read from disk (plus overrides in data/content/); in the browser it is
// fetched once from /api/content. Every shared/data module reads from CONTENT, so all game code
// sees exactly the same data on both sides.
let content;
if (typeof window === 'undefined' && typeof process !== 'undefined' && process.versions?.node) {
  const { loadContentFromDisk } = await import('../server/content-loader.js');
  content = loadContentFromDisk();
} else {
  const res = await fetch('/api/content', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load game content (${res.status})`);
  content = await res.json();
}
export const CONTENT = content;

// collections keyed by id also carry their id inside each entry
export function withIds(obj) {
  for (const [id, v] of Object.entries(obj || {})) if (v && typeof v === 'object') v.id = id;
  return obj;
}
