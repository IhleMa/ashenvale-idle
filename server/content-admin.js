// Content editor backend (admin panel → 📦 Content).
//
// Edits never touch content/ (that folder belongs to the git checkout and is replaced by "update").
// Every change is written as an override file under data/content/ — the same mechanism server owners
// can use by hand (see CONTENT.md):
//   * editing an original entry writes only the fields that differ from the original
//   * a new entry is written in full
//   * removing an original entry writes a file containing  null ; removing a new entry deletes its file
//   * "reset" deletes the override, bringing the original back
// After each change the whole content is re-read and validated. If anything is wrong the change is rolled
// back and the errors are returned; otherwise the running server switches to the new content at once.
import fs from 'node:fs';
import path from 'node:path';
import { loadContentFromDisk, COLLECTIONS, SETTINGS_FILES, CONTENT_DIR, ROOT, overrideDir, entryFiles } from './content-loader.js';
import { validateContent } from './content-check.js';
import { pretty } from '../tools/jsonfmt.js';

// what each folder is called in the editor
export const TYPE_INFO = {
  classes: { label: 'Classes', icon: '🛡', group: 'Characters' },
  traits: { label: 'Traits', icon: '✨', group: 'Characters' },
  abilities: { label: 'Abilities', icon: '⚔', group: 'Characters' },
  skilltree: { label: 'Skill tree specs', icon: '🌳', group: 'Characters' },
  minions: { label: 'Minions', icon: '☠', group: 'Characters' },
  subclasses: { label: 'Subclasses (ascension)', icon: '🌟', group: 'Characters' },
  statuses: { label: 'Statuses', icon: '💫', group: 'Characters' },
  items: { label: 'Item bases', icon: '🗡', group: 'Items' },
  'legendaries/uniques': { label: 'Uniques', icon: '🟧', group: 'Items' },
  'legendaries/sets': { label: 'Sets', icon: '🟩', group: 'Items' },
  gems: { label: 'Gems', icon: '💎', group: 'Items' },
  lootfilter: { label: 'Loot filter presets', icon: '🧹', group: 'Items' },
  enemies: { label: 'Enemies', icon: '👹', group: 'World' },
  zones: { label: 'Zones', icon: '🗺', group: 'World' },
  coop: { label: 'Co-op encounters', icon: '🤝', group: 'World' },
  'rifts/affixes': { label: 'Rift affixes', icon: '🌀', group: 'World' },
  expeditions: { label: 'Expeditions', icon: '🧭', group: 'World' },
  'town/buildings': { label: 'Buildings', icon: '🏛', group: 'Town' },
  'town/professions': { label: 'Professions', icon: '⚒', group: 'Town' },
  'town/materials': { label: 'Materials', icon: '🪨', group: 'Town' },
  'town/qualities': { label: 'Craft qualities', icon: '⭐', group: 'Town' },
  'town/elixirs': { label: 'Elixirs', icon: '🧪', group: 'Town' },
  quests: { label: 'Quest types', icon: '📜', group: 'Progress' },
  achievements: { label: 'Achievements', icon: '🏆', group: 'Progress' },
  'cosmetics/name_colors': { label: 'Name colours', icon: '🎨', group: 'Cosmetics' },
  'cosmetics/titles': { label: 'Titles', icon: '🏷', group: 'Cosmetics' },
  'cosmetics/frames': { label: 'Portrait frames', icon: '🖼', group: 'Cosmetics' },
  bots: { label: 'Bot archetypes', icon: '🤖', group: 'Other' },
  settings: { label: 'Settings & tables', icon: '⚙', group: 'Other' },
};
const SETTINGS_LABELS = {
  config: 'Game config (rarities, combat, XP, premium …)', items: 'Items (affixes, slots, naming …)', enemies: 'Enemies (defaults, scaling)',
  zones: 'Zones (general)', legendaries: 'Uniques & sets (drop rates)', skilltree: 'Skill tree (layout, costs)', town: 'Town (costs, formulas)',
  expeditions: 'Expeditions (camp)', quests: 'Quests (counts, rewards)', rifts: 'Rifts (scaling, rewards)', gems: 'Gems (tiers, costs)',
  bestiary: 'Bestiary (mastery, tips)', lootfilter: 'Loot filter (limits)', bots: 'Bots (names, chat)',
  tutorial: 'Tutorial (steps, rewards)', patchnotes: 'Patch notes (shown to players)',
};

const isPlain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const UNCHANGED = Symbol('unchanged');
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// The smallest override that turns `base` into `edited` when merged with deepMerge.
export function makeOverride(base, edited) {
  if (!isPlain(base) || !isPlain(edited)) return same(base, edited) ? UNCHANGED : edited;
  // null values can't be expressed as a merge (null means "remove the key"), so replace the object
  if (Object.entries(edited).some(([k, v]) => v === null && base[k] !== null)) return same(base, edited) ? UNCHANGED : { $replace: true, ...edited };
  const out = {};
  for (const [k, v] of Object.entries(edited)) {
    if (!(k in base)) { out[k] = v; continue; }
    const d = makeOverride(base[k], v);
    if (d !== UNCHANGED) out[k] = d;
  }
  for (const k of Object.keys(base)) if (!(k in edited)) out[k] = null;
  return Object.keys(out).length ? out : UNCHANGED;
}

export class ContentError extends Error {
  constructor(message, errors = []) { super(message); this.errors = errors; }
}

export class ContentManager {
  // apply(fresh) is called after a successful change with the new content (the server switches to it)
  constructor({ apply = () => {}, usage = null } = {}) {
    this.apply = apply;
    this.usage = usage; // (id) → number of player saves mentioning the id (optional)
    this.types = {};
    for (const [system, key, dir] of COLLECTIONS) this.types[dir] = { kind: 'collection', system, key, dir, ...(TYPE_INFO[dir] || { label: dir, icon: '📄', group: 'Other' }) };
    this.types.settings = { kind: 'settings', dir: 'settings', ...TYPE_INFO.settings };
    this.refresh();
  }

  refresh() {
    this.base = loadContentFromDisk({ overrides: false });
    this.effective = loadContentFromDisk();
  }

  type(t) {
    const T = this.types[t];
    if (!T) throw new ContentError(`Unknown content type "${t}"`);
    return T;
  }

  // non-collection data of a system (what its _settings.json holds)
  settingsOf(content, system) {
    const keys = new Set(COLLECTIONS.filter(c => c[0] === system).map(c => c[1]));
    return Object.fromEntries(Object.entries(content[system] || {}).filter(([k]) => !keys.has(k)));
  }

  collection(content, T) { return T.kind === 'settings' ? Object.fromEntries(Object.keys(SETTINGS_FILES).map(s => [s, this.settingsOf(content, s)])) : content[T.system][T.key] || {}; }

  // ---------------------------------------------------------------- files
  overrideFile(T, id) {
    const odir = overrideDir();
    if (T.kind === 'settings') return path.join(odir, SETTINGS_FILES[id]);
    const dir = path.join(odir, T.dir);
    return entryFiles(dir).find(f => path.basename(f, '.json') === id) || null;
  }
  baseFile(T, id) {
    if (T.kind === 'settings') return path.join(CONTENT_DIR, SETTINGS_FILES[id]);
    return entryFiles(path.join(CONTENT_DIR, T.dir)).find(f => path.basename(f, '.json') === id) || null;
  }
  // where a new override for this entry goes: mirror the original's subfolder (abilities/warrior/…)
  newOverridePath(T, id, like = null) {
    const odir = overrideDir();
    if (T.kind === 'settings') return path.join(odir, SETTINGS_FILES[id]);
    const src = this.baseFile(T, id) || (like && (this.overrideFile(T, like) || this.baseFile(T, like)));
    let sub = '';
    if (src) {
      const rel = path.relative(path.join(src.startsWith(odir) ? odir : CONTENT_DIR, T.dir), path.dirname(src));
      if (rel && !rel.startsWith('..')) sub = rel;
    }
    return path.join(odir, T.dir, sub, `${id}.json`);
  }
  // whole-system override files (data/content/items.json …) also change entries
  systemOverride(system) {
    if (SETTINGS_FILES[system] === `${system}.json`) return null;
    const f = path.join(overrideDir(), `${system}.json`);
    return fs.existsSync(f) ? f : null;
  }

  // ---------------------------------------------------------------- reading
  index() {
    this.refresh();
    const types = Object.entries(this.types).map(([id, T]) => {
      const base = this.collection(this.base, T), eff = this.collection(this.effective, T);
      const ids = new Set([...Object.keys(base), ...Object.keys(eff)]);
      let changed = 0;
      for (const i of ids) if (this.statusOf(T, i, base, eff) !== 'original') changed++;
      return { id, label: T.label, icon: T.icon, group: T.group, system: T.system || null, key: T.key || null, count: Object.keys(eff).length, changed };
    });
    return { types, overrideDir: shownPath(overrideDir()), hash: this.effective._meta.hash };
  }

  statusOf(T, id, base = this.collection(this.base, T), eff = this.collection(this.effective, T)) {
    if (!(id in base)) return id in eff ? 'custom' : 'missing';
    if (!(id in eff)) return 'removed';
    return same(base[id], eff[id]) ? 'original' : 'modified';
  }

  list(t) {
    const T = this.type(t);
    const base = this.collection(this.base, T), eff = this.collection(this.effective, T);
    const out = [];
    const seen = new Set();
    for (const id of [...Object.keys(eff), ...Object.keys(base)]) {
      if (seen.has(id)) continue;
      seen.add(id);
      const e = eff[id] || base[id];
      const file = this.baseFile(T, id) || this.overrideFile(T, id);
      const rel = file && T.kind === 'collection' ? path.relative(path.join(file.startsWith(CONTENT_DIR) ? CONTENT_DIR : overrideDir(), T.dir), path.dirname(file)) : '';
      out.push({
        id, status: this.statusOf(T, id, base, eff),
        name: T.kind === 'settings' ? SETTINGS_LABELS[id] || id : String(e?.name ?? e?.label ?? e?.title ?? id),
        group: rel && !rel.startsWith('..') ? rel : '',
        glyph: e?.glyph || e?.icon || '',
      });
    }
    return { type: t, entries: out };
  }

  get(t, id) {
    const T = this.type(t);
    const base = this.collection(this.base, T), eff = this.collection(this.effective, T);
    if (!(id in base) && !(id in eff)) throw new ContentError(`No ${T.label} entry "${id}"`);
    const of = this.overrideFile(T, id);
    let override;
    if (of && fs.existsSync(of)) { try { override = JSON.parse(fs.readFileSync(of, 'utf8')); } catch { override = '(unreadable)'; } }
    const systemFile = this.systemOverride(T.kind === 'settings' ? id : T.system);
    return {
      type: t, id, status: this.statusOf(T, id, base, eff),
      data: clone(eff[id] ?? base[id]), base: clone(base[id] ?? null),
      override: override === undefined ? null : override, hasOverride: override !== undefined,
      file: shownPath(this.baseFile(T, id) || of), overrideFile: of && override !== undefined ? shownPath(of) : null,
      systemOverride: systemFile ? shownPath(systemFile) : null,
    };
  }

  // ---------------------------------------------------------------- writing
  // Runs fn (which writes/deletes override files), then reloads + validates; rolls back on errors.
  change(T, id, fn) {
    const touched = new Map(); // file → previous text (null = did not exist)
    const write = (file, value) => {
      if (!touched.has(file)) touched.set(file, fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, (value === null ? 'null' : pretty(value)) + '\n');
    };
    const remove = file => {
      if (!file || !fs.existsSync(file)) return;
      if (!touched.has(file)) touched.set(file, fs.readFileSync(file, 'utf8'));
      fs.unlinkSync(file);
      tidy(file);
    };
    const rollback = () => {
      for (const [file, text] of touched) {
        if (text === null) { try { fs.unlinkSync(file); } catch { /* gone */ } tidy(file); } else { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
      }
    };
    try {
      fn({ write, remove });
      const fresh = loadContentFromDisk();
      const { errors, warnings } = validateContent(fresh);
      if (errors.length) { rollback(); throw new ContentError(`The change was not saved — it would break the game content (${errors.length} problem${errors.length > 1 ? 's' : ''}).`, errors); }
      this.effective = fresh;
      this.apply(fresh);
      return { warnings, hash: fresh._meta.hash, files: [...touched.keys()].map(shownPath) };
    } catch (e) {
      if (e instanceof ContentError) throw e;
      rollback();
      throw new ContentError(`The change was not saved: ${e.message}`);
    }
  }

  save(t, id, data) {
    const T = this.type(t);
    if (!isPlain(data)) throw new ContentError('The entry must be an object { … }');
    data = clone(data);
    delete data.id; delete data.$replace;
    const base = this.collection(this.base, T)[id];
    const eff = this.collection(this.effective, T);
    if (T.kind === 'settings' && !(id in SETTINGS_FILES)) throw new ContentError(`Unknown settings "${id}"`);
    if (T.kind === 'collection' && !(id in eff) && base === undefined) throw new ContentError(`No ${T.label} entry "${id}" — create it first`);
    if (T.kind === 'settings') {
      // collections of the system can't be changed from here
      const keys = COLLECTIONS.filter(c => c[0] === id).map(c => c[1]);
      for (const k of keys) delete data[k];
    }
    const res = this.change(T, id, ({ write, remove }) => {
      const existing = this.overrideFile(T, id);
      if (base === undefined) return write(existing || this.newOverridePath(T, id), data);
      const over = makeOverride(T.kind === 'settings' ? this.settingsOf(this.base, id) : base, data);
      if (over === UNCHANGED) return remove(existing && fs.existsSync(existing) ? existing : null);
      write(existing && fs.existsSync(existing) ? existing : this.newOverridePath(T, id), over);
    });
    const now = this.collection(this.effective, T)[id];
    if (!same(stripIds(now), data)) res.warnings = [...res.warnings, `Another override file (${shownPath(this.systemOverride(T.kind === 'settings' ? id : T.system) || overrideDir())}) also changes this entry, so the result differs from what you saved.`];
    return { ...res, entry: this.get(t, id) };
  }

  create(t, id, { from = null, data = null } = {}) {
    const T = this.type(t);
    if (T.kind === 'settings') throw new ContentError('Settings can only be edited');
    id = String(id || '').trim();
    if (!/^[a-z0-9_]+$/.test(id)) throw new ContentError('Ids may only use lowercase letters, digits and _ (e.g. frost_golem)');
    const eff = this.collection(this.effective, T), base = this.collection(this.base, T);
    if (id in eff) throw new ContentError(`"${id}" already exists`);
    if (from && !(from in eff)) throw new ContentError(`Can't copy "${from}" — it does not exist`);
    let entry = data && isPlain(data) ? clone(data) : clone(from ? eff[from] : {});
    delete entry.id;
    if (from && typeof entry.name === 'string' && !data) entry.name = `${entry.name} (copy)`;
    if (from && typeof entry.order === 'number' && !data) entry.order += 1;
    const extra = [];
    const res = this.change(T, id, ({ write, remove }) => {
      const existing = this.overrideFile(T, id);
      if (id in base) { // re-creating a removed original: just drop the removal (then apply differences)
        const over = makeOverride(base[id], entry);
        if (over === UNCHANGED) remove(existing);
        else write(existing || this.newOverridePath(T, id), over);
      } else write(existing || this.newOverridePath(T, id, from), entry);
      // a class only works with its own abilities and skill tree: copy those along
      if (T.dir === 'classes' && from && !data) extra.push(...this.copyClassKit(from, id, write));
    });
    return { ...res, created: extra, entry: this.get(t, id) };
  }

  // copies the abilities (as <newId>_<ability>) and the skill tree spec of a class for a new class
  copyClassKit(from, id, write) {
    const odir = overrideDir();
    const abilities = this.effective.abilities.abilities;
    const made = [];
    const rename = {};
    for (const [aid, a] of Object.entries(abilities)) {
      if (a.classId !== from || a.subclass) continue; // subclasses (and their abilities) stay with the original class
      const nid = `${id}_${aid}`;
      if (nid in abilities) throw new ContentError(`Can't copy the abilities: "${nid}" already exists`);
      rename[aid] = nid;
      write(path.join(odir, 'abilities', id, `${nid}.json`), { ...clone(a), classId: id });
      made.push(`abilities/${nid}`);
    }
    const spec = this.effective.skilltree.specs[from];
    if (spec && !this.effective.skilltree.specs[id]) {
      // point every ability reference in the tree at the copies
      const fix = v => (typeof v === 'string' && rename[v] ? rename[v] : Array.isArray(v) ? v.map(fix) : isPlain(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fix(x)])) : v);
      write(path.join(odir, 'skilltree', `${id}.json`), fix(clone(spec)));
      made.push(`skilltree/${id}`);
    }
    return made;
  }

  // entries that belong to a class and go away with it
  classKit(id) {
    return [
      ...Object.entries(this.effective.abilities.abilities).filter(([, a]) => a.classId === id).map(([aid]) => [this.types.abilities, aid]),
      ...(this.effective.skilltree.specs[id] ? [[this.types.skilltree, id]] : []),
    ];
  }

  delete(t, id, { force = false } = {}) {
    const T = this.type(t);
    if (T.kind === 'settings') throw new ContentError('Settings can\'t be removed — use "Reset to original" instead');
    const eff = this.collection(this.effective, T), base = this.collection(this.base, T);
    if (!(id in eff)) throw new ContentError(`"${id}" is not active`);
    if (!force && this.usage) {
      const n = this.usage(id);
      if (n) return { needsConfirm: true, usage: n };
    }
    const targets = [[T, id], ...(T.dir === 'classes' ? this.classKit(id) : [])];
    const res = this.change(T, id, ({ write, remove }) => {
      for (const [TT, tid] of targets) {
        const existing = this.overrideFile(TT, tid);
        if (tid in this.collection(this.base, TT)) write(existing || this.newOverridePath(TT, tid), null);
        else remove(existing);
      }
    });
    return { ...res, removed: true, also: targets.slice(1).map(([TT, tid]) => `${TT.dir}/${tid}`), status: this.statusOf(T, id) };
  }

  reset(t, id) {
    const T = this.type(t);
    const of = this.overrideFile(T, id);
    if (!of || !fs.existsSync(of)) throw new ContentError('This entry has no changes to reset');
    const res = this.change(T, id, ({ remove }) => remove(of));
    const exists = id in this.collection(this.effective, T) || id in this.collection(this.base, T);
    return { ...res, entry: exists ? this.get(t, id) : null };
  }
}

// remove folders that became empty (abilities/<class>/ …), never above data/content/
function tidy(file) {
  const odir = overrideDir();
  for (let d = path.dirname(file); d.startsWith(odir + path.sep); d = path.dirname(d)) { try { fs.rmdirSync(d); } catch { break; } }
}
const stripIds = v => { if (!isPlain(v)) return v; const { id, ...rest } = v; return rest; };
function shownPath(file) {
  if (!file) return null;
  return file.startsWith(ROOT + path.sep) ? path.relative(ROOT, file) : file;
}
