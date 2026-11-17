// Reads the game content (content/*.json) and merges optional server overrides from
// <DATA_DIR>/content/*.json on top. Overrides survive "update" (git pull), so server owners can
// tweak content without touching the repository files.
//
// Override rules: objects are merged key by key, arrays and plain values replace, and a value of
// null removes the key (e.g. { "items": { "bases": { "dagger": null } } } removes the dagger).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONTENT_DIR = path.join(ROOT, 'content');
export const CONTENT_FILES = ['config', 'classes', 'abilities', 'statuses', 'items', 'enemies', 'zones', 'legendaries', 'skilltree',
  'town', 'expeditions', 'achievements', 'quests', 'rifts', 'gems', 'bestiary', 'lootfilter', 'bots'];

export function overrideDir() {
  return path.join(path.resolve(ROOT, process.env.DATA_DIR || 'data'), 'content');
}

export function deepMerge(base, over) {
  if (over === null || typeof over !== 'object' || Array.isArray(over) || base === null || typeof base !== 'object' || Array.isArray(base)) return over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === null) delete out[k];
    else out[k] = k in base ? deepMerge(base[k], v) : v;
  }
  return out;
}

function readJson(file) {
  const text = fs.readFileSync(file, 'utf8');
  try { return JSON.parse(text); } catch (e) {
    // point at the line of the syntax error
    const m = /position (\d+)/.exec(e.message);
    const line = m ? text.slice(0, Number(m[1])).split('\n').length : null;
    const shown = file.startsWith(ROOT) ? path.relative(ROOT, file) : file;
    throw new Error(`${shown}${line ? ` (line ${line})` : ''}: invalid JSON — ${e.message}`);
  }
}

export function loadContentFromDisk() {
  const content = {};
  const overrides = [];
  const odir = overrideDir();
  for (const name of CONTENT_FILES) {
    const base = path.join(CONTENT_DIR, `${name}.json`);
    if (!fs.existsSync(base)) throw new Error(`Missing content file content/${name}.json`);
    let data = readJson(base);
    const over = path.join(odir, `${name}.json`);
    if (fs.existsSync(over)) { data = deepMerge(data, readJson(over)); overrides.push(`${name}.json`); }
    delete data._about; // documentation only
    content[name] = data;
  }
  const hash = crypto.createHash('sha1').update(JSON.stringify(content)).digest('hex').slice(0, 12);
  Object.defineProperty(content, '_meta', { value: { hash, overrides, overrideDir: odir }, enumerable: false });
  return content;
}
