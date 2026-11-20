// Skill tree rules: points, allocation, refunds, derived abilities/stats and auto-allocation.
// Shared by server (authoritative validation) and client (previews).
import { CONFIG } from './config.js';
import { CLASSES } from './data/classes.js';
import { getTree, TREE_CONFIG } from './data/skilltree.js';
import { SUBCLASSES } from './data/subclasses.js';
import { ABILITIES } from './data/abilities.js';
import { applyMutators } from './mutators.js';

export { getTree };

export function totalSkillPoints(ch) {
  const every = CONFIG.mainCharacter.bonusSkillPointEvery;
  const ascended = ch.subclass ? CONFIG.ascension?.bonusSkillPoints || 0 : 0; // ascended heroes get extra points
  return ch.level * CONFIG.skillPointsPerLevel + (ch.isMain && every ? Math.floor(ch.level / every) : 0) + ascended;
}

export function allocatedSet(ch) { return new Set(ch.tree?.allocated || ['start']); }
export function spentPoints(ch) { return Math.max(0, allocatedSet(ch).size - 1); }
export function availablePoints(ch) { return totalSkillPoints(ch) - spentPoints(ch); }

export function canAllocate(ch, nodeId) {
  const tree = getTree(ch.classId, ch.subclass);
  const node = tree.nodes[nodeId];
  if (!node) return 'Unknown node';
  const set = allocatedSet(ch);
  if (set.has(nodeId)) return 'Already allocated';
  if (availablePoints(ch) < 1) return 'No skill points left';
  if (!node.links.some(l => set.has(l))) return 'Node is not connected to your tree';
  return null;
}

// Shortest path (list of unallocated node ids, in order) from the current tree to nodeId.
export function pathTo(ch, nodeId) {
  const tree = getTree(ch.classId, ch.subclass);
  const set = allocatedSet(ch);
  if (!tree.nodes[nodeId] || set.has(nodeId)) return [];
  const prev = new Map();
  const queue = [...set];
  const seen = new Set(set);
  while (queue.length) {
    const cur = queue.shift();
    for (const l of tree.nodes[cur].links) {
      if (seen.has(l)) continue;
      seen.add(l);
      prev.set(l, cur);
      if (l === nodeId) {
        const path = [l];
        let p = cur;
        while (!set.has(p)) { path.unshift(p); p = prev.get(p); }
        return path;
      }
      queue.push(l);
    }
  }
  return [];
}

function stillConnected(tree, set) {
  const seen = new Set(['start']);
  const stack = ['start'];
  while (stack.length) for (const l of tree.nodes[stack.pop()].links) if (set.has(l) && !seen.has(l)) { seen.add(l); stack.push(l); }
  return seen.size === set.size;
}

export function canRefund(ch, nodeId) {
  if (nodeId === 'start') return 'The origin cannot be refunded';
  const set = allocatedSet(ch);
  if (!set.has(nodeId)) return 'Node is not allocated';
  set.delete(nodeId);
  if (!stillConnected(getTree(ch.classId, ch.subclass), set)) return 'Refunding this node would disconnect other nodes';
  return null;
}

// Mutating operations (throw on invalid). Callers must run syncTree afterwards.
export function allocateNode(ch, nodeId) {
  const err = canAllocate(ch, nodeId);
  if (err) throw new Error(err);
  ch.tree.allocated.push(nodeId);
}
export function refundNode(ch, nodeId) {
  const err = canRefund(ch, nodeId);
  if (err) throw new Error(err);
  ch.tree.allocated = ch.tree.allocated.filter(n => n !== nodeId);
}
export function resetTree(ch) { ch.tree = { allocated: ['start'] }; }

// Drops unknown / disconnected nodes and over-spent points (e.g. after a tree layout change).
export function sanitizeTree(ch) {
  const tree = getTree(ch.classId, ch.subclass);
  if (!ch.tree || !Array.isArray(ch.tree.allocated)) ch.tree = { allocated: ['start'] };
  let list = ['start', ...ch.tree.allocated.filter(n => n !== 'start' && tree.nodes[n])];
  list = [...new Set(list)];
  // keep only nodes connected to start, in allocation order, and within the point budget
  const keep = ['start'];
  const set = new Set(keep);
  let progress = true;
  while (progress) {
    progress = false;
    for (const n of list) {
      if (set.has(n) || keep.length - 1 >= totalSkillPoints(ch)) continue;
      if (tree.nodes[n].links.some(l => set.has(l))) { keep.push(n); set.add(n); progress = true; }
    }
  }
  ch.tree.allocated = keep;
}

// Abilities (id -> rank) granted by the allocated nodes
export function treeAbilities(ch) {
  const tree = getTree(ch.classId, ch.subclass);
  const out = {};
  for (const id of allocatedSet(ch)) {
    const n = tree.nodes[id];
    if (n?.ability) out[n.ability] = Math.max(out[n.ability] || 0, 1);
  }
  for (const id of allocatedSet(ch)) {
    const r = tree.nodes[id]?.stats?.rank;
    if (r) for (const [a, v] of Object.entries(r)) if (out[a]) out[a] = Math.min(CONFIG.maxAbilityRank, out[a] + v);
  }
  return out;
}

// Summed passive stats of the allocated nodes (excluding ranks), plus the subclass's permanent bonus
export function treeStats(ch) {
  const tree = getTree(ch.classId, ch.subclass);
  const out = {};
  for (const [k, v] of Object.entries((ch.subclass && SUBCLASSES[ch.subclass]?.bonus) || {})) out[k] = (out[k] || 0) + v;
  for (const id of allocatedSet(ch)) {
    for (const [k, v] of Object.entries(tree.nodes[id]?.stats || {})) {
      if (k === 'rank') continue;
      out[k] = (out[k] || 0) + v;
    }
  }
  return out;
}

// Ability mutators from allocated subclass nodes: { abilityId: [changes, …] }
export function treeMutators(ch) {
  if (!ch.subclass) return {};
  const tree = getTree(ch.classId, ch.subclass);
  const out = {};
  for (const id of allocatedSet(ch)) {
    const m = tree.nodes[id]?.mutator;
    if (m) (out[m.ability] ||= []).push(m.changes);
  }
  return out;
}
// The abilities of a character as they work in combat (only the mutated ones): { abilityId: ability }
// rank effects: "rankEffects": { "<rank>": { name, description, changes } } on an ability — extra effects that unlock
// at that ability rank (same change format as mutators)
export function rankEffectsOf(abilityId, rank) {
  return Object.entries(ABILITIES[abilityId]?.rankEffects || {}).filter(([r]) => rank >= Number(r)).map(([r, e]) => ({ rank: Number(r), ...e }));
}
export function mutatedAbilities(ch) {
  const out = {};
  const sets = treeMutators(ch);
  for (const [a, rank] of Object.entries(ch.abilities || {})) {
    const extra = rankEffectsOf(a, rank).map(e => e.changes || {});
    if (extra.length) sets[a] = [...(sets[a] || []), ...extra];
  }
  for (const [a, list] of Object.entries(sets)) if (ABILITIES[a]) out[a] = applyMutators(ABILITIES[a], list);
  return out;
}

// ------------------------------------------------------------------ auto allocation (companions)
function nodeValue(ch, node, owned) {
  const g = CLASSES[ch.classId].growth;
  const maxG = Math.max(...Object.values(g));
  if (node.type === 'ability') return owned[node.ability] ? 0 : 120;
  if (node.type === 'rank') return owned[node.rankFor] ? 45 : 8;
  if (node.type === 'keystone') return 60;
  if (node.type === 'mutator') return owned[node.mutator.ability] ? 55 : 6;
  if (node.type === 'notable') return 40;
  let v = 0;
  for (const [k, amt] of Object.entries(node.stats)) v += ((g[k] || 0) / maxG) * amt * 2.5;
  return v;
}

// Spends all available points greedily on the best value-per-point target.
export function autoAllocate(ch) {
  const tree = getTree(ch.classId, ch.subclass);
  let guard = 200;
  while (availablePoints(ch) > 0 && guard-- > 0) {
    const set = allocatedSet(ch);
    const owned = treeAbilities(ch);
    // BFS distances from the tree
    const dist = new Map(), prev = new Map();
    const q = [...set];
    for (const s of set) dist.set(s, 0);
    while (q.length) {
      const cur = q.shift();
      for (const l of tree.nodes[cur].links) {
        if (dist.has(l)) continue;
        dist.set(l, dist.get(cur) + 1);
        prev.set(l, cur);
        q.push(l);
      }
    }
    let best = null, bestScore = -1;
    for (const [id, d] of dist) {
      if (d === 0 || d > availablePoints(ch) + 6) continue;
      const score = nodeValue(ch, tree.nodes[id], owned) / Math.pow(d, 1.15);
      if (score > bestScore || (score === bestScore && id < best)) { bestScore = score; best = id; }
    }
    if (!best) break;
    let step = best;
    while (!set.has(prev.get(step))) step = prev.get(step);
    ch.tree.allocated.push(step);
  }
}

export { TREE_CONFIG };
