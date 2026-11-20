// Abilities: unlock/upgrade, loadout priority and the per-ability behaviour (rule) editor.
import { abilityNow } from '/shared/abilityText.js';
import { computeStats } from '/shared/stats.js';
import { classLabel } from '/shared/data/subclasses.js';
import { SUBCLASSES } from '/shared/data/subclasses.js';
import { state, selectedChar } from '../state.js';
import { act } from '../net.js';
import { esc, run, tipAttr, toast } from '../ui.js';
import { abilityIcon } from '../assets.js';
import { charPicker, bindPicker, buildsBar, bindBuilds } from '../components.js';
import { CONFIG } from '/shared/config.js';
import { CLASSES } from '/shared/data/classes.js';
import { ABILITIES, classAbilities } from '/shared/data/abilities.js';
import { STATUSES } from '/shared/data/statuses.js';
import { ENEMIES } from '/shared/data/enemies.js';
import { MINIONS } from '/shared/data/minions.js';
import { CONDITIONS, TARGET_CONDITIONS, SELECTORS, selectorsForAbility, describeCondition } from '/shared/rules.js';
import { abilitySlots, abilityNodeId } from '/shared/character.js';
import { pathTo, availablePoints, mutatedAbilities, getTree } from '/shared/skilltree.js';
import { describeChanges } from '/shared/mutators.js';
import { focusTreeNode } from './skilltree.js';
import { minionStatsHtml, isMinionAbility } from '../minions.js';

let selectedAbility = null;
const drafts = new Map(); // `${charId}:${abilityId}` -> rule draft
const clone = o => JSON.parse(JSON.stringify(o));
const key = (ch, a) => `${ch.id}:${a}`;

function getDraft(ch, abilityId) {
  const k = key(ch, abilityId);
  if (!drafts.has(k)) drafts.set(k, clone(ch.rules[abilityId] || ABILITIES[abilityId].defaultRule));
  return drafts.get(k);
}
function isDirty(ch, abilityId) {
  const d = drafts.get(key(ch, abilityId));
  return d && JSON.stringify(d) !== JSON.stringify(ch.rules[abilityId]);
}

// ------------------------------------------------------------------ helpers
const ENEMY_TAGS = [...new Set(Object.values(ENEMIES).flatMap(e => e.tags))].sort();

function paramInput(p, value, path) {
  const attrs = `data-path="${path}" data-key="${p.key}"`;
  if (p.type === 'number') return `<span class="param"><input type="number" min="${p.min}" max="${p.max}" step="${p.step}" value="${esc(value ?? p.default)}" ${attrs}>${p.suffix ? `<span class="suffix">${p.suffix}</span>` : ''}</span>`;
  if (p.type === 'select') return `<select ${attrs}>${p.options.map(([v, l]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  if (p.type === 'status') {
    const opt = type => Object.entries(STATUSES).filter(([, s]) => s.type === type).map(([id, s]) => `<option value="${id}" ${id === value ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
    return `<select ${attrs}><optgroup label="Buffs">${opt('buff')}</optgroup><optgroup label="Debuffs">${opt('debuff')}</optgroup></select>`;
  }
  if (p.type === 'enemyTag') return enemyTagSelect(value, attrs);
  if (p.type === 'minion') return `<select ${attrs}><option value="">any minion</option>${Object.values(MINIONS).map(m => `<option value="${m.id}" ${m.id === value ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>`;
  return `<input value="${esc(value)}" ${attrs}>`;
}

function enemyTagSelect(value, attrs) {
  return `<select ${attrs}>
    <optgroup label="Enemy kinds">${ENEMY_TAGS.map(t => `<option value="${t}" ${t === value ? 'selected' : ''}>${esc(t[0].toUpperCase() + t.slice(1))}</option>`).join('')}</optgroup>
    <optgroup label="Specific enemies">${Object.values(ENEMIES).map(e => `<option value="${e.id}" ${e.id === value ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</optgroup>
  </select>`;
}

// Recursive condition list editor. listName: 'c' (activation) or 't' (target). path: '' or '0.2'
function condList(list, registry, listName, path = '', depth = 0) {
  const rows = list.map((c, i) => {
    const p = path === '' ? `${listName}:${i}` : `${path}.${i}`;
    if (c.type === 'group') {
      return `<div class="cond-group">
        <div class="cond-group-head">
          <label class="not-toggle" title="Invert"><input type="checkbox" data-path="${p}" data-key="negate" ${c.negate ? 'checked' : ''}> NOT</label>
          <select data-path="${p}" data-key="mode"><option value="all" ${c.mode !== 'any' ? 'selected' : ''}>ALL of</option><option value="any" ${c.mode === 'any' ? 'selected' : ''}>ANY of</option></select>
          <span class="grow"></span><button class="icon-btn small" data-del="${p}" title="Remove group">✕</button>
        </div>
        ${condList(c.conditions, registry, listName, p, depth + 1)}
      </div>`;
    }
    const def = registry[c.type];
    return `<div class="cond-row">
      <label class="not-toggle" title="Invert this condition"><input type="checkbox" data-path="${p}" data-key="negate" ${c.negate ? 'checked' : ''}> NOT</label>
      <select data-path="${p}" data-key="type" class="cond-type">${Object.entries(registry).filter(([, d]) => !d.locked).map(([id, d]) => `<option value="${id}" ${id === c.type ? 'selected' : ''}>${esc(d.label)}</option>`).join('')}</select>
      ${(def?.params || []).map(pp => paramInput(pp, c[pp.key], p)).join('')}
      <span class="grow"></span>
      <button class="icon-btn small" data-del="${p}" title="Remove">✕</button>
    </div>`;
  }).join('');
  const addPath = path === '' ? `${listName}:` : `${path}.`;
  return `<div class="cond-list">${rows || '<div class="muted small pad-s">No conditions.</div>'}
    <div class="row gap"><button class="btn tiny" data-add="${addPath}">+ Condition</button>${registry === CONDITIONS && depth < 2 ? `<button class="btn tiny ghost" data-add-group="${addPath}">+ Group (AND/OR)</button>` : ''}</div>
  </div>`;
}

// Resolve a path like 'c:0.1' to { list, index }
function resolvePath(rule, path) {
  const [listName, rest] = path.split(':');
  let list = listName === 'c' ? rule.conditions : rule.targetConditions;
  const idx = rest === '' ? [] : rest.split('.').filter(s => s !== '').map(Number);
  for (let i = 0; i < idx.length - 1; i++) list = list[idx[i]].conditions;
  return { list, index: idx[idx.length - 1], listName };
}
function listAt(rule, addPath) {
  const [listName, rest] = addPath.split(':');
  let list = listName === 'c' ? rule.conditions : rule.targetConditions;
  for (const i of rest.split('.').filter(s => s !== '').map(Number)) list = list[i].conditions;
  return { list, listName };
}
function defaultCond(registry, type) {
  const c = { type };
  for (const p of registry[type].params) c[p.key] = p.default;
  return c;
}

function summary(ability, rule) {
  if (!rule.enabled) return '<i>Disabled — this ability will never be used.</i>';
  const when = rule.conditions.length ? rule.conditions.map(describeCondition).join(rule.mode === 'any' ? ' <b>OR</b> ' : ' <b>AND</b> ') : 'it is ready';
  const sel = SELECTORS[rule.target.selector];
  let tgt = sel?.label || rule.target.selector;
  if (sel?.hasParam) tgt += ` (${esc(ENEMIES[rule.target.param]?.name || rule.target.param)})`;
  const tc = rule.targetConditions.length ? ` — only if ${rule.targetConditions.map(describeCondition).join(' and ')}` : '';
  return `Use <b>${esc(ability.name)}</b> on <b>${esc(tgt)}</b> when ${when}${tc}.`;
}

// ------------------------------------------------------------------ editor
// "Party member 2 (Mira)": party selectors name who sits in that place of the character's active party
function selectorLabel(s, ch) {
  const m = /^party_(\d)$/.exec(s);
  if (!m) return SELECTORS[s].label;
  const p = state.player;
  const party = (p.parties || []).find(x => x.members?.includes(ch.id)) || p.parties?.[p.activeParty ?? 0];
  const who = p.characters[party?.members?.[Number(m[1]) - 1]];
  return `${SELECTORS[s].label}${who ? ` (${who.name})` : ' (empty)'}`;
}

function editorHtml(ch, abilityId) {
  if (ABILITIES[abilityId]?.passive) {
    const p = ABILITIES[abilityId];
    return `<div class="panel rule-editor"><div class="panel-head"><div class="row gap">${abilityIcon(abilityId, 'md')}<div><h3>${esc(p.name)} <span class="muted small">Rank ${ch.abilities[abilityId]}</span></h3><div class="muted small">Passive</div></div></div></div>
      <div class="notice">Passive: works by itself and needs no loadout slot, so there is nothing to set up here.</div><p class="small">${esc(p.description)}</p></div>`;
  }
  const a = ABILITIES[abilityId];
  const rule = getDraft(ch, abilityId);
  const sels = selectorsForAbility(a);
  const cls = CLASSES[ch.classId];
  const dirty = isDirty(ch, abilityId);
  const equipped = ch.loadout.includes(abilityId);
  return `<div class="panel rule-editor">
    <div class="panel-head">
      <div class="row gap">${abilityIcon(abilityId, 'md')}<div><h3>${esc(a.name)} <span class="muted small">Rank ${ch.abilities[abilityId]}</span></h3><div class="muted small">Behaviour settings</div></div></div>
      <label class="switch"><input type="checkbox" data-rule-enabled ${rule.enabled ? 'checked' : ''}><span></span> Enabled</label>
    </div>
    ${equipped ? '' : '<div class="notice">This ability is not in the loadout, so it will not be used in combat.</div>'}
    ${isMinionAbility(ch, abilityId) ? `<div class="small">${minionStatsHtml(ch, abilityId)}</div>` : ''}
    <div class="small ability-now"><b>Right now${ch.abilities[abilityId] > 1 ? ` (rank ${ch.abilities[abilityId]})` : ''}:</b> ${esc(abilityNow(ch, abilityId, nowCtx(ch)))}</div>
    <div class="rule-summary">${summary(a, rule)}</div>

    <h4>1 · When to use it</h4>
    <div class="row gap small">Use when <select data-rule-mode><option value="all" ${rule.mode !== 'any' ? 'selected' : ''}>ALL</option><option value="any" ${rule.mode === 'any' ? 'selected' : ''}>ANY</option></select> of these are true:</div>
    ${condList(rule.conditions, CONDITIONS, 'c')}

    ${a.cost ? `<label class="switch small" ${tipAttr('When this ability is ready and its conditions are met but you lack ' + esc(cls.resource.name) + ', abilities lower in the loadout wait instead of spending it — so expensive abilities actually get cast.')}><input type="checkbox" data-rule-reserve ${rule.reserve !== false ? 'checked' : ''}><span></span> Save up ${esc(cls.resource.name)} for this ability (lower-priority abilities wait)</label>` : ''}

    <h4>2 · Who to target</h4>
    <div class="row gap wrap">
      <select data-rule-selector ${sels.length < 2 ? 'disabled' : ''}>${sels.map(s => `<option value="${s}" ${s === rule.target.selector ? 'selected' : ''}>${esc(selectorLabel(s, ch))}</option>`).join('')}</select>
      ${SELECTORS[rule.target.selector]?.hasParam ? enemyTagSelect(rule.target.param || 'boss', 'data-rule-param') : ''}
    </div>

    <h4>3 · Target requirements</h4>
    <div class="locked-chips">
      <span class="chip locked" title="Always enforced">✓ Target must be alive</span>
      <span class="chip locked" title="Always enforced">✓ Ability off cooldown (${a.cooldown}s)</span>
      ${a.cost ? `<span class="chip locked" title="Always enforced">✓ ${a.cost} ${esc(cls.resource.name)} available</span>` : ''}
    </div>
    ${condList(rule.targetConditions, TARGET_CONDITIONS, 't')}

    <div class="row gap end sticky-actions">
      <button class="btn ghost small" data-rule-default>Reset to default</button>
      <button class="btn small" data-rule-revert ${dirty ? '' : 'disabled'}>Revert</button>
      <button class="btn primary" data-rule-save ${dirty ? '' : 'disabled'}>${dirty ? 'Save behaviour' : 'Saved'}</button>
    </div>
  </div>`;
}

// ------------------------------------------------------------------ view
export const abilitiesView = {
  id: 'abilities', label: 'Abilities', icon: '✦',
  mount(root) {
    bindPicker(root, () => { selectedAbility = null; this.render(root); });
    bindBuilds(root, selectedChar);
    const rerenderEditor = () => {
      const ch = selectedChar();
      const host = root.querySelector('.editor-host');
      if (host && selectedAbility) host.innerHTML = editorHtml(ch, selectedAbility);
    };
    root.addEventListener('click', async e => {
      const ch = selectedChar();
      if (!ch) return;
      const t = e.target.closest('button, [data-select-ability]');
      if (!t) return;
      const d = t.dataset;
      if (d.selectAbility) { selectedAbility = d.selectAbility; this.render(root); return; }
      if (d.treeGoto) { focusTreeNode(ch.id, d.treeGoto); return; }
      if (d.equipAb) {
        if (ch.loadout.length >= abilitySlots(ch)) return toast('All ability slots are full — remove one first.', 'error');
        await run(act('set_loadout', { charId: ch.id, loadout: [...ch.loadout, d.equipAb] }));
        return;
      }
      if (d.removeAb) { await run(act('set_loadout', { charId: ch.id, loadout: ch.loadout.filter(x => x !== d.removeAb) })); return; }
      if (d.moveAb) {
        const lo = [...ch.loadout];
        const i = lo.indexOf(d.moveAb), j = i + Number(d.dir);
        if (j < 0 || j >= lo.length) return;
        [lo[i], lo[j]] = [lo[j], lo[i]];
        await run(act('set_loadout', { charId: ch.id, loadout: lo }));
        return;
      }
      // rule editor
      const rule = selectedAbility && getDraft(ch, selectedAbility);
      if (!rule) return;
      if (d.add !== undefined) {
        const { list, listName } = listAt(rule, d.add);
        const reg = listName === 'c' ? CONDITIONS : TARGET_CONDITIONS;
        list.push(defaultCond(reg, listName === 'c' ? 'self_hp_below' : 'target_hp_below'));
        if (listName === 'c' && list.length > 1 && list[0].type === 'always') list.splice(0, 1);
        rerenderEditor();
      } else if (d.addGroup !== undefined) {
        listAt(rule, d.addGroup).list.push({ type: 'group', mode: 'any', conditions: [defaultCond(CONDITIONS, 'self_hp_below'), defaultCond(CONDITIONS, 'ally_hp_below')] });
        rerenderEditor();
      } else if (d.del !== undefined) {
        const { list, index } = resolvePath(rule, d.del);
        list.splice(index, 1);
        rerenderEditor();
      } else if ('ruleSave' in d) {
        if (await run(act('set_rule', { charId: ch.id, abilityId: selectedAbility, rule }), 'Behaviour saved — active immediately.') !== undefined) drafts.delete(key(ch, selectedAbility));
      } else if ('ruleRevert' in d) {
        drafts.delete(key(ch, selectedAbility)); rerenderEditor();
      } else if ('ruleDefault' in d) {
        drafts.set(key(ch, selectedAbility), clone(ABILITIES[selectedAbility].defaultRule)); rerenderEditor();
      }
    });
    const onEdit = e => {
      const ch = selectedChar();
      if (!ch || !selectedAbility) return;
      const rule = getDraft(ch, selectedAbility);
      const t = e.target;
      if (t.matches('[data-rule-enabled]')) rule.enabled = t.checked;
      else if (t.matches('[data-rule-reserve]')) rule.reserve = t.checked;
      else if (t.matches('[data-rule-mode]')) rule.mode = t.value;
      else if (t.matches('[data-rule-selector]')) { rule.target = { selector: t.value }; if (SELECTORS[t.value].hasParam) rule.target.param = 'boss'; }
      else if (t.matches('[data-rule-param]')) rule.target.param = t.value;
      else if (t.dataset.path) {
        const { list, index, listName } = resolvePath(rule, t.dataset.path);
        const c = list[index];
        const k = t.dataset.key;
        if (k === 'negate') c.negate = t.checked;
        else if (k === 'mode') c.mode = t.value;
        else if (k === 'type') list[index] = { ...defaultCond(listName === 'c' ? CONDITIONS : TARGET_CONDITIONS, t.value), ...(c.negate ? { negate: true } : {}) };
        else c[k] = t.type === 'number' ? Number(t.value) : t.value;
        if (e.type === 'input' && t.type === 'number') { // update summary without stealing focus
          const s = root.querySelector('.rule-summary');
          if (s) s.innerHTML = summary(ABILITIES[selectedAbility], rule);
          const save = root.querySelector('[data-rule-save]');
          if (save) { save.disabled = false; save.textContent = 'Save behaviour'; }
          root.querySelector('[data-rule-revert]')?.removeAttribute('disabled');
          return;
        }
      } else return;
      rerenderEditor();
    };
    root.addEventListener('change', onEdit);
    root.addEventListener('input', e => { if (e.target.type === 'number') onEdit(e); });
  },
  render(root) {
    const ch = selectedChar();
    if (!ch) return;
    const all = classAbilities(ch.classId, ch.subclass);
    if (!selectedAbility || !ch.abilities[selectedAbility]) selectedAbility = ch.loadout[0] || Object.keys(ch.abilities)[0] || null;
    const slots = abilitySlots(ch);
    const unequipped = Object.keys(ch.abilities).filter(a => !ch.loadout.includes(a) && !ABILITIES[a]?.passive);
    root.innerHTML = `
      ${charPicker(ch.id)}
      ${buildsBar(ch)}
      <div class="abilities-layout">
        <div class="abilities-left">
          <section class="panel">
            <div class="panel-head"><h3>Combat loadout <span class="muted small">${ch.loadout.length}/${slots} slots</span></h3><span class="muted small">Top = highest priority</span></div>
            <p class="muted small">Each action, ${esc(ch.name)} checks abilities from top to bottom and uses the first one whose behaviour conditions are met. If none qualify, a basic attack is used.</p>
            <ol class="loadout">${ch.loadout.map((a, i) => `<li class="loadout-item ${a === selectedAbility ? 'active' : ''}" data-select-ability="${a}">
              <span class="prio">${i + 1}</span>${abilityIcon(a, 'sm')}
              <div class="grow"><b>${esc(ABILITIES[a].name)}</b><div class="muted small clamp">${summary(ABILITIES[a], ch.rules[a])}</div></div>
              <div class="loadout-btns">
                <button class="icon-btn small" data-move-ab="${a}" data-dir="-1" ${i === 0 ? 'disabled' : ''} title="Higher priority">▲</button>
                <button class="icon-btn small" data-move-ab="${a}" data-dir="1" ${i === ch.loadout.length - 1 ? 'disabled' : ''} title="Lower priority">▼</button>
                <button class="icon-btn small" data-remove-ab="${a}" title="Remove from loadout">✕</button>
              </div>
            </li>`).join('')}${Array.from({ length: slots - ch.loadout.length }, () => '<li class="loadout-item empty"><span class="muted small">Empty slot</span></li>').join('')}</ol>
            ${unequipped.length ? `<div class="notice small unequipped">
              <div><b>${unequipped.length} learned abilit${unequipped.length > 1 ? 'ies are' : 'y is'} not equipped and will never be used:</b></div>
              <div class="row gap wrap">${unequipped.map(a => `<button class="btn tiny" data-equip-ab="${a}" ${ch.loadout.length >= slots ? 'disabled' : ''}>${esc(ABILITIES[a].name)} +</button>`).join(' ')}</div>
              ${ch.loadout.length >= slots ? '<div class="muted">All slots are full — remove an ability (✕) to make room.</div>' : ''}
            </div>` : ''}
          </section>
          <section class="panel">
            <div class="panel-head"><h3>${esc(classLabel(ch.classId, ch.subclass))} abilities</h3>${availablePoints(ch) ? `<a class="points" href="#/skilltree">${availablePoints(ch)} skill point${availablePoints(ch) === 1 ? '' : 's'}</a>` : ''}</div>
            <p class="muted small">Abilities are learned and empowered through the <a href="#/skilltree">passive skill tree</a>.</p>
            <div class="ability-book">${all.map(a => abilityCard(ch, a)).join('')}</div>
          </section>
        </div>
        <div class="abilities-right editor-host">${selectedAbility ? editorHtml(ch, selectedAbility) : '<div class="panel muted">Unlock an ability to configure its behaviour.</div>'}</div>
      </div>`;
  },
};

function mutatorNodes(ch, abilityId) {
  if (!ch.subclass) return [];
  const tree = getTree(ch.classId, ch.subclass);
  return Object.values(tree.nodes).filter(n => n.mutator?.ability === abilityId).map(n => ({ n, on: ch.tree.allocated.includes(n.id) }));
}

// stats and mutated ability definitions for the "Now" lines (cached per render pass)
let nowCache = null;
function nowCtx(ch) {
  if (nowCache?.ch !== ch || Date.now() - nowCache.at > 500) nowCache = { ch, at: Date.now(), stats: computeStats(ch), defs: mutatedAbilities(ch) };
  return nowCache;
}

function abilityCard(ch, base) {
  const muts = mutatorNodes(ch, base.id);
  const a = mutatedAbilities(ch)[base.id] ? { ...mutatedAbilities(ch)[base.id], id: base.id } : base;
  const mutHtml = muts.length ? `<div>${muts.map(({ n, on }) => `<span class="mut-tag" style="${on ? '' : 'opacity:.45'}" ${tipAttr(`<b>${esc(n.name)}</b>${on ? '' : ' <span class=\'muted\'>(not allocated)</span>'}<br>${esc(n.description)}<br>${describeChanges(n.mutator.changes).map(esc).join(', ')}`)}>✦ ${esc(n.name)}</span>`).join('')}</div>` : '';
  const rank = ch.abilities[a.id] || 0;
  const unlocked = rank > 0;
  const cls = CLASSES[ch.classId];
  const nodeId = abilityNodeId(ch.classId, a.id, ch.subclass);
  const dist = unlocked ? 0 : pathTo(ch, nodeId).length;
  const action = unlocked
    ? `<span class="muted small">Rank ${rank}/${CONFIG.maxAbilityRank}</span>${rank < CONFIG.maxAbilityRank ? `<button class="btn tiny ghost" data-tree-goto="${nodeId}">Empower in tree</button>` : ''}`
    : `<button class="btn tiny ${dist <= availablePoints(ch) ? 'primary' : ''}" data-tree-goto="${nodeId}">Skill tree · ${dist} pt${dist === 1 ? '' : 's'}</button>`;
  const meta = a.passive ? [`Passive · ${a.cooldown}s cooldown`].join('') : [a.cost ? `${a.cost} ${cls.resource.name}` : 'No cost', `${a.cooldown}s cooldown`, a.area ? 'Area' : a.target === 'self' ? 'Self' : a.target === 'ally' ? 'Ally' : 'Enemy'].join(' · ');
  const tip = `<b>${esc(a.name)}</b><br>${esc(a.description)}<br><span class='muted'>${esc(meta)}</span><br>Each rank: +${Math.round(CONFIG.abilityRankBonus * 100)}% effect (ranks come from Empowered nodes in the skill tree)`;
  return `<div class="ability-card ${unlocked ? '' : 'locked'} ${a.id === selectedAbility ? 'active' : ''}" ${unlocked ? `data-select-ability="${a.id}"` : ''} ${tipAttr(tip)}>
    ${abilityIcon(a.id, 'md')}
    <div class="grow"><b>${esc(a.name)}</b> <span class="type-tag t-${a.type}">${a.type}</span>${a.subclass && SUBCLASSES[a.subclass] ? ` <span class="sub-tag" style="--sub-color:${esc(SUBCLASSES[a.subclass].color || '#c9a24a')}">${esc(SUBCLASSES[a.subclass].glyph || '')} ${esc(SUBCLASSES[a.subclass].name)}</span>` : ''}
      <div class="small muted">${esc(a.description)}</div>
      ${unlocked ? `<div class="small ability-now"><b>Now${rank > 1 ? ` (rank ${rank})` : ''}:</b> ${esc(abilityNow(ch, a.id, nowCtx(ch)))}</div>` : ''}
      ${isMinionAbility(ch, a.id) ? `<div class="small">${minionStatsHtml(ch, a.id)}</div>` : ''}
      <div class="small faint">${esc(meta)}</div>
      ${mutHtml}
      ${Object.entries(a.rankEffects || ABILITIES[a.id]?.rankEffects || {}).map(([r, re]) => `<div class="rank-effect small ${rank >= Number(r) ? 'on' : ''}">▲ Rank ${r} — <b>${esc(re.name)}</b>: ${esc(re.description)}</div>`).join('')}
      <div class="ranks">${Array.from({ length: CONFIG.maxAbilityRank }, (_, i) => `<span class="pip ${i < rank ? 'on' : ''}"></span>`).join('')}</div>
    </div>
    <div class="ability-action col">${action}</div>
  </div>`;
}
