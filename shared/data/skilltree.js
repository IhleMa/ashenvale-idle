// Passive skill trees (Path of Exile style). Every class has its own web-shaped tree:
// you start in the middle and spend one point per level on any node connected to what you already own.
//
// The layout is GENERATED deterministically from the compact specs below, so it is easy to tweak:
//   - branches:   4 themed sectors around the centre
//   - attrs:      [primary, secondary] attribute of the small nodes in that branch
//   - abilities:  { ring: abilityId } — ability nodes (ring 1 = closest to the centre)
//   - notables:   { ring: { name, stats } } — bigger passive nodes (ring 8 = outer keystone)
// Node ids are stable as long as RINGS and the branch count stay the same (saves reference them).
//
// Supported node stats:
//   str, int, dex, vit (flat attributes)  ·  strPct, intPct, dexPct, vitPct, allPct
//   physPowerPct, magPowerPct, healPowerPct, defensePct, hpPct  ·  critChance, critDamage, attackSpeed
//   damagePct, healingPct, damageTakenPct (combat)  ·  rank: { abilityId: +ranks }
import { ABILITIES } from './abilities.js';

export const TREE_CONFIG = {
  rings: [1, 2, 3, 3, 4, 4, 5, 5],  // nodes per branch on each ring (ring 1..8)
  ringSpacing: 95,
  smallNodeValue: 4,                 // attribute points per small node
  bridgeRings: [3, 5, 7],            // rings where neighbouring branches connect
  lateralRings: [2, 4, 6, 8],        // rings where nodes inside a branch connect sideways
  rankNodesPerAbility: 2,            // "Empowered X" nodes generated next to each ability
};

const N = (name, stats) => ({ name, stats });

export const TREE_SPECS = {
  warrior: {
    start: 'heroic_strike',
    branches: [
      { name: 'Bulwark', attrs: ['vit', 'str'], abilities: { 1: 'taunt', 3: 'shield_wall' },
        notables: { 4: N('Iron Skin', { defensePct: 0.12, hpPct: 0.05 }), 8: N('Unbreakable', { hpPct: 0.15, damageTakenPct: -0.06 }) } },
      { name: 'Warmonger', attrs: ['str', 'dex'], abilities: { 2: 'cleave', 6: 'battle_cry' },
        notables: { 4: N('Brutality', { physPowerPct: 0.10 }), 8: N('Bloodlust', { damagePct: 0.10, critDamage: 0.2 }) } },
      { name: 'Tactician', attrs: ['dex', 'str'], abilities: { 3: 'shield_bash' },
        notables: { 4: N('Precision', { critChance: 0.04 }), 8: N('Relentless', { attackSpeed: 0.10, critChance: 0.02 }) } },
      { name: 'Vanguard', attrs: ['vit', 'dex'], abilities: { 5: 'sunder_armor' },
        notables: { 4: N('Second Wind', { hpPct: 0.08, defensePct: 0.05 }), 8: N("Warlord's Presence", { allPct: 0.05 }) } },
    ],
  },
  mage: {
    start: 'fireball',
    branches: [
      { name: 'Pyromancy', attrs: ['int', 'vit'], abilities: { 2: 'flame_wave', 7: 'meteor' },
        notables: { 4: N('Kindling', { magPowerPct: 0.10 }), 8: N('Heart of Fire', { damagePct: 0.12 }) } },
      { name: 'Cryomancy', attrs: ['int', 'dex'], abilities: { 1: 'frost_bolt', 5: 'frost_nova' },
        notables: { 4: N('Cold Precision', { critChance: 0.04 }), 8: N('Absolute Zero', { critDamage: 0.3, critChance: 0.02 }) } },
      { name: 'Arcana', attrs: ['int', 'dex'], abilities: { 3: 'arcane_missiles', 6: 'arcane_power' },
        notables: { 4: N('Arcane Flow', { attackSpeed: 0.06 }), 8: N('Archmage', { magPowerPct: 0.15 }) } },
      { name: 'Wardings', attrs: ['vit', 'int'], abilities: {},
        notables: { 4: N('Mana Shield', { hpPct: 0.10 }), 8: N('Spellward', { damageTakenPct: -0.08, defensePct: 0.2 }) } },
    ],
  },
  rogue: {
    start: 'backstab',
    branches: [
      { name: 'Venom', attrs: ['dex', 'int'], abilities: { 1: 'poison_blade', 5: 'rupture' },
        notables: { 4: N('Toxicology', { damagePct: 0.06, physPowerPct: 0.04 }), 8: N('Plaguebringer', { damagePct: 0.12 }) } },
      { name: 'Assassination', attrs: ['dex', 'str'], abilities: { 3: 'execute', 7: 'shadow_flurry' },
        notables: { 4: N('Deadly Aim', { critChance: 0.05 }), 8: N("Assassin's Mark", { critDamage: 0.35 }) } },
      { name: 'Shadows', attrs: ['dex', 'vit'], abilities: { 2: 'evasion', 6: 'expose_weakness' },
        notables: { 4: N('Fleet Footed', { attackSpeed: 0.08 }), 8: N('Shadow Dance', { attackSpeed: 0.10, critChance: 0.03 }) } },
      { name: 'Survival', attrs: ['vit', 'str'], abilities: {},
        notables: { 4: N('Thick Skin', { hpPct: 0.10 }), 8: N('Cheat Death', { damageTakenPct: -0.08, hpPct: 0.08 }) } },
    ],
  },
  cleric: {
    start: 'heal',
    branches: [
      { name: 'Restoration', attrs: ['int', 'vit'], abilities: { 1: 'renew', 5: 'prayer_of_healing' },
        notables: { 4: N('Mending', { healPowerPct: 0.10 }), 8: N('Saintly Grace', { healingPct: 0.15 }) } },
      { name: 'Holy Fire', attrs: ['int', 'str'], abilities: { 1: 'smite' },
        notables: { 4: N('Zeal', { magPowerPct: 0.10 }), 8: N('Wrath of Heaven', { damagePct: 0.15 }) } },
      { name: 'Protection', attrs: ['vit', 'int'], abilities: { 3: 'power_word_barrier', 7: 'divine_blessing' },
        notables: { 4: N('Sanctuary', { defensePct: 0.15 }), 8: N('Aegis', { hpPct: 0.15 }) } },
      { name: 'Purity', attrs: ['int', 'dex'], abilities: { 2: 'purify' },
        notables: { 4: N('Clarity', { attackSpeed: 0.06 }), 8: N('Divine Favor', { critChance: 0.05, healingPct: 0.06 }) } },
    ],
  },
  ranger: {
    start: 'aimed_shot',
    branches: [
      { name: 'Marksmanship', attrs: ['dex', 'str'], abilities: { 3: 'hunters_mark', 7: 'kill_shot' },
        notables: { 4: N('Steady Aim', { critChance: 0.04 }), 8: N('Deadeye', { critDamage: 0.35 }) } },
      { name: 'Barrage', attrs: ['dex', 'vit'], abilities: { 2: 'multi_shot', 6: 'volley' },
        notables: { 4: N('Barbed Arrows', { physPowerPct: 0.08 }), 8: N('Arrowstorm', { damagePct: 0.10 }) } },
      { name: 'Wilds', attrs: ['dex', 'int'], abilities: { 1: 'serpent_sting' },
        notables: { 4: N('Venomcraft', { damagePct: 0.06 }), 8: N('Apex Predator', { physPowerPct: 0.12 }) } },
      { name: 'Swiftness', attrs: ['dex', 'vit'], abilities: { 5: 'rapid_fire' },
        notables: { 4: N('Quickdraw', { attackSpeed: 0.08 }), 8: N('Wind Runner', { attackSpeed: 0.10, hpPct: 0.06 }) } },
    ],
  },
};

const ATTR_NAMES = { str: 'Strength', int: 'Intelligence', dex: 'Dexterity', vit: 'Vitality' };

// --------------------------------------------------------------------------- generator
const cache = new Map();

export function getTree(classId) {
  if (cache.has(classId)) return cache.get(classId);
  const spec = TREE_SPECS[classId];
  if (!spec) return null;
  const tree = buildTree(spec);
  cache.set(classId, tree);
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
    node.stats = p === s ? { [p + 'Pct']: 0.08 } : { [p + 'Pct']: 0.06, [s + 'Pct']: 0.03 };
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
    if (k === 2 && p !== s) n.stats = { [p]: Math.ceil(smallNodeValue / 2), [s]: Math.ceil(smallNodeValue / 2) };
    else n.stats = { [k === 1 ? s : p]: smallNodeValue };
    n.name = Object.keys(n.stats).map(a => ATTR_NAMES[a]).join(' & ');
  }
  for (const n of Object.values(nodes)) n.links.sort();
  return { nodes, start: 'start', branches: spec.branches.map(b => b.name), radius: rings.length * ringSpacing };
}

export const TREE_STAT_LABELS = {
  str: ['Strength', 'flat'], int: ['Intelligence', 'flat'], dex: ['Dexterity', 'flat'], vit: ['Vitality', 'flat'],
  strPct: ['Strength', 'pct'], intPct: ['Intelligence', 'pct'], dexPct: ['Dexterity', 'pct'], vitPct: ['Vitality', 'pct'], allPct: ['all attributes & health', 'pct'],
  physPowerPct: ['Physical Power', 'pct'], magPowerPct: ['Magic Power', 'pct'], healPowerPct: ['Healing Power', 'pct'],
  defensePct: ['Defense', 'pct'], hpPct: ['maximum Health', 'pct'], critChance: ['Critical Chance', 'pct'], critDamage: ['Critical Damage', 'pct'],
  attackSpeed: ['Attack Speed', 'pct'], damagePct: ['damage dealt', 'pct'], healingPct: ['healing done', 'pct'], damageTakenPct: ['damage taken', 'pct'],
};

export function describeNodeStats(stats) {
  const out = [];
  for (const [k, v] of Object.entries(stats || {})) {
    if (k === 'rank') { for (const [a, n] of Object.entries(v)) out.push(`+${n} rank to ${ABILITIES[a]?.name || a}`); continue; }
    const [label, kind] = TREE_STAT_LABELS[k] || [k, 'flat'];
    out.push(kind === 'pct' ? `${v > 0 ? '+' : ''}${Math.round(v * 100)}% ${label}` : `+${v} ${label}`);
  }
  return out;
}
