// Passive skill trees (Path of Exile style) — specs in content/skilltree.json. Every class has its own web-shaped tree:
// you start in the middle and spend one point per level on any node connected to what you already own.
//
// The layout is GENERATED deterministically from the compact specs below, so it is easy to tweak:
//   - branches:   4 themed sectors around the centre
//   - attrs:      [primary, secondary] theme of the small nodes in that branch: an attribute (str/dex/int/vit) or
//                 crit / speed (% increased critical chance / attack speed — for classes an attribute wouldn't help)
//   - abilities:  { ring: abilityId } — ability nodes (ring 1 = closest to the centre)
//   - notables:   { ring: { name, stats } } — bigger passive nodes (ring 8 = outer keystone)
// Node ids are stable as long as RINGS and the branch count stay the same (saves reference them).
//
// Supported node stats:
//   str, int, dex, vit (flat attributes)  ·  strPct, intPct, dexPct, vitPct, allPct
//   physPowerPct, magPowerPct, healPowerPct, defensePct, hpPct  ·  critChance, critDamage, attackSpeed
//   damagePct, healingPct, damageTakenPct (combat)  ·  rank: { abilityId: +ranks }
import { ABILITIES } from './abilities.js';
import { SUBCLASSES } from './subclasses.js';

import { CONTENT, onContentReload } from '../content.js';

export const TREE_CONFIG = CONTENT.skilltree.config;
export const TREE_SPECS = CONTENT.skilltree.specs;
const ATTR_NAMES = CONTENT.skilltree.attributeNames;
// branch themes that aren't attributes: crit / speed → [stat, value of a full small node]
const SMALL_STATS = CONTENT.skilltree.config.smallNodeStats || { crit: ['critChance', 0.08], speed: ['attackSpeed', 0.02] };

// --------------------------------------------------------------------------- generator
const cache = new Map();
onContentReload(() => cache.clear());

// An ascended hero's tree is the class tree plus the branches of its subclass (node ids of the class
// branches stay the same; the extra branches get the next branch numbers).
export function getTree(classId, subclassId = null) {
  const sub = subclassId && SUBCLASSES[subclassId]?.classId === classId ? SUBCLASSES[subclassId] : null;
  const key = sub ? `${classId}:${sub.id}` : classId;
  if (cache.has(key)) return cache.get(key);
  const spec = TREE_SPECS[classId];
  if (!spec) return null;
  const tree = buildTree(sub ? { ...spec, branches: [...spec.branches, ...sub.branches.map(b => ({ ...b, subclass: sub.id }))] } : spec);
  if (sub) tree.subclassBranches = spec.branches.length; // branches from this index on belong to the subclass
  cache.set(key, tree);
  return tree;
}

function buildTree(spec) {
  const { rings, ringSpacing, smallNodeValue, bridgeRings, lateralRings } = TREE_CONFIG;
  const B = spec.branches.length;
  const nodes = {};
  const link = (a, b) => {
    if (a === b) return;
    if (!nodes[a].links.includes(b)) nodes[a].links.push(b);
    if (!nodes[b].links.includes(a)) nodes[b].links.push(a);
  };
  const id = (b, r, i) => `b${b}r${r}n${i}`;

  nodes.start = { id: 'start', type: 'start', x: 0, y: 0, ring: 0, branch: -1, links: [], stats: {}, ability: spec.start, name: 'Origin' };

  const sector = (2 * Math.PI) / B;
  for (let b = 0; b < B; b++) {
    const center = -Math.PI / 2 + b * sector;
    rings.forEach((m, ri) => {
      const r = ri + 1;
      for (let i = 0; i < m; i++) {
        const pos = (i + 0.5) / m;
        const ang = center + (pos - 0.5) * sector * 0.8;
        const rad = r * ringSpacing;
        nodes[id(b, r, i)] = { id: id(b, r, i), type: 'small', ring: r, branch: b, index: i, pos, x: Math.round(Math.cos(ang) * rad), y: Math.round(Math.sin(ang) * rad), links: [], stats: {} };
      }
    });
  }

  // ---- edges
  for (let b = 0; b < B; b++) {
    link('start', id(b, 1, 0));
    for (let r = 1; r < rings.length; r++) {
      const inner = rings[r - 1], outer = rings[r];
      const nearest = (pos, m) => Math.min(m - 1, Math.max(0, Math.round(pos * m - 0.5)));
      for (let j = 0; j < outer; j++) link(id(b, r + 1, j), id(b, r, nearest((j + 0.5) / outer, inner)));
      for (let i = 0; i < inner; i++) link(id(b, r, i), id(b, r + 1, nearest((i + 0.5) / inner, outer)));
    }
    for (const r of lateralRings) for (let i = 0; i + 1 < rings[r - 1]; i++) link(id(b, r, i), id(b, r, i + 1));
    for (const r of bridgeRings) link(id(b, r, rings[r - 1] - 1), id((b + 1) % B, r, 0));
  }

  // ---- content: abilities & notables
  const mid = r => Math.floor(rings[r - 1] / 2);
  spec.branches.forEach((br, b) => {
    for (const [r, n] of Object.entries(br.notables || {})) {
      const node = nodes[id(b, +r, mid(+r))];
      node.type = +r === rings.length ? 'keystone' : 'notable';
      node.name = n.name;
      node.stats = { ...n.stats };
    }
    for (const [r, abilityId] of Object.entries(br.abilities || {})) {
      let i = mid(+r);
      if (nodes[id(b, +r, i)].type !== 'small') i = Math.max(0, i - 1);
      const node = nodes[id(b, +r, i)];
      node.type = 'ability';
      node.ability = abilityId;
      node.name = ABILITIES[abilityId]?.name || abilityId;
    }
  });

  // ---- branch masteries: a mid-size notable on ring 6 of every branch
  spec.branches.forEach((br, b) => {
    const r = 6;
    const cands = [mid(r), mid(r) - 1, mid(r) + 1].filter(i => i >= 0 && i < rings[r - 1]);
    const i = cands.find(k => nodes[id(b, r, k)].type === 'small');
    if (i === undefined) return;
    const [p, s] = br.attrs;
    const node = nodes[id(b, r, i)];
    node.type = 'notable';
    node.name = `${br.name} Mastery`;
    // attribute % — or, for a crit/speed theme, twice a small node of it
    const pctOf = (a, f) => (SMALL_STATS[a] ? { [SMALL_STATS[a][0]]: SMALL_STATS[a][1] * 2 * f } : { [a + 'Pct']: 0.08 * f });
    node.stats = p === s ? pctOf(p, 1) : { ...pctOf(p, 0.75), ...pctOf(s, 0.375) };
  });

  // ---- ability mutators (subclass branches): change a base ability, placed near the middle of their ring
  spec.branches.forEach((br, b) => {
    for (const [r, m] of Object.entries(br.mutators || {})) {
      const ring = +r, cnt = rings[ring - 1];
      if (!cnt) continue;
      const order = Array.from({ length: cnt }, (_, i) => i).sort((x, y) => Math.abs(x - mid(ring)) - Math.abs(y - mid(ring)) || x - y);
      const i = order.find(k => nodes[id(b, ring, k)].type === 'small');
      if (i === undefined) continue;
      const node = nodes[id(b, ring, i)];
      node.type = 'mutator';
      node.name = m.name;
      node.description = m.description || '';
      node.mutator = { ability: m.ability, changes: m.changes || {} };
      node.stats = {};
    }
  });

  // ---- "Empowered" rank nodes: nearest free small nodes next to every ability (prefer outward)
  const abilityNodes = Object.values(nodes).filter(n => n.ability);
  for (const an of abilityNodes) {
    let placed = 0;
    let frontier = [an.id];
    const seen = new Set(frontier);
    while (placed < TREE_CONFIG.rankNodesPerAbility && frontier.length) {
      const next = [];
      for (const fid of frontier) for (const l of nodes[fid].links) if (!seen.has(l)) { seen.add(l); next.push(l); }
      next.sort((a, c) => nodes[c].ring - nodes[a].ring || a.localeCompare(c));
      for (const nid of next) {
        const n = nodes[nid];
        if (n.type !== 'small' || n.rankFor || placed >= TREE_CONFIG.rankNodesPerAbility) continue;
        if (an.type !== 'start' && n.ring < an.ring) continue;
        n.type = 'rank';
        n.rankFor = an.ability;
        n.name = `Empowered ${ABILITIES[an.ability]?.name || an.ability}`;
        n.stats = { rank: { [an.ability]: 1 } };
        placed++;
      }
      frontier = next;
    }
  }

  // ---- small attribute nodes
  for (const n of Object.values(nodes)) {
    if (n.type !== 'small') continue;
    const [p, s] = spec.branches[n.branch].attrs;
    const k = (n.ring + n.index) % 3;
    // a theme is an attribute (flat points) or crit / speed (% increased critical chance / attack speed)
    const give = (a, half) => (SMALL_STATS[a] ? { [SMALL_STATS[a][0]]: SMALL_STATS[a][1] * (half ? 0.5 : 1) } : { [a]: half ? Math.ceil(smallNodeValue / 2) : smallNodeValue });
    if (k === 2 && p !== s) n.stats = { ...give(p, true), ...give(s, true) };
    else n.stats = give(k === 1 ? s : p, false);
    n.name = (p !== s && k === 2 ? [p, s] : [k === 1 ? s : p]).map(a => ATTR_NAMES[a]).join(' & ');
  }
  for (const n of Object.values(nodes)) { n.links.sort(); if (spec.branches[n.branch]?.subclass) n.subclass = spec.branches[n.branch].subclass; }
  return { nodes, start: 'start', branches: spec.branches.map(b => b.name), radius: rings.length * ringSpacing };
}

export const TREE_STAT_LABELS = CONTENT.skilltree.statLabels;

export function describeNodeStats(stats) {
  const out = [];
  for (const [k, v] of Object.entries(stats || {})) {
    if (k === 'rank') { for (const [a, n] of Object.entries(v)) out.push(`+${n} rank to ${ABILITIES[a]?.name || a}`); continue; }
    const [label, kind] = TREE_STAT_LABELS[k] || [k, 'flat'];
    if (kind === 'text') { if (v) out.push(label.replace('{v}', v)); continue; } // a mechanic flag, not a number ({v}: its value)
    out.push(kind === 'pct' ? `${v > 0 ? '+' : ''}${Math.round(v * 100)}% ${label}` : `+${v} ${label}`);
  }
  return out;
}
