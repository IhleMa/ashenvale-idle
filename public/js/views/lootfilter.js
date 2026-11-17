// Loot filter editor + log (shown as tabs on the Inventory page).
import { state } from '../state.js';
import { act } from '../net.js';
import { esc, fmt, run, toast, confirmBox, tipAttr } from '../ui.js';
import { itemIcon } from '../assets.js';
import { CONFIG } from '/shared/config.js';
import { SLOTS, AFFIXES } from '/shared/data/items.js';
import { MATERIALS } from '/shared/data/town.js';
import { FILTER_ACTIONS, FILTER_STATS, PRESETS, MAX_RULES, newRule, describeRule, ruleMatches, evaluateItem, makeContext } from '/shared/lootfilter.js';

let draft = null;    // editable copy of the player's filter
let dirty = false;
let openRule = null; // rule id whose details are expanded

const clone = o => JSON.parse(JSON.stringify(o));
export function resetDraft() { draft = null; dirty = false; }
function ensureDraft() {
  if (!draft || !dirty) draft = clone(state.player.lootFilter || { enabled: false, protectUpgrades: true, rules: [] });
  return draft;
}
export function filterIsDirty() { return dirty; }

// verdict for every inventory item with the SAVED filter (for badges on the items grid)
export function inventoryVerdicts(p) {
  const ctx = makeContext(p);
  const out = new Map();
  for (const i of p.inventory) out.set(i.uid, evaluateItem(p.lootFilter, i, ctx));
  return out;
}

const chip = (attr, value, on, label, cls = '') => `<button type="button" class="lf-chip ${on ? 'on' : ''} ${cls}" data-${attr}="${esc(value)}">${label}</button>`;

function ruleHtml(r, i, ctx) {
  const matches = state.player.inventory.filter(it => !it.unique && !it.set && !it.locked && ruleMatches(r, it, ctx)).length;
  const open = openRule === r.id;
  return `<div class="lf-rule ${r.enabled ? '' : 'off'} act-${r.action}" data-rule="${r.id}">
    <div class="lf-rule-head">
      <span class="lf-order">${i + 1}</span>
      <input type="checkbox" data-r-enabled ${r.enabled ? 'checked' : ''} ${tipAttr('Rule on/off')}>
      <input class="lf-name" data-r-name value="${esc(r.name)}" maxlength="40">
      <select data-r-action>${Object.entries(FILTER_ACTIONS).map(([k, a]) => `<option value="${k}" ${r.action === k ? 'selected' : ''}>${a.icon} ${a.label}</option>`).join('')}</select>
      <span class="grow"></span>
      <button class="btn tiny ghost" data-r-up ${i === 0 ? 'disabled' : ''} ${tipAttr('Move up (rules are checked top to bottom)')}>↑</button>
      <button class="btn tiny ghost" data-r-down ${i === draft.rules.length - 1 ? 'disabled' : ''}>↓</button>
      <button class="btn tiny ghost" data-r-toggle>${open ? 'Done' : 'Edit'}</button>
      <button class="btn tiny ghost danger" data-r-del ${tipAttr('Delete rule')}>✕</button>
    </div>
    <div class="lf-summary small">${esc(describeRule(r))} <span class="muted">· matches ${matches} item${matches === 1 ? '' : 's'} in your inventory</span></div>
    ${open ? `<div class="lf-conds">
      <div class="lf-cond"><span class="lf-label">Rarity</span><div class="lf-chips">${CONFIG.rarities.map(x => chip('r-rarity', x.id, r.rarities.includes(x.id), esc(x.label), `rarity-text rarity-${x.id}`)).join('')}</div><span class="faint small">none selected = any</span></div>
      <div class="lf-cond"><span class="lf-label">Slot</span><div class="lf-chips">${Object.entries(SLOTS).map(([k, s]) => chip('r-slot', k, r.slots.includes(k), esc(s.label))).join('')}</div></div>
      <div class="lf-cond"><span class="lf-label">Item level</span><div class="row gap wrap small">
        <label class="inline">at least <input type="number" class="lf-num" data-r-num="minLevel" min="1" max="${CONFIG.levelCap}" value="${r.minLevel ?? ''}" placeholder="–"></label>
        <label class="inline">at most <input type="number" class="lf-num" data-r-num="maxLevel" min="1" max="${CONFIG.levelCap}" value="${r.maxLevel ?? ''}" placeholder="–"></label>
        <label class="inline">or <input type="number" class="lf-num" data-r-num="levelsBelowHero" min="0" max="${CONFIG.levelCap}" value="${r.levelsBelowHero ?? ''}" placeholder="–"> + levels below my hero</label></div></div>
      <div class="lf-cond"><span class="lf-label">Usable</span><label class="inline small"><input type="checkbox" data-r-unusable ${r.unusable ? 'checked' : ''}> only gear that <b>no class in my roster</b> can wear</label></div>
      <div class="lf-cond"><span class="lf-label">Has any of</span><div class="lf-chips">${FILTER_STATS.map(s => chip('r-any', s, r.anyStats.includes(s), esc(AFFIXES[s].label))).join('')}</div></div>
      <div class="lf-cond"><span class="lf-label">Has none of</span><div class="lf-chips">${FILTER_STATS.map(s => chip('r-none', s, r.noStats.includes(s), esc(AFFIXES[s].label))).join('')}</div></div>
    </div>` : ''}
  </div>`;
}

export function filterHtml() {
  const p = state.player;
  const f = ensureDraft();
  const ctx = makeContext(p);
  return `<section class="panel lf-editor">
    <div class="panel-head"><h3>🧹 Loot filter</h3>
      <div class="row gap">${dirty ? '<span class="warn-text small">Unsaved changes</span><button class="btn small ghost" data-lf-discard>Discard</button>' : ''}<button class="btn small primary" data-lf-save ${dirty ? '' : 'disabled'}>Save filter</button></div></div>
    <div class="lf-top">
      <label class="switch-row"><input type="checkbox" data-lf-enabled ${f.enabled ? 'checked' : ''}> <b>Filter new loot automatically</b></label>
      <label class="switch-row" ${tipAttr('Never salvage or sell an item that would raise the power of one of your characters, even if a rule matches.')}><input type="checkbox" data-lf-protect ${f.protectUpgrades ? 'checked' : ''}> Protect upgrades for my characters</label>
      <label class="inline small">When the inventory is full
        <select data-lf-full><option value="sell" ${p.settings.autoLootAction !== 'salvage' ? 'selected' : ''}>sell new loot</option><option value="salvage" ${p.settings.autoLootAction === 'salvage' ? 'selected' : ''}>salvage new loot</option></select></label>
    </div>
    <p class="muted small">Rules are checked <b>from top to bottom</b> — the first rule that matches decides what happens to a drop. Items that match no rule are kept. Uniques, set items and locked items are always kept. Put <b>Keep</b> rules above <b>Salvage</b> rules to make exceptions (e.g. "keep rares with Critical Chance", then "salvage all rares").</p>
    <div class="lf-rules">${f.rules.map((r, i) => ruleHtml(r, i, ctx)).join('') || '<p class="muted pad">No rules yet — add one or start from a preset.</p>'}</div>
    <div class="row gap wrap">
      <button class="btn small" data-lf-add ${f.rules.length >= MAX_RULES ? 'disabled' : ''}>+ New rule</button>
      <select data-lf-preset><option value="">Add a preset…</option>${Object.entries(PRESETS).map(([k, x]) => `<option value="${k}">${esc(x.label)}</option>`).join('')}</select>
      <span class="grow"></span>
      <button class="btn small" data-lf-apply ${dirty ? 'disabled title="Save first"' : ''}>Run on inventory now…</button>
    </div>
  </section>`;
}

export function logHtml() {
  const log = state.player.lootLog || [];
  const s = state.player.stats;
  const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
  return `<section class="panel">
    <div class="panel-head"><h3>Filtered loot <span class="muted small">${fmt(s.autoSalvaged || 0)} salvaged · ${fmt(s.autoSold || 0)} sold in total</span></h3>${log.length ? '<button class="btn tiny ghost" data-lf-clearlog>Clear</button>' : ''}</div>
    ${log.length ? `<div class="lf-log">${log.map(e => `<div class="lf-log-row">
        ${itemIcon({ baseId: e.baseId, rarity: e.rarity, slot: e.slot }, 'xs')}
        <span class="grow"><span class="rarity-text rarity-${e.rarity}">${esc(e.name)}</span> <span class="muted small">ilvl ${e.level}</span><br><span class="faint small">${esc(e.reason || '')}</span></span>
        <span class="small">${e.action === 'salvaged' ? `🔨 ${Object.entries(e.materials || {}).map(([k, v]) => `${v} ${esc(MATERIALS[k]?.name || k)}`).join(', ') || 'salvaged'}` : `💰 ${fmt(e.gold || 0)}g`}</span>
        <span class="faint small lf-ago">${ago(e.at)}</span></div>`).join('')}</div>`
      : '<p class="muted small">Nothing has been filtered yet. Items the loot filter salvages or sells (and overflow when your inventory is full) show up here.</p>'}
  </section>`;
}

// event wiring — returns true if the event was handled
export async function handleFilterClick(e, rerender) {
  const t = e.target.closest('button, [data-lf-enabled], [data-lf-protect]');
  if (!t || !e.target.closest('.lf-editor, [data-lf-clearlog]')) return false;
  const d = t.dataset;
  const f = ensureDraft();
  const ruleEl = t.closest('[data-rule]');
  const rule = ruleEl ? f.rules.find(r => r.id === ruleEl.dataset.rule) : null;
  const touch = () => { dirty = true; rerender(); };
  const toggle = (list, v) => { const i = list.indexOf(v); if (i >= 0) list.splice(i, 1); else list.push(v); };
  if ('lfSave' in d) {
    if (await run(act('loot_filter_save', { filter: f }), 'Loot filter saved.') !== undefined) { dirty = false; draft = null; }
    return true;
  }
  if ('lfDiscard' in d) { dirty = false; draft = null; rerender(); return true; }
  if ('lfAdd' in d) { const r = newRule(); f.rules.push(r); openRule = r.id; touch(); return true; }
  if ('lfClearlog' in d) { await run(act('loot_log_clear')); return true; }
  if ('lfApply' in d) {
    const preview = await run(act('loot_filter_apply', { dryRun: true }));
    if (!preview) return true;
    if (!preview.salvage && !preview.sell) { toast('Nothing in your inventory matches the filter.', 'info'); return true; }
    if (await confirmBox(`Run the loot filter on your inventory now?<br><br>🔨 Salvage <b>${preview.salvage}</b> item(s)<br>💰 Sell <b>${preview.sell}</b> item(s)<br><br><span class="muted small">Locked items, uniques, set items${state.player.lootFilter.protectUpgrades ? ' and upgrades' : ''} are kept.</span>`, 'Run filter', { html: true })) {
      const r = await run(act('loot_filter_apply', {}));
      if (r) toast(`Filter done: ${r.salvage} salvaged${Object.keys(r.materials).length ? ` (${Object.entries(r.materials).map(([k, v]) => `${v} ${MATERIALS[k]?.name || k}`).join(', ')})` : ''}, ${r.sell} sold${r.gold ? ` for ${fmt(r.gold)}g` : ''}.`, 'success', 7000);
    }
    return true;
  }
  if (!rule) return false;
  if ('rUp' in d || 'rDown' in d) {
    const i = f.rules.indexOf(rule), j = i + ('rUp' in d ? -1 : 1);
    [f.rules[i], f.rules[j]] = [f.rules[j], f.rules[i]];
    touch(); return true;
  }
  if ('rDel' in d) { f.rules.splice(f.rules.indexOf(rule), 1); touch(); return true; }
  if ('rToggle' in d) { openRule = openRule === rule.id ? null : rule.id; rerender(); return true; }
  if (d.rRarity) { toggle(rule.rarities, d.rRarity); touch(); return true; }
  if (d.rSlot) { toggle(rule.slots, d.rSlot); touch(); return true; }
  if (d.rAny) { toggle(rule.anyStats, d.rAny); touch(); return true; }
  if (d.rNone) { toggle(rule.noStats, d.rNone); touch(); return true; }
  return false;
}

export async function handleFilterChange(e, rerender) {
  const t = e.target;
  if (!t.closest('.lf-editor')) return false;
  const f = ensureDraft();
  const ruleEl = t.closest('[data-rule]');
  const rule = ruleEl ? f.rules.find(r => r.id === ruleEl.dataset.rule) : null;
  if (t.matches('[data-lf-full]')) { await run(act('set_settings', { autoLootAction: t.value }), 'Saved.'); return true; }
  if (t.matches('[data-lf-preset]')) {
    const pr = PRESETS[t.value];
    if (pr && f.rules.length < MAX_RULES) {
      const r = newRule(clone(pr.rule));
      // keep-rules go to the top so they work as exceptions
      if (r.action === 'keep') f.rules.unshift(r); else f.rules.push(r);
      dirty = true;
    }
    rerender(); return true;
  }
  if (t.matches('[data-lf-enabled]')) f.enabled = t.checked;
  else if (t.matches('[data-lf-protect]')) f.protectUpgrades = t.checked;
  else if (rule && t.matches('[data-r-enabled]')) rule.enabled = t.checked;
  else if (rule && t.matches('[data-r-name]')) rule.name = t.value.slice(0, 40) || 'Rule';
  else if (rule && t.matches('[data-r-action]')) rule.action = t.value;
  else if (rule && t.matches('[data-r-unusable]')) rule.unusable = t.checked;
  else if (rule && t.matches('[data-r-num]')) rule[t.dataset.rNum] = t.value === '' ? null : Math.max(0, Math.min(CONFIG.levelCap, Math.round(Number(t.value))));
  else return false;
  dirty = true;
  rerender();
  return true;
}
