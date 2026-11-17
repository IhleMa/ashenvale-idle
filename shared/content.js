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

// helpers for derived values that must be refreshed on live reload
export const refillArray = (arr, list) => { arr.length = 0; arr.push(...list); return arr; };
export const refillObject = (obj, src) => { for (const k of Object.keys(obj)) delete obj[k]; Object.assign(obj, src); return obj; };

// collections keyed by id also carry their id inside each entry
export function withIds(obj) {
  for (const [id, v] of Object.entries(obj || {})) if (v && typeof v === 'object') v.id = id;
  return obj;
}

// ---------------------------------------------------------------- live reload (server)
// The admin content editor changes content while the server runs. replaceContent() updates CONTENT in
// place — every object keeps its identity, so modules holding references see the new data — and then
// runs the refresh hooks that recompute derived values (id lists, lookup tables, caches).
const reloadHooks = [];
export function onContentReload(fn) { reloadHooks.push(fn); }

const isPlain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function syncInPlace(target, src) {
  if (Array.isArray(target) && Array.isArray(src)) {
    target.length = 0;
    for (const v of src) target.push(v);
    return target;
  }
  for (const k of Object.keys(target)) if (!(k in src)) delete target[k];
  for (const [k, v] of Object.entries(src)) {
    const cur = target[k];
    if ((isPlain(cur) && isPlain(v)) || (Array.isArray(cur) && Array.isArray(v))) syncInPlace(cur, v);
    else target[k] = v;
  }
  return target;
}

export function replaceContent(fresh) {
  // collections whose entries carry their id (set by withIds in the data modules) keep doing so
  const hadIds = [];
  for (const [system, sys] of Object.entries(content)) {
    if (!isPlain(sys)) continue;
    for (const [k, coll] of Object.entries(sys)) {
      if (isPlain(coll) && Object.entries(coll).some(([id, v]) => isPlain(v) && v.id === id)) hadIds.push([system, k]);
    }
  }
  // keep the key order of fresh collections (it is the display order)
  for (const system of Object.keys(fresh)) {
    if (!isPlain(content[system])) content[system] = {};
    syncInPlace(content[system], fresh[system]);
    for (const [k, v] of Object.entries(fresh[system])) {
      if (isPlain(v) && isPlain(content[system][k])) {
        const obj = content[system][k];
        const entries = Object.keys(v).map(id => [id, obj[id]]);
        for (const id of Object.keys(obj)) delete obj[id];
        for (const [id, val] of entries) obj[id] = val;
      }
    }
  }
  for (const [system, k] of hadIds) if (isPlain(content[system]?.[k])) withIds(content[system][k]);
  if (fresh._meta) Object.defineProperty(content, '_meta', { value: fresh._meta, enumerable: false, configurable: true });
  for (const fn of reloadHooks) fn();
}
