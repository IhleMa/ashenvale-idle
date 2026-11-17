// Admin panel → 📦 Content: browse, edit, create and remove game content while the server runs.
// Changes are saved by the server as override files in data/content/ (content/ itself is never touched),
// validated, and applied live for everyone. See server/content-admin.js.
import { act } from '../net.js';
import { bus } from '../state.js';
import { esc, toast, modal, confirmBox } from '../ui.js';
import { CONTENT } from '/shared/content.js';

const S = {
  index: null, type: null, list: null, filter: '', onlyChanged: false,
  id: null, entry: null, draft: null, mode: 'form', jsonText: '', jsonError: null,
  problems: null, warnings: null, busy: false, closed: new Set(),
};
let host = null;

const clone = v => JSON.parse(JSON.stringify(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const dirty = () => S.entry && S.draft && !same(S.draft, S.entry.data);
const P = path => esc(JSON.stringify(path));
const STATUS = {
  original: ['Original', 'st-original', 'Unchanged from the game files'],
  modified: ['Modified', 'st-modified', 'Changed on this server (override in data/content/)'],
  custom: ['New', 'st-custom', 'Added on this server'],
  removed: ['Removed', 'st-removed', 'Removed on this server — players don\'t see it'],
};
const badge = s => { const [l, c, t] = STATUS[s] || [s, '', '']; return `<span class="ce-badge ${c}" title="${esc(t)}">${l}</span>`; };

// ---------------------------------------------------------------- data access
function getAt(obj, path) { return path.reduce((o, k) => (o == null ? undefined : o[k]), obj); }
function setAt(obj, path, v) { const parent = getAt(obj, path.slice(0, -1)); parent[path[path.length - 1]] = v; }
function delAt(obj, path) {
  const parent = getAt(obj, path.slice(0, -1)), k = path[path.length - 1];
  if (Array.isArray(parent)) parent.splice(k, 1); else delete parent[k];
}

// ---------------------------------------------------------------- suggestions for reference fields
const ids = o => Object.keys(o || {});
function refLists() {
  const C = CONTENT;
  const abil = ids(C.abilities?.abilities), enemies = ids(C.enemies?.enemies), zones = ids(C.zones?.zones);
  const L = {
    status: ids(C.statuses?.statuses), statuses: ids(C.statuses?.statuses),
    enemyId: enemies, enemy: enemies, enemies, boss: enemies, adds: enemies, spawn: enemies, summon: enemies,
    baseId: ids(C.items?.bases), bases: ids(C.items?.bases), base: ids(C.items?.bases),
    classId: ids(C.classes?.classes), classes: ids(C.classes?.classes), class: ids(C.classes?.classes),
    slot: ids(C.items?.slots), slots: ids(C.items?.slots),
    abilities: abil, ability: abil, abilityId: abil, starting: abil,
    zone: zones, zoneId: zones, zones, unlock: zones, requires: zones,
    profession: ids(C.town?.professions), building: ids(C.town?.buildings),
    material: ids(C.town?.materials), materials: ids(C.town?.materials),
    stat: ids(C.items?.affixes), stats: ids(C.items?.affixes),
    rarity: (C.config?.rarities || []).map(r => r.id), minRarity: (C.config?.rarities || []).map(r => r.id),
    set: ids(C.legendaries?.sets), setId: ids(C.legendaries?.sets), uniqueId: ids(C.legendaries?.uniques),
    trait: ids(C.classes?.traits), traits: ids(C.classes?.traits), affix: ids(C.rifts?.affixes),
  };
  return L;
}
// every string value a key has anywhere in the current type — "kind", "target", "school", "role" …
function valuesByKey(root) {
  const out = new Map();
  const walk = (v, key) => {
    if (typeof v === 'string' && key && v.length < 40) { if (!out.has(key)) out.set(key, new Set()); out.get(key).add(v); }
    else if (Array.isArray(v)) v.forEach(x => walk(x, key));
    else if (isObj(v)) for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(root, null);
  return out;
}
let REFS = {}, SEEN = new Map(), lists = new Map();
function datalistFor(key) {
  const vals = new Set([...(REFS[key] || []), ...(SEEN.get(key) || [])]);
  if (!vals.size || vals.size > 400) return '';
  const id = `ce-dl-${key.replace(/\W/g, '_')}`;
  if (!lists.has(id)) lists.set(id, `<datalist id="${id}">${[...vals].sort().map(v => `<option value="${esc(v)}">`).join('')}</datalist>`);
  return id;
}
function typeCollection() {
  const t = S.index?.types.find(x => x.id === S.type);
  return (t?.system && CONTENT[t.system]?.[t.key]) || {};
}

// ---------------------------------------------------------------- form editor
const LONG_KEYS = /desc|text|tip|flavor|lore|template|message|title/i;
function scalarHtml(path, v, key) {
  const p = P(path);
  if (v === null) {
    return `<span class="ce-null">empty</span><select class="ce-settype" data-settype="${p}"><option value="">set to…</option><option value="string">text</option><option value="number">number</option><option value="boolean">yes / no</option><option value="array">list</option><option value="object">group</option></select>`;
  }
  if (typeof v === 'boolean') return `<label class="switch"><input type="checkbox" data-path="${p}" data-kind="boolean" ${v ? 'checked' : ''}><span></span></label>`;
  if (typeof v === 'number') return `<input class="ce-num" type="number" step="any" data-path="${p}" data-kind="number" value="${v}">`;
  const k = String(key ?? '');
  if (v.length > 70 || v.includes('\n') || (LONG_KEYS.test(k) && v.length > 30)) return `<textarea data-path="${p}" data-kind="string" rows="${Math.min(8, Math.max(2, Math.ceil(v.length / 70)))}">${esc(v)}</textarea>`;
  const dl = datalistFor(k);
  return `<input type="text" data-path="${p}" data-kind="string" value="${esc(v)}" ${dl ? `list="${dl}"` : ''}>`;
}
const isScalar = v => v === null || typeof v !== 'object';
function summaryOf(v) {
  if (!isObj(v)) return '';
  const s = v.name ?? v.label ?? v.id ?? v.kind ?? v.type ?? v.stat ?? v.enemyId ?? v.status ?? v.when ?? '';
  return typeof s === 'string' || typeof s === 'number' ? String(s) : '';
}
function groupHtml(path, v, key, depth, removable) {
  const p = JSON.stringify(path);
  const n = Array.isArray(v) ? `${v.length} item${v.length === 1 ? '' : 's'}` : `${Object.keys(v).length} field${Object.keys(v).length === 1 ? '' : 's'}`;
  const open = !S.closed.has(p);
  return `<details class="ce-group depth-${Math.min(depth, 3)}" data-group="${esc(p)}" ${open ? 'open' : ''}>
    <summary><span class="ce-key">${esc(String(key))}</span> <span class="faint small">${n}</span>${removable ? `<span class="grow"></span><button class="btn tiny ghost danger" data-act="del" data-p="${esc(p)}" title="Remove ${esc(String(key))}">✕</button>` : ''}</summary>
    <div class="ce-group-body">${Array.isArray(v) ? arrayBody(path, v, key, depth) : objectBody(path, v, depth)}</div></details>`;
}
function objectBody(path, obj, depth) {
  const rows = Object.entries(obj).map(([k, v]) => {
    const pp = [...path, k];
    if (!isScalar(v) && !(Array.isArray(v) && v.every(isScalar) && v.length <= 8)) return groupHtml(pp, v, k, depth + 1, true);
    return `<div class="ce-field"><label class="ce-key" title="${esc(pp.join('.'))}">${esc(k)}</label><div class="ce-val">${Array.isArray(v) ? inlineList(pp, v, k) : scalarHtml(pp, v, k)}</div>
      <button class="btn tiny ghost ce-x" data-act="del" data-p="${P(pp)}" title="Remove field ${esc(k)}">✕</button></div>`;
  }).join('');
  return `${rows || '<p class="faint small">No fields.</p>'}<div class="ce-add"><button class="btn tiny ghost" data-act="addkey" data-p="${P(path)}">+ field</button></div>`;
}
// short lists of plain values on one line: [12, 4], ["str", "agi"]
function inlineList(path, arr, key) {
  return `<div class="ce-inline">${arr.map((x, i) => `<span class="ce-chip">${scalarHtml([...path, i], x, key)}<button class="ce-chip-x" data-act="del" data-p="${P([...path, i])}" title="Remove">×</button></span>`).join('')}
    <button class="btn tiny ghost" data-act="push" data-p="${P(path)}" title="Add a value">+</button></div>`;
}
function arrayBody(path, arr, key, depth) {
  const allScalar = arr.every(isScalar);
  const items = arr.map((x, i) => {
    const pp = [...path, i];
    const tools = `<span class="ce-tools"><button class="btn tiny ghost" data-act="up" data-p="${P(pp)}" ${i ? '' : 'disabled'} title="Move up">↑</button><button class="btn tiny ghost" data-act="down" data-p="${P(pp)}" ${i < arr.length - 1 ? '' : 'disabled'} title="Move down">↓</button><button class="btn tiny ghost" data-act="dup" data-p="${P(pp)}" title="Duplicate">⧉</button><button class="btn tiny ghost danger" data-act="del" data-p="${P(pp)}" title="Remove">✕</button></span>`;
    if (allScalar) return `<div class="ce-row">${scalarHtml(pp, x, key)}${tools}</div>`;
    if (isScalar(x)) return `<div class="ce-card"><div class="ce-card-head"><b>#${i + 1}</b>${tools}</div>${scalarHtml(pp, x, key)}</div>`;
    const sum = summaryOf(x);
    return `<div class="ce-card"><div class="ce-card-head"><b>#${i + 1}</b> <span class="muted">${esc(sum)}</span>${tools}</div>
      ${Array.isArray(x) ? arrayBody(pp, x, key, depth + 1) : objectBody(pp, x, depth + 1)}</div>`;
  }).join('');
  const add = arr.length
    ? `<button class="btn tiny ghost" data-act="push" data-p="${P(path)}">+ add${isScalar(arr[arr.length - 1]) ? '' : ' (copy of last)'}</button>`
    : ['string:text', 'number:number', 'object:group'].map(s => { const [t, l] = s.split(':'); return `<button class="btn tiny ghost" data-act="pushtype" data-type="${t}" data-p="${P(path)}">+ ${l}</button>`; }).join(' ');
  return `${items}<div class="ce-add">${add}</div>`;
}
function formHtml() {
  lists = new Map();
  REFS = refLists();
  SEEN = valuesByKey(S.type === 'settings' ? S.draft : typeCollection());
  const body = objectBody([], S.draft, 0);
  return `<div class="ce-form">${body}</div>${[...lists.values()].join('')}`;
}

// ---------------------------------------------------------------- changes view
function diffRows(a, b, path = [], out = []) {
  if (isObj(a) && isObj(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in b)) out.push([[...path, k], a[k], undefined]);
      else if (!(k in a)) out.push([[...path, k], undefined, b[k]]);
      else diffRows(a[k], b[k], [...path, k], out);
    }
  } else if (!same(a, b)) out.push([path, a, b]);
  return out;
}
const short = v => (v === undefined ? '<span class="faint">—</span>' : `<code>${esc(JSON.stringify(v).slice(0, 160))}${JSON.stringify(v).length > 160 ? '…' : ''}</code>`);
function changesHtml() {
  const e = S.entry;
  let html = '';
  if (dirty()) {
    const rows = diffRows(e.data, S.draft);
    html += `<h4>Unsaved changes</h4><table class="ce-diff"><tbody>${rows.map(([p, a, b]) => `<tr><td class="ce-key">${esc(p.join('.') || '(entry)')}</td><td>${short(a)}</td><td>→</td><td>${short(b)}</td></tr>`).join('')}</tbody></table>`;
  }
  if (e.status === 'custom') html += '<h4>New entry</h4><p class="muted small">This entry was added on this server — it is not part of the game files.</p>';
  else if (e.base) {
    const rows = diffRows(e.base, e.data);
    html += `<h4>Saved differences from the original</h4>${rows.length ? `<table class="ce-diff"><tbody>${rows.map(([p, a, b]) => `<tr><td class="ce-key">${esc(p.join('.'))}</td><td>${short(a)}</td><td>→</td><td>${short(b)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted small">None — this entry is exactly as in the game files.</p>'}`;
  }
  if (e.hasOverride) html += `<h4>Stored override <span class="faint small">${esc(e.overrideFile || '')}</span></h4><pre class="ce-pre">${esc(JSON.stringify(e.override, null, 2))}</pre>`;
  if (e.systemOverride) html += `<p class="warn-text small">⚠ ${esc(e.systemOverride)} also changes this part of the content.</p>`;
  return html;
}

// ---------------------------------------------------------------- layout
function typesHtml() {
  if (!S.index) return '<p class="muted pad">Loading…</p>';
  const groups = {};
  for (const t of S.index.types) (groups[t.group] ||= []).push(t);
  return Object.entries(groups).map(([g, list]) => `<div class="ce-tgroup"><div class="ce-tgroup-h">${esc(g)}</div>${list.map(t => `
    <button class="ce-type ${t.id === S.type ? 'active' : ''}" data-type="${esc(t.id)}"><span class="ce-ticon">${t.icon}</span><span class="grow">${esc(t.label)}</span>${t.changed ? `<span class="ce-dot" title="${t.changed} changed on this server">${t.changed}</span>` : ''}<span class="faint small">${t.count}</span></button>`).join('')}</div>`).join('');
}
function listHtml() {
  if (!S.type) return '<p class="muted pad">Choose a content type.</p>';
  if (!S.list) return '<p class="muted pad">Loading…</p>';
  const q = S.filter.toLowerCase();
  // keep entries of one subfolder together (in their usual order)
  const firstSeen = new Map();
  S.list.entries.forEach((e, i) => { if (!firstSeen.has(e.group)) firstSeen.set(e.group, i); });
  const items = [...S.list.entries].sort((a, b) => firstSeen.get(a.group) - firstSeen.get(b.group)).filter(e => (!q || e.id.includes(q) || e.name.toLowerCase().includes(q)) && (!S.onlyChanged || e.status !== 'original'));
  let lastGroup = null;
  const rows = items.map(e => {
    const head = e.group !== lastGroup && S.list.entries.some(x => x.group) ? `<div class="ce-lgroup">${esc(e.group || 'other')}</div>` : '';
    lastGroup = e.group;
    return `${head}<button class="ce-entry ${e.id === S.id ? 'active' : ''} ${e.status === 'removed' ? 'is-removed' : ''}" data-entry="${esc(e.id)}">
      <span class="ce-glyph">${esc(e.glyph || '')}</span><span class="ce-names"><b>${esc(e.name)}</b><small>${esc(e.id)}</small></span>${e.status !== 'original' ? badge(e.status) : ''}</button>`;
  }).join('');
  const t = S.index.types.find(x => x.id === S.type);
  return `<div class="ce-list-head">
      <input type="search" placeholder="Search ${esc(t?.label || '')}…" data-ce-filter value="${esc(S.filter)}">
      ${S.type !== 'settings' ? '<button class="btn small primary" data-ce-new title="Create a new entry">+ New</button>' : ''}
    </div>
    <label class="ce-only small"><input type="checkbox" data-ce-only ${S.onlyChanged ? 'checked' : ''}> only changed on this server</label>
    <div class="ce-entries">${rows || '<p class="muted small pad">Nothing found.</p>'}</div>`;
}
function editorHtml() {
  if (!S.id) {
    return `<div class="ce-empty"><h3>📦 Game content</h3>
      <p>Pick something on the left to edit it. Everything here — classes, abilities, items, enemies, zones, quests, rifts, town buildings, settings … — is plain data.</p>
      <ul class="small muted"><li><b>Save</b> applies a change at once for everyone online; nobody needs to restart or reload.</li>
      <li>Changes are stored as small override files in <code>${esc(S.index?.overrideDir || 'data/content/')}</code> — the game files in <code>content/</code> stay untouched, so <code>update</code> never overwrites your edits.</li>
      <li>Every change is checked first. If it would break something (e.g. a zone pointing at an enemy that doesn't exist) it is not saved and you see what is wrong.</li>
      <li><b>Reset to original</b> undoes all changes of an entry; <b>Remove</b> hides an original entry (it can be restored) or deletes one you created.</li></ul></div>`;
  }
  if (!S.entry) return '<p class="muted pad">Loading…</p>';
  const e = S.entry, d = S.draft;
  const name = d?.name ?? d?.label ?? d?.title ?? (S.list?.entries.find(x => x.id === S.id)?.name || S.id);
  const isSettings = S.type === 'settings';
  const removed = e.status === 'removed';
  const canReset = e.hasOverride;
  const tabs = [['form', '✎ Form'], ['json', '{ } JSON'], ['changes', `Δ Changes${dirty() ? ' •' : ''}`]];
  return `<div class="ce-ehead">
      <div class="grow"><h3>${esc(d?.glyph || '')} ${esc(String(name))} ${badge(e.status)} ${dirty() ? '<span class="ce-badge st-unsaved">Unsaved</span>' : ''}</h3>
        <div class="faint small">${esc(S.type)} · <code>${esc(e.id)}</code> · ${esc(e.file || '')}</div></div>
      <div class="ce-actions">
        ${removed ? '<button class="btn small primary" data-ce-restore>↺ Restore</button>' : `<button class="btn small primary" data-ce-save ${dirty() && !S.busy ? '' : 'disabled'} title="Save (Ctrl+S)">💾 Save</button>
        <button class="btn small ghost" data-ce-discard ${dirty() ? '' : 'disabled'}>Discard</button>`}
        ${!isSettings && !removed ? '<button class="btn small ghost" data-ce-dup title="Create a copy under a new id">⧉ Duplicate</button>' : ''}
        ${canReset && !removed && e.status !== 'custom' ? '<button class="btn small ghost" data-ce-reset title="Undo every change to this entry">↺ Reset to original</button>' : ''}
        ${!isSettings && !removed ? '<button class="btn small ghost danger" data-ce-delete>🗑 Remove</button>' : ''}
      </div></div>
    ${removed ? '<div class="ce-note warn">This entry is removed on this server — players don\'t see it. Restore it to edit it again.</div>' : ''}
    ${S.problems ? `<div class="ce-note bad"><b>Not saved — please fix:</b><ul>${S.problems.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}
    ${S.warnings?.length ? `<div class="ce-note warn"><b>Saved, with warnings:</b><ul>${S.warnings.slice(0, 8).map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}
    <div class="tabs small-tabs">${tabs.map(([id, l]) => `<button class="tab ${S.mode === id ? 'active' : ''}" data-ce-mode="${id}">${l}</button>`).join('')}</div>
    <div class="ce-body ${removed ? 'is-removed' : ''}">${
      S.mode === 'json' ? `<textarea class="ce-json" data-ce-json spellcheck="false">${esc(S.jsonText)}</textarea>${S.jsonError ? `<div class="ce-note bad small">${esc(S.jsonError)}</div>` : '<p class="faint small">Edit the raw data. It is checked when you switch tabs or save.</p>'}`
      : S.mode === 'changes' ? changesHtml() : formHtml()}</div>`;
}

function draw(part = 'all') {
  if (!host?.isConnected) return;
  const keep = sel => { const el = host.querySelector(sel); return el ? el.scrollTop : 0; };
  const restore = (sel, v) => { const el = host.querySelector(sel); if (el) el.scrollTop = v; };
  if (part === 'all' || part === 'types') host.querySelector('.ce-types').innerHTML = typesHtml();
  if (part === 'all' || part === 'list') {
    const s = keep('.ce-entries'); const f = document.activeElement?.matches?.('[data-ce-filter]');
    host.querySelector('.ce-list').innerHTML = listHtml(); restore('.ce-entries', s);
    if (f) { const i = host.querySelector('[data-ce-filter]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  }
  if (part === 'all' || part === 'editor') {
    const s = keep('.ce-editor');
    host.querySelector('.ce-editor').innerHTML = editorHtml(); restore('.ce-editor', s);
  }
}
// cheap refresh of the bits that show "unsaved" without rebuilding the form (keeps focus while typing)
function refreshDirty() {
  const d = dirty();
  host.querySelector('[data-ce-save]')?.toggleAttribute('disabled', !d || S.busy);
  host.querySelector('[data-ce-discard]')?.toggleAttribute('disabled', !d);
  const h3 = host.querySelector('.ce-ehead h3');
  if (h3) { const u = h3.querySelector('.st-unsaved'); if (d && !u) h3.insertAdjacentHTML('beforeend', ' <span class="ce-badge st-unsaved">Unsaved</span>'); if (!d && u) u.remove(); }
  const tab = host.querySelector('[data-ce-mode="changes"]');
  if (tab) tab.textContent = `Δ Changes${d ? ' •' : ''}`;
}

// ---------------------------------------------------------------- loading
async function loadIndex() { try { S.index = await act('admin_content_index'); } catch (e) { toast(e.message, 'error'); } draw('types'); }
async function loadList() {
  if (!S.type) return;
  try { S.list = await act('admin_content_list', { type: S.type }); } catch (e) { toast(e.message, 'error'); }
  draw('list');
}
async function openEntry(id) {
  S.id = id; S.entry = null; S.problems = null; S.warnings = null; S.jsonError = null;
  draw('list'); draw('editor');
  try { setEntry(await act('admin_content_get', { type: S.type, id })); } catch (e) { toast(e.message, 'error'); S.id = null; }
  draw('editor');
  if (window.innerWidth < 1100) host.querySelector('.ce-editor')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
function setEntry(entry) {
  S.entry = entry; S.id = entry?.id ?? null;
  S.draft = entry ? clone(entry.data) : null;
  S.jsonText = S.draft ? JSON.stringify(S.draft, null, 2) : '';
  S.jsonError = null;
}
async function guard() { return !dirty() || confirmBox('Discard your unsaved changes?', 'Discard'); }
// JSON tab → draft (returns false if the JSON is invalid)
function syncJson() {
  if (S.mode !== 'json') return true;
  try {
    const v = JSON.parse(S.jsonText);
    if (!isObj(v)) throw new Error('The entry must be an object { … }');
    S.draft = v; S.jsonError = null; return true;
  } catch (e) { S.jsonError = `Invalid JSON: ${e.message}`; draw('editor'); return false; }
}

async function afterChange(r, msg) {
  S.warnings = r.warnings?.length ? r.warnings : null; S.problems = null;
  toast(msg, 'success', 2500);
  await Promise.all([loadIndex(), loadList()]);
}
function showProblems(e) {
  S.problems = e.details?.length ? e.details : [e.message];
  S.warnings = null;
  draw('editor');
  host.querySelector('.ce-editor').scrollTop = 0;
}
async function save() {
  if (!syncJson() || !dirty() || S.busy) return;
  S.busy = true; refreshDirty();
  try {
    const r = await act('admin_content_save', { type: S.type, id: S.id, data: S.draft });
    setEntry(r.entry);
    await afterChange(r, 'Saved — live for everyone now.');
  } catch (e) { showProblems(e); } finally { S.busy = false; draw('editor'); }
}

function newEntryDialog(from = null) {
  const entries = S.list?.entries.filter(e => e.status !== 'removed') || [];
  const t = S.index.types.find(x => x.id === S.type);
  const m = modal(`<h3>New ${esc(t.label.replace(/s$/, '').toLowerCase())}</h3>
    <label>Id <span class="faint small">(lowercase letters, digits, _ — used as the file name and in references)</span><input type="text" data-new-id placeholder="e.g. frost_golem" maxlength="48"></label>
    <label>Start from a copy of <select data-new-from>${entries.map(e => `<option value="${esc(e.id)}" ${e.id === (from || S.id) ? 'selected' : ''}>${esc(e.name)} (${esc(e.id)})</option>`).join('')}<option value="">— nothing (empty entry) —</option></select></label>
    <p class="faint small">Copying an existing entry is the easiest way to get every field right; then change what you need.</p>
    ${S.type === 'classes' ? '<p class="faint small">Copying a class also copies its abilities and skill tree, so the new class is playable right away.</p>' : ''}
    <div class="ce-note bad small" data-new-err hidden></div>
    <div class="row end gap"><button class="btn" data-close>Cancel</button><button class="btn primary" data-new-ok>Create</button></div>`);
  const idEl = m.el.querySelector('[data-new-id]'), err = m.el.querySelector('[data-new-err]');
  idEl.focus();
  idEl.addEventListener('input', () => { idEl.value = idEl.value.toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, ''); });
  const submit = async () => {
    try {
      const r = await act('admin_content_create', { type: S.type, id: idEl.value, from: m.el.querySelector('[data-new-from]').value || null });
      m.el.parentElement.remove();
      setEntry(r.entry); S.mode = 'form';
      await afterChange(r, `Created ${r.entry.id}${r.created?.length ? ` — also copied ${r.created.length} abilities / skill tree (named ${r.entry.id}_…)` : ''}.`);
      draw('editor');
    } catch (e) { err.hidden = false; err.innerHTML = `${esc(e.message)}${e.details ? `<ul>${e.details.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`; }
  };
  m.el.querySelector('[data-new-ok]').addEventListener('click', submit);
  idEl.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
}

function addFieldDialog(path) {
  const m = modal(`<h3>Add a field</h3>
    <label>Name <input type="text" data-f-name placeholder="e.g. cooldown"></label>
    <label>Type <select data-f-type><option value="string">text</option><option value="number">number</option><option value="boolean">yes / no</option><option value="array">list</option><option value="object">group of fields</option></select></label>
    <div class="row end gap"><button class="btn" data-close>Cancel</button><button class="btn primary" data-f-ok>Add</button></div>`);
  const nameEl = m.el.querySelector('[data-f-name]');
  nameEl.focus();
  const ok = () => {
    const k = nameEl.value.trim();
    if (!k) return;
    const obj = getAt(S.draft, path);
    if (k in obj) return toast(`"${k}" already exists`, 'error');
    obj[k] = emptyOf(m.el.querySelector('[data-f-type]').value);
    m.el.parentElement.remove();
    draw('editor');
  };
  m.el.querySelector('[data-f-ok]').addEventListener('click', ok);
  nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
}
const emptyOf = t => ({ string: '', number: 0, boolean: false, array: [], object: {} })[t] ?? null;

// ---------------------------------------------------------------- events
function bind(el) {
  el.addEventListener('click', async e => {
    const t = e.target.closest('button');
    if (!t || t.disabled) return;
    if (t.dataset.type) {
      if (t.dataset.type === S.type || !(await guard())) return;
      S.type = t.dataset.type; S.list = null; S.id = null; S.entry = null; S.filter = ''; S.closed.clear();
      draw(); loadList(); return;
    }
    if (t.dataset.entry) { if (t.dataset.entry !== S.id && (await guard())) { S.closed.clear(); openEntry(t.dataset.entry); } return; }
    if ('ceNew' in t.dataset) { if (await guard()) newEntryDialog(); return; }
    if ('ceDup' in t.dataset) { if (await guard()) newEntryDialog(S.id); return; }
    if (t.dataset.ceMode) {
      if (!syncJson()) return;
      S.mode = t.dataset.ceMode;
      if (S.mode === 'json') S.jsonText = JSON.stringify(S.draft, null, 2);
      draw('editor'); return;
    }
    if ('ceSave' in t.dataset) return save();
    if ('ceDiscard' in t.dataset) { setEntry(S.entry); S.problems = null; draw('editor'); return; }
    if ('ceReset' in t.dataset || 'ceRestore' in t.dataset) {
      const restoring = 'ceRestore' in t.dataset;
      if (!restoring && !(await confirmBox(`Undo every change to "${S.id}" and go back to the original from the game files?`, 'Reset'))) return;
      try {
        const r = await act('admin_content_reset', { type: S.type, id: S.id });
        setEntry(r.entry);
        await afterChange(r, restoring ? 'Restored.' : 'Back to the original.');
      } catch (err) { showProblems(err); }
      draw('editor'); return;
    }
    if ('ceDelete' in t.dataset) {
      const custom = S.entry.status === 'custom';
      if (!(await confirmBox(custom ? `Delete "${S.id}"? It was created on this server, so it is gone for good.` : `Remove "${S.id}"? Players won't see it anymore. You can restore it later.`, custom ? 'Delete' : 'Remove'))) return;
      try {
        let r = await act('admin_content_delete', { type: S.type, id: S.id });
        if (r.needsConfirm) {
          if (!(await confirmBox(`<b>${r.usage}</b> player save${r.usage === 1 ? '' : 's'} mention${r.usage === 1 ? 's' : ''} <code>${esc(S.id)}</code> (characters, items, progress …). Removing it can break those players — e.g. items or abilities that no longer exist. Remove anyway?`, 'Remove anyway', { html: true }))) return;
          r = await act('admin_content_delete', { type: S.type, id: S.id, force: true });
        }
        if (custom) { S.id = null; S.entry = null; } else await openEntry(S.id);
        await afterChange(r, `${custom ? 'Deleted' : 'Removed — restore it any time'}${r.also?.length ? ` (with ${r.also.length} abilities / skill tree)` : ''}.`);
        draw('editor');
      } catch (err) { showProblems(err); }
      return;
    }
    // structural form edits
    const act2 = t.dataset.act;
    if (!act2) return;
    const path = JSON.parse(t.dataset.p);
    if (act2 === 'del') delAt(S.draft, path);
    else if (act2 === 'addkey') return addFieldDialog(path);
    else if (act2 === 'push' || act2 === 'pushtype') {
      const arr = getAt(S.draft, path);
      const last = arr[arr.length - 1];
      arr.push(act2 === 'pushtype' ? emptyOf(t.dataset.type) : isScalar(last) ? (typeof last === 'number' ? 0 : typeof last === 'boolean' ? false : '') : clone(last));
    } else {
      const arr = getAt(S.draft, path.slice(0, -1)), i = path[path.length - 1];
      if (act2 === 'up' && i > 0) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
      if (act2 === 'down' && i < arr.length - 1) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
      if (act2 === 'dup') arr.splice(i + 1, 0, clone(arr[i]));
    }
    draw('editor');
  });
  el.addEventListener('input', e => {
    const t = e.target;
    if (t.matches('[data-ce-filter]')) { S.filter = t.value; draw('list'); return; }
    if (t.matches('[data-ce-json]')) { S.jsonText = t.value; try { S.draft = JSON.parse(t.value); } catch { /* checked on save */ } refreshDirty(); return; }
    if (!t.dataset.path) return;
    const path = JSON.parse(t.dataset.path);
    const k = t.dataset.kind;
    setAt(S.draft, path, k === 'boolean' ? t.checked : k === 'number' ? (t.value === '' ? 0 : Number(t.value)) : t.value);
    refreshDirty();
  });
  el.addEventListener('change', e => {
    const t = e.target;
    if (t.matches('[data-ce-only]')) { S.onlyChanged = t.checked; draw('list'); return; }
    if (t.dataset.settype) { if (t.value) { setAt(S.draft, JSON.parse(t.dataset.settype), emptyOf(t.value)); draw('editor'); } return; }
    if (t.dataset.path && t.dataset.kind === 'boolean') { setAt(S.draft, JSON.parse(t.dataset.path), t.checked); refreshDirty(); }
  });
  el.addEventListener('toggle', e => {
    const g = e.target.closest?.('[data-group]');
    if (!g || g !== e.target) return;
    if (g.open) S.closed.delete(g.dataset.group); else S.closed.add(g.dataset.group);
  }, true);
  el.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  });
}

// another admin (or the console) changed content: refresh lists; reload the open entry if untouched
bus.on('content:updated', () => {
  if (!host?.isConnected) return;
  loadIndex(); loadList();
  if (S.id && !dirty() && !S.busy) act('admin_content_get', { type: S.type, id: S.id }).then(r => { if (!dirty()) { setEntry(r); draw('editor'); } }).catch(() => {});
});

export function mountContentEditor(el) {
  host = el;
  el.innerHTML = '<div class="ce"><nav class="ce-types"></nav><div class="ce-list"></div><div class="ce-editor"></div></div>';
  bind(el.querySelector('.ce'));
  draw();
  loadIndex();
  if (S.type) loadList();
}
export const contentEditorDirty = () => dirty();
