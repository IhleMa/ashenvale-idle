// Passive skill tree: pan/zoom SVG web, path preview, multi-node allocation, refunds, search.
import { morphed } from '../morph.js';
import { describeChanges, mutatorAbilityName } from '/shared/mutators.js';
import { SUBCLASSES } from '/shared/data/subclasses.js';
import { state, selectedChar } from '../state.js';
import { act } from '../net.js';
import { esc, fmt, run, toast, confirmBox, tipAttr } from '../ui.js';
import { assetUrl, abilityIcon } from '../assets.js';
import { charPicker, bindPicker , buildsBar, bindBuilds } from '../components.js';
import { CLASSES } from '/shared/data/classes.js';
import { ABILITIES } from '/shared/data/abilities.js';
import { getTree, describeNodeStats, TREE_CONFIG } from '/shared/data/skilltree.js';
import { availablePoints, totalSkillPoints, spentPoints, pathTo, planPathTo, canRefund, treeStats, allocatedSet } from '/shared/skilltree.js';
import { treeRefundCost, treeResetCost } from '/shared/character.js';
import { CONFIG } from '/shared/config.js';
import { minionStatsHtml, minionRankHtml, minionNodeHtml, isMinionAbility } from '../minions.js';
import { abilityStatsHtml, abilityRankHtml } from '../abilityStats.js';

const SIZE = { start: 30, ability: 21, keystone: 25, notable: 16, mutator: 17, rank: 12, small: 9 };
const GLYPH = { keystone: '✹', notable: '◆', mutator: '✦', rank: '▲', small: '' };
let view = null;          // { x, y, w } current viewBox (h follows aspect ratio)
let lastSig = null;
let refundMode = false;
let planMode = false; // clicks add nodes to the planned build instead of allocating them
let search = '';
let hoverPath = [];
let focusNode = null;
let drag = null;

export function focusTreeNode(charId, nodeId) {
  state.selectedCharId = charId;
  focusNode = nodeId;
  location.hash = '#/skilltree';
}

function treeSig(ch) { return `${ch.id}|${ch.level}|${ch.tree.allocated.join(',')}|${(ch.tree.plan || []).join(',')}|${refundMode}|${planMode}`; }
const planOf = ch => ch.tree.plan || [];
// the level at which the planned build is complete (null if the level cap doesn't give enough points)
function planDoneLevel(ch) {
  const need = spentPoints(ch) + planOf(ch).length;
  for (let L = ch.level; L <= CONFIG.levelCap; L++) if (totalSkillPoints({ ...ch, level: L }) >= need) return L;
  return null;
}

function applyViewBox(svg) {
  const r = svg.getBoundingClientRect();
  const h = view.w * (r.height / Math.max(1, r.width));
  svg.setAttribute('viewBox', `${view.x - view.w / 2} ${view.y - h / 2} ${view.w} ${h}`);
}

function nodeState(ch, n, set) {
  if (set.has(n.id)) return 'on';
  if (n.links.some(l => set.has(l))) return availablePoints(ch) > 0 ? 'avail' : 'adj';
  return 'off';
}

function nodeTip(ch, n, set) {
  const lines = describeNodeStats(n.stats);
  const ab = n.ability ? ABILITIES[n.ability] : null;
  let html = `<b>${esc(n.name)}</b> ${n.subclass ? `<span class="sub-tag" style="--sub-color:${esc(SUBCLASSES[n.subclass]?.color || '#c9a24a')}">${esc(SUBCLASSES[n.subclass]?.name || n.subclass)}</span> ` : ''}<span class="muted">${n.type === 'start' ? 'Origin' : n.type === 'ability' ? 'Ability' : n.type === 'keystone' ? 'Keystone' : n.type === 'notable' ? 'Notable' : n.type === 'rank' ? 'Ability rank' : n.type === 'mutator' ? 'Ability mutator' : 'Passive'}</span>`;
  if (n.mutator) {
    const owned = !!ch.abilities[n.mutator.ability];
    html += `<br><i>${esc(n.description)}</i><br><b>${esc(mutatorAbilityName(n.mutator))}:</b> ${describeChanges(n.mutator.changes).map(esc).join(', ')}`;
    if (!owned) html += `<br><i class="muted">Only has an effect once ${esc(mutatorAbilityName(n.mutator))} is learned.</i>`;
  }
  if (ab) html += `<br>${esc(ab.description)}<br><span class="muted">${ab.cost ? `${ab.cost} ${esc(CLASSES[ch.classId].resource.name)} · ` : ''}${ab.cooldown}s cooldown</span>`;
  if (lines.length) html += `<br>${lines.map(esc).join('<br>')}`;
  // exact ability numbers and minion stats as they would be right now (gear, tree, rank)
  try {
    if (n.type === 'ability') { html += abilityStatsHtml(ch, n.ability); if (isMinionAbility(ch, n.ability)) html += minionStatsHtml(ch, n.ability); }
    else if (n.type === 'rank') { html += abilityRankHtml(ch, n.rankFor); if (isMinionAbility(ch, n.rankFor)) html += minionRankHtml(ch, n.rankFor); }
    else if (Object.keys(n.stats || {}).some(k => k.startsWith('minion'))) html += minionNodeHtml(ch, n.id, set.has(n.id));
  } catch (e) { console.warn('minion preview', e); }
  // abilities with extra effects at higher ranks
  const reAb = n.type === 'rank' ? n.rankFor : n.type === 'ability' ? n.ability : null;
  for (const [r, re] of Object.entries(ABILITIES[reAb]?.rankEffects || {})) html += `<br><span class="${(ch.abilities[reAb] || 0) >= Number(r) ? 'up' : 'muted'}">▲ Rank ${r} — <b>${esc(re.name)}</b>: ${esc(re.description)}</span>`;
  if (n.type === 'rank' && !ch.abilities[n.rankFor]) html += `<br><i class="muted">Only has an effect once ${esc(ABILITIES[n.rankFor]?.name)} is learned.</i>`;
  const pi = planOf(ch).indexOf(n.id);
  if (planMode && !set.has(n.id)) {
    if (pi >= 0) html += `<br><span class="plan-text">Plan step ${pi + 1}</span><br><span class="muted">Click to remove it and every step after it</span>`;
    else { const k = planPathTo(ch, n.id).length; html += `<br><span class="plan-text">Click to add to the plan (+${k} node${k === 1 ? '' : 's'})</span>`; }
    return html;
  }
  if (pi >= 0) html += `<br><span class="plan-text">Planned (step ${pi + 1})</span>`;
  if (set.has(n.id)) {
    if (n.id !== 'start') html += `<br><span class="muted">${refundMode ? 'Click' : 'Right-click'} to refund (${fmt(treeRefundCost(ch))} gold)</span>`;
  } else {
    const cost = pathTo(ch, n.id).length;
    html += `<br><span class="${cost <= availablePoints(ch) ? 'up' : 'down'}">Cost: ${cost} point${cost === 1 ? '' : 's'}${cost <= availablePoints(ch) ? ' — click to allocate' : ' (not enough points)'}</span>`;
  }
  return html;
}

function nodeSvg(ch, n, set) {
  const st = nodeState(ch, n, set);
  const r = SIZE[n.type];
  const abilityId = n.ability;
  const cls = CLASSES[ch.classId];
  let inner = '';
  if (abilityId) {
    const url = assetUrl(`abilities/${abilityId}`);
    inner = url
      ? `<image href="${esc(url)}" x="${-r + 3}" y="${-r + 3}" width="${(r - 3) * 2}" height="${(r - 3) * 2}" clip-path="url(#clip-${n.type})" preserveAspectRatio="xMidYMid slice"/>`
      : `<text class="glyph" font-size="${r * 0.9}">${{ damage: '⚔', heal: '✚', buff: '▲', debuff: '▼', control: '✱', utility: '◆' }[ABILITIES[abilityId]?.type] || '★'}</text>`;
  } else if (n.type !== 'small') {
    const url = assetUrl(`skilltree/${n.type}`, n.type === 'rank' ? `abilities/${n.rankFor}` : null);
    inner = url ? `<image href="${esc(url)}" x="${-r + 2}" y="${-r + 2}" width="${(r - 2) * 2}" height="${(r - 2) * 2}" clip-path="url(#clip-${n.type})" preserveAspectRatio="xMidYMid slice" opacity=".9"/>`
      : `<text class="glyph" font-size="${r * 0.95}">${GLYPH[n.type]}</text>`;
  }
  const hex = Array.from({ length: 6 }, (_, k) => { const a = Math.PI / 6 + (k * Math.PI) / 3; return `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`; }).join(' ');
  const shape = n.type === 'mutator' ? `<polygon class="shape" points="${hex}"/>` : n.type === 'rank'
    ? `<rect class="shape" x="${-r}" y="${-r}" width="${r * 2}" height="${r * 2}" rx="3" transform="rotate(45)"/>`
    : `<circle class="shape" r="${r}"/>`;
  const label = (n.type === 'ability' || n.type === 'keystone' || n.type === 'notable' || n.type === 'mutator' || n.type === 'start') ? `<text class="label" y="${r + 13}">${esc(n.name)}</text>` : '';
  const match = search && (`${n.name} ${describeNodeStats(n.stats).join(' ')}`.toLowerCase().includes(search)) ? ' match' : '';
  const pi = st === 'on' ? -1 : planOf(ch).indexOf(n.id);
  const planTag = pi >= 0 && planMode ? `<text class="plan-num" y="${-r - 4}">${pi + 1}</text>` : '';
  return `<g class="node t-${n.type} s-${st}${match}${focusNode === n.id ? ' focus' : ''}${pi >= 0 ? ' planned' : ''}" data-node="${n.id}" transform="translate(${n.x} ${n.y})" style="--cc:${(n.subclass && SUBCLASSES[n.subclass]?.color) || cls.color}">
    <circle class="halo" r="${r + 6}"/>${shape}${inner}${label}${planTag}</g>`;
}

function svgHtml(ch) {
  const tree = getTree(ch.classId, ch.subclass);
  const set = allocatedSet(ch);
  const planSet = new Set(planOf(ch));
  const seen = new Set();
  const lines = [];
  for (const n of Object.values(tree.nodes)) {
    for (const l of n.links) {
      const k = n.id < l ? `${n.id}|${l}` : `${l}|${n.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const m = tree.nodes[l];
      const on = set.has(n.id) && set.has(l);
      const half = set.has(n.id) || set.has(l);
      const pl = !on && (planSet.has(n.id) || set.has(n.id)) && (planSet.has(l) || set.has(l));
      lines.push(`<line class="link ${on ? 'on' : half ? 'half' : ''}${pl ? ' planned' : ''}" data-a="${n.id}" data-b="${l}" x1="${n.x}" y1="${n.y}" x2="${m.x}" y2="${m.y}"/>`);
    }
  }
  const B = tree.branches.length;
  const R = tree.radius;
  const labels = tree.branches.map((name, b) => {
    const ang = -Math.PI / 2 + b * (2 * Math.PI) / B;
    const c = Math.cos(ang);
    const anchor = c > 0.5 ? 'start' : c < -0.5 ? 'end' : 'middle';
    const sub = tree.subclassBranches != null && b >= tree.subclassBranches ? SUBCLASSES[ch.subclass] : null;
    return `<text class="branch-label${sub ? ' sub' : ''}" text-anchor="${anchor}" x="${c * (R + 50)}" y="${Math.sin(ang) * (R + 62)}" ${sub ? `style="fill:${esc(sub.color || '#c9a24a')}"` : ''}>${sub ? `${esc(sub.glyph || '🌟')} ` : ''}${esc(name)}</text>`;
  }).join('');
  const rings = TREE_CONFIG.rings.map((_, i) => `<circle class="ring" r="${(i + 1) * TREE_CONFIG.ringSpacing}"/>`).join('');
  const clips = Object.entries(SIZE).map(([t, r]) => `<clipPath id="clip-${t}"><circle r="${r - (t === 'rank' ? 2 : 3)}"/></clipPath>`).join('');
  return `<svg class="tree-svg ${refundMode ? 'refund' : ''}" xmlns="http://www.w3.org/2000/svg">
    <defs>${clips}<radialGradient id="tree-bg"><stop offset="0" stop-color="#2a1a12"/><stop offset="1" stop-color="#0c0807" stop-opacity="0"/></radialGradient></defs>
    <circle r="${R + 120}" fill="url(#tree-bg)"/>
    ${rings}${labels}
    <g class="links">${lines.join('')}</g>
    <g class="nodes">${Object.values(tree.nodes).map(n => nodeSvg(ch, n, set)).join('')}</g>
  </svg>`;
}

function sidebarHtml(ch) {
  const avail = availablePoints(ch);
  const stats = treeStats(ch);
  const summary = describeNodeStats(stats);
  const owned = Object.entries(ch.abilities);
  const tree = getTree(ch.classId, ch.subclass);
  const allAbilities = Object.values(tree.nodes).filter(n => n.ability);
  return `
    <div class="tree-points ${avail > 0 ? 'has' : ''}"><span class="big-num">${avail}</span><span>skill point${avail === 1 ? '' : 's'} available</span><small class="muted">${spentPoints(ch)} / ${totalSkillPoints(ch)} spent${ch.isMain ? ` · hero: +1 bonus point every ${CONFIG.mainCharacter.bonusSkillPointEvery} levels` : ''}</small></div>
    <div class="row gap wrap">
      <button class="btn small ${avail ? 'primary' : ''}" data-auto ${avail ? '' : 'disabled'} ${tipAttr('Spend all available points automatically (prioritises abilities, then notables and your main attributes).')}>Auto-allocate</button>
      <button class="btn small ${refundMode ? 'danger' : ''}" data-refund-mode>${refundMode ? 'Refund mode: ON' : 'Refund mode'}</button>
      <button class="btn small ghost danger" data-reset>Reset tree (${fmt(treeResetCost(ch))}g)</button>
    </div>
    <div class="plan-box ${planMode ? 'on' : ''}">
      <div class="row gap"><b>📝 Planned build</b><span class="grow"></span><button class="btn tiny ${planMode ? 'primary' : ''}" data-plan-mode>${planMode ? 'Done planning' : 'Plan nodes'}</button></div>
      ${planOf(ch).length ? `<div class="small">${planOf(ch).length} node${planOf(ch).length === 1 ? '' : 's'} planned · ${planDoneLevel(ch) ? `complete at level ${planDoneLevel(ch)}` : `<span class="warn-text">needs more points than level ${CONFIG.levelCap} gives</span>`}</div>
        <div class="row gap"><button class="btn tiny ghost" data-plan-undo>Undo last</button><button class="btn tiny ghost danger" data-plan-clear>Clear plan</button></div>`
        : `<div class="small muted">${planMode ? 'Click nodes in the order you want them — the path to each node is added too.' : 'Plan your build up to level ' + CONFIG.levelCap + ': new skill points go to the planned nodes automatically, in order.'}</div>`}
      ${planMode ? '<div class="small faint">Click a planned node to remove it and every step after it. Builds save the plan.</div>' : ''}
    </div>
    <input class="tree-search" placeholder="Search nodes… (e.g. crit, Vitality, Fireball)" value="${esc(search)}">
    <h4>Abilities</h4>
    <div class="tree-abilities">${allAbilities.map(n => {
      const rank = ch.abilities[n.ability];
      return `<button class="tree-ab ${rank ? 'owned' : ''}" data-goto="${n.id}" ${tipAttr(`<b>${esc(ABILITIES[n.ability].name)}</b><br>${esc(ABILITIES[n.ability].description)}<br><span class='muted'>${rank ? `Rank ${rank}/${CONFIG.maxAbilityRank}` : `Not learned — ${pathTo(ch, n.id).length} point(s) away`}</span>`)}>${abilityIcon(n.ability, 'xs')}<span>${esc(ABILITIES[n.ability].name)}</span><small>${rank ? `R${rank}` : pathTo(ch, n.id).length + 'pt'}</small></button>`;
    }).join('')}</div>
    <h4>Tree bonuses</h4>
    ${summary.length ? `<ul class="tree-summary">${summary.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : '<p class="muted small">Allocate nodes to gain attributes and bonuses.</p>'}
    ${(() => {
      const muts = allocatedSet(ch).size ? [...allocatedSet(ch)].map(id => tree.nodes[id]).filter(n => n?.mutator) : [];
      if (!ch.subclass) return '';
      const all = Object.values(tree.nodes).filter(n => n.mutator);
      return `<h4>Ability mutators</h4><div class="mut-list">${all.map(n => {
        const on = muts.includes(n);
        return `<button class="mut-chip ${on ? 'on' : ''}" data-goto="${n.id}" ${tipAttr(`<b>${esc(n.name)}</b><br>${esc(n.description)}<br>${describeChanges(n.mutator.changes).map(esc).join(', ')}`)}>✦ <b>${esc(n.name)}</b> <small>${esc(mutatorAbilityName(n.mutator))}</small></button>`;
      }).join('')}</div>`;
    })()}
    <div class="tree-legend small muted">
      <span><i class="lg start"></i>Origin</span><span><i class="lg ability"></i>Ability</span><span><i class="lg rank"></i>Ability rank</span>
      <span><i class="lg notable"></i>Notable</span><span><i class="lg keystone"></i>Keystone</span>${ch.subclass ? '<span><i class="lg mutator"></i>Ability mutator</span>' : ''}<span><i class="lg small"></i>Attribute</span>
    </div>
    <p class="muted small">Drag to pan · scroll to zoom · hover a node to preview the path · ${owned.length} abilities learned.</p>`;
}

function highlightPath(root, ids) {
  root.querySelectorAll('.node.path, .link.path').forEach(e => e.classList.remove('path'));
  hoverPath = ids;
  if (!ids.length) return;
  const set = new Set(ids);
  const ch = selectedChar();
  const own = allocatedSet(ch);
  for (const id of ids) root.querySelector(`.node[data-node="${id}"]`)?.classList.add('path');
  root.querySelectorAll('.link').forEach(l => {
    const a = l.dataset.a, b = l.dataset.b;
    if ((set.has(a) && (set.has(b) || own.has(b))) || (set.has(b) && own.has(a))) l.classList.add('path');
  });
}

function centerOn(nodeId, ch) {
  const n = getTree(ch.classId, ch.subclass).nodes[nodeId];
  if (n) { view.x = n.x; view.y = n.y; view.w = Math.min(view.w, 900); }
}

export const skilltreeView = {
  id: 'skilltree', label: 'Skill Tree', icon: '✺',
  mount(root) {
    lastSig = null;
    if (focusNode) view = null;
    bindPicker(root, () => { lastSig = null; view = null; this.render(root); });
    bindBuilds(root, selectedChar);
    const svgPoint = (svg, e) => {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      return pt.matrixTransform(svg.getScreenCTM().inverse());
    };
    root.addEventListener('wheel', e => {
      const svg = e.target.closest('.tree-svg');
      if (!svg) return;
      e.preventDefault();
      const p = svgPoint(svg, e);
      const f = Math.exp(e.deltaY * 0.0012);
      const nw = Math.min(2400, Math.max(260, view.w * f));
      const k = nw / view.w;
      view.x = p.x - (p.x - view.x) * k;
      view.y = p.y - (p.y - view.y) * k;
      view.w = nw;
      applyViewBox(svg);
    }, { passive: false });
    root.addEventListener('pointerdown', e => {
      const svg = e.target.closest('.tree-svg');
      if (!svg || e.button === 2) return;
      drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false, id: e.pointerId };
    });
    window.addEventListener('pointermove', this._move = e => {
      if (!drag || e.pointerId !== drag.id) return;
      const svg = root.querySelector('.tree-svg');
      if (!svg) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
      if (!drag.moved) return;
      const scale = view.w / svg.getBoundingClientRect().width;
      view.x = drag.vx - dx * scale;
      view.y = drag.vy - dy * scale;
      applyViewBox(svg);
    });
    window.addEventListener('pointerup', this._up = () => { setTimeout(() => { drag = null; }, 0); });

    root.addEventListener('mouseover', e => {
      const g = e.target.closest('.node');
      const ch = selectedChar();
      if (!g || !ch) { if (!e.target.closest('.node')) highlightPath(root, []); return; }
      const set = allocatedSet(ch);
      const n = getTree(ch.classId, ch.subclass).nodes[g.dataset.node];
      g.dataset.tip = nodeTip(ch, n, set);
      highlightPath(root, set.has(n.id) || (planMode && planOf(ch).includes(n.id)) ? [] : planMode ? planPathTo(ch, n.id) : pathTo(ch, n.id));
    });

    const doRefund = async (ch, nodeId) => {
      const err = canRefund(ch, nodeId);
      if (err) return toast(err, 'error');
      const n = getTree(ch.classId, ch.subclass).nodes[nodeId];
      if (await confirmBox(`Refund "${n.name}" for ${fmt(treeRefundCost(ch))} gold?`, 'Refund')) await run(act('refund_node', { charId: ch.id, nodeId }), 'Node refunded.');
    };
    root.addEventListener('contextmenu', async e => {
      const g = e.target.closest('.node');
      if (!g) return;
      e.preventDefault();
      const ch = selectedChar();
      if (allocatedSet(ch).has(g.dataset.node)) await doRefund(ch, g.dataset.node);
    });
    root.addEventListener('click', async e => {
      const ch = selectedChar();
      if (!ch) return;
      const t = e.target;
      const g = t.closest('.node');
      if (g) {
        if (drag?.moved) return;
        const id = g.dataset.node;
        if (planMode) {
          if (allocatedSet(ch).has(id)) return;
          const plan = planOf(ch), i = plan.indexOf(id);
          const next = i >= 0 ? plan.slice(0, i) : [...plan, ...planPathTo(ch, id)];
          const r = await run(act('tree_plan_set', { charId: ch.id, plan: next }));
          if (r?.allocated) toast(`${r.allocated} free point${r.allocated === 1 ? '' : 's'} spent on the plan.`, 'success');
          return;
        }
        if (allocatedSet(ch).has(id)) { if (refundMode) await doRefund(ch, id); return; }
        const path = pathTo(ch, id);
        if (!path.length) return;
        if (path.length > availablePoints(ch)) return toast(`Needs ${path.length} points — you have ${availablePoints(ch)}.`, 'error');
        await run(act('allocate_nodes', { charId: ch.id, nodeIds: path }));
        return;
      }
      const b = t.closest('button');
      if (!b) return;
      if ('auto' in b.dataset) await run(act('auto_tree', { charId: ch.id }), 'Points allocated.');
      if ('refundMode' in b.dataset) { refundMode = !refundMode; planMode = false; lastSig = null; this.render(root); }
      if ('planMode' in b.dataset) { planMode = !planMode; refundMode = false; lastSig = null; this.render(root); }
      if ('planUndo' in b.dataset) await run(act('tree_plan_set', { charId: ch.id, plan: planOf(ch).slice(0, -1) }));
      if ('planClear' in b.dataset && await confirmBox('Clear the planned build? Nodes you already have stay.', 'Clear plan')) await run(act('tree_plan_set', { charId: ch.id, plan: [] }));
      if ('reset' in b.dataset && await confirmBox(`Reset ${ch.name}'s whole skill tree for ${fmt(treeResetCost(ch))} gold? All points are returned.`, 'Reset tree')) await run(act('reset_tree', { charId: ch.id }), 'Skill tree reset.');
      if (b.dataset.goto) {
        centerOn(b.dataset.goto, ch);
        focusNode = b.dataset.goto;
        lastSig = null;
        this.render(root);
      }
      if (b.dataset.zoom) {
        view.w = Math.min(2400, Math.max(260, view.w * Number(b.dataset.zoom)));
        applyViewBox(root.querySelector('.tree-svg'));
      }
      if ('recenter' in b.dataset) { view = null; focusNode = null; lastSig = null; this.render(root); }
    });
    root.addEventListener('input', e => {
      if (!e.target.matches('.tree-search')) return;
      search = e.target.value.trim().toLowerCase();
      const ch = selectedChar();
      const tree = getTree(ch.classId, ch.subclass);
      root.querySelectorAll('.node').forEach(g => {
        const n = tree.nodes[g.dataset.node];
        g.classList.toggle('match', !!search && `${n.name} ${describeNodeStats(n.stats).join(' ')}`.toLowerCase().includes(search));
      });
    });
    this._resize = () => { const svg = root.querySelector('.tree-svg'); if (svg && view) applyViewBox(svg); };
    window.addEventListener('resize', this._resize);
  },
  unmount() {
    window.removeEventListener('pointermove', this._move);
    window.removeEventListener('pointerup', this._up);
    window.removeEventListener('resize', this._resize);
    lastSig = null;
    focusNode = null;
  },
  render(root) {
    const ch = selectedChar();
    if (!ch) return;
    const sig = treeSig(ch);
    if (!root.querySelector('.tree-layout')) {
      root.innerHTML = `<div class="tree-picker"></div>
        <div class="tree-layout">
          <div class="panel tree-canvas"><div class="tree-svg-host"></div>
            <div class="tree-zoom"><button class="icon-btn" data-zoom="0.8" title="Zoom in">＋</button><button class="icon-btn" data-zoom="1.25" title="Zoom out">－</button><button class="icon-btn" data-recenter title="Reset view">⌂</button></div>
          </div>
          <div class="panel tree-side"></div>
        </div>`;
    }
    morphed(root.querySelector('.tree-picker')).innerHTML = charPicker(ch.id) + buildsBar(ch);
    const side = root.querySelector('.tree-side');
    morphed(side).innerHTML = sidebarHtml(ch);
    if (sig !== lastSig) {
      lastSig = sig;
      const host = root.querySelector('.tree-svg-host');
      host.innerHTML = svgHtml(ch);
      const svg = host.querySelector('svg');
      if (!view) {
        const d = getTree(ch.classId, ch.subclass).radius * 2 + 260;
        const r = svg.getBoundingClientRect();
        view = { x: 0, y: 0, w: Math.max(d + 360, d * r.width / Math.max(1, r.height)) };
        if (focusNode) centerOn(focusNode, ch);
      }
      requestAnimationFrame(() => applyViewBox(svg));
      applyViewBox(svg);
      if (hoverPath.length) highlightPath(root, hoverPath.filter(id => !allocatedSet(ch).has(id)));
    }
  },
};
