// Reads the game content from content/ and merges optional server overrides from <DATA_DIR>/content/.
//
// Layout: every entry of a collection is its own file, named after its id — e.g.
// content/abilities/warrior/heroic_strike.json is the ability "heroic_strike". Subfolders are only for
// tidiness (the loader reads them recursively). Files starting with "_" are not entries: "_settings.json"
// holds the non-collection data of a system (tables, formulas, rules). See CONTENT.md.
//
// Overrides (survive "update"): the same layout under data/content/. An entry file there is merged into
// the entry with the same id (or adds a new one); a file containing just  null  removes the entry.
// A whole-system file like data/content/config.json or data/content/items.json is merged too.
// Merge rules: objects merge key by key, lists and values replace, null removes a key,
// an object with "$replace": true replaces instead of merging.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONTENT_DIR = path.join(ROOT, 'content');

// system → settings file (relative to content/)
export const SETTINGS_FILES = {
  config: 'config.json', items: 'items/_settings.json', enemies: 'enemies/_settings.json', zones: 'zones/_settings.json',
  legendaries: 'legendaries/_settings.json', skilltree: 'skilltree/_settings.json', town: 'town/_settings.json',
  expeditions: 'expeditions/_settings.json', quests: 'quests/_settings.json', rifts: 'rifts/_settings.json',
  gems: 'gems/_settings.json', bestiary: 'bestiary.json', lootfilter: 'lootfilter/_settings.json', bots: 'bots/_settings.json',
  tutorial: 'tutorial.json',
};
// [system, key] ← folder with one file per entry
export const COLLECTIONS = [
  ['classes', 'classes', 'classes'],
  ['classes', 'traits', 'traits'],
  ['abilities', 'abilities', 'abilities'],
  ['statuses', 'statuses', 'statuses'],
  ['items', 'bases', 'items'],
  ['enemies', 'enemies', 'enemies'],
  ['zones', 'zones', 'zones'],
  ['zones', 'coopEncounters', 'coop'],
  ['legendaries', 'uniques', 'legendaries/uniques'],
  ['legendaries', 'sets', 'legendaries/sets'],
  ['skilltree', 'specs', 'skilltree'],
  ['town', 'materials', 'town/materials'],
  ['town', 'professions', 'town/professions'],
  ['town', 'buildings', 'town/buildings'],
  ['town', 'qualities', 'town/qualities'],
  ['town', 'elixirs', 'town/elixirs'],
  ['expeditions', 'expeditions', 'expeditions'],
  ['achievements', 'achievements', 'achievements'],
  ['quests', 'types', 'quests'],
  ['rifts', 'affixes', 'rifts/affixes'],
  ['gems', 'kinds', 'gems'],
  ['lootfilter', 'presets', 'lootfilter'],
  ['bots', 'archetypes', 'bots'],
  ['minions', 'minions', 'minions'],
];
export const SYSTEMS = [...new Set([...Object.keys(SETTINGS_FILES), ...COLLECTIONS.map(c => c[0])])];
// kept for tools that list the systems
export const CONTENT_FILES = SYSTEMS;

export function overrideDir() {
  return path.join(path.resolve(ROOT, process.env.DATA_DIR || 'data'), 'content');
}

// "$replace": true in an override object replaces that object instead of merging into it
// (used by the admin content editor when a value is set to null, which would otherwise mean "remove")
export function deepMerge(base, over) {
  if (over && typeof over === 'object' && !Array.isArray(over) && over.$replace) { const { $replace, ...rest } = over; return rest; }
  if (over === null || typeof over !== 'object' || Array.isArray(over) || base === null || typeof base !== 'object' || Array.isArray(base)) return over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === null) delete out[k];
    else out[k] = k in base ? deepMerge(base[k], v) : v;
  }
  return out;
}

const shown = file => (file.startsWith(ROOT) ? path.relative(ROOT, file) : file);

function readJson(file) {
  const text = fs.readFileSync(file, 'utf8');
  try { return JSON.parse(text); } catch (e) {
    const m = /position (\d+)/.exec(e.message);
    const line = m ? text.slice(0, Number(m[1])).split('\n').length : null;
    throw new Error(`${shown(file)}${line ? ` (line ${line})` : ''}: invalid JSON — ${e.message}`);
  }
}

// all entry files of a collection folder (recursive, skipping "_" files and README etc.)
export function entryFiles(dir) {
  const out = [];
  const walk = d => {
    let list = [];
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    list.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of list) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.json') && !e.name.startsWith('_')) out.push(full);
    }
  };
  walk(dir);
  return out;
}

const stripAbout = v => { if (v && typeof v === 'object' && !Array.isArray(v)) delete v._about; return v; };

function readCollection(dir, { allowNull = false } = {}) {
  const entries = new Map();
  for (const file of entryFiles(dir)) {
    const id = path.basename(file, '.json');
    if (!/^[a-z0-9_]+$/i.test(id)) throw new Error(`${shown(file)}: file names must be ids (letters, digits, _)`);
    if (entries.has(id)) throw new Error(`${shown(file)}: the id "${id}" is used twice (also ${shown(entries.get(id).file)})`);
    const data = stripAbout(readJson(file));
    if (data === null && !allowNull) throw new Error(`${shown(file)}: is empty (null)`);
    if (data !== null && (typeof data !== 'object' || Array.isArray(data))) throw new Error(`${shown(file)}: must contain an object { … }`);
    entries.set(id, { file, data });
  }
  return entries;
}

// entries are ordered by their "order" field, then by id
function sortEntries(obj) {
  const list = Object.entries(obj).sort(([ia, a], [ib, b]) => (a.order ?? Infinity) - (b.order ?? Infinity) || ia.localeCompare(ib));
  return Object.fromEntries(list);
}

export function loadContentFromDisk({ overrides: useOverrides = true } = {}) {
  const content = {};
  const files = {};       // "system.key.id" or "system" → file (for error messages)
  const overrides = [];
  const odir = overrideDir();
  for (const s of SYSTEMS) content[s] = {};

  // base settings
  for (const [system, rel] of Object.entries(SETTINGS_FILES)) {
    const file = path.join(CONTENT_DIR, rel);
    if (!fs.existsSync(file)) throw new Error(`Missing content file content/${rel}`);
    content[system] = { ...stripAbout(readJson(file)), ...content[system] };
    files[system] = shown(file);
  }
  // base collections
  for (const [system, key, rel] of COLLECTIONS) {
    const dir = path.join(CONTENT_DIR, rel);
    if (!fs.existsSync(dir)) throw new Error(`Missing content folder content/${rel}/`);
    const obj = {};
    for (const [id, { file, data }] of readCollection(dir)) { obj[id] = data; files[`${system}.${key}.${id}`] = shown(file); }
    content[system][key] = obj;
  }

  // overrides
  if (useOverrides && fs.existsSync(odir)) {
    for (const [system, rel] of Object.entries(SETTINGS_FILES)) {
      const file = path.join(odir, rel);
      if (fs.existsSync(file)) { content[system] = deepMerge(content[system], stripAbout(readJson(file))); overrides.push(rel); }
    }
    for (const [system, key, rel] of COLLECTIONS) {
      const dir = path.join(odir, rel);
      if (!fs.existsSync(dir)) continue;
      for (const [id, { file, data }] of readCollection(dir, { allowNull: true })) {
        const coll = content[system][key];
        if (data === null) delete coll[id];
        else { coll[id] = id in coll ? deepMerge(coll[id], data) : deepMerge(undefined, data); files[`${system}.${key}.${id}`] = shown(file); }
        overrides.push(path.relative(odir, file));
      }
    }
    // whole-system files, e.g. data/content/items.json = { "bases": { … }, "naming": { … } }
    for (const system of SYSTEMS) {
      const file = path.join(odir, `${system}.json`);
      if (SETTINGS_FILES[system] === `${system}.json` || !fs.existsSync(file)) continue;
      content[system] = deepMerge(content[system], stripAbout(readJson(file)));
      overrides.push(`${system}.json`);
    }
  }
  for (const [system, key] of COLLECTIONS) content[system][key] = sortEntries(content[system][key] || {});

  const hash = crypto.createHash('sha1').update(JSON.stringify(content)).digest('hex').slice(0, 12);
  Object.defineProperty(content, '_meta', { value: { hash, overrides, overrideDir: odir, files }, enumerable: false, configurable: true });
  return content;
}
