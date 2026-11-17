// Unique items and item sets.
// Uniques: fixed name, base and bonus stats plus a special effect (proc or passive).
// Sets: epic pieces that grant bonuses when several pieces of the same set are equipped.
//
// Proc format: { trigger, chance, icd?, once?, filter?, target, effect, name }
//   trigger: 'hit' (you deal direct damage) | 'crit' | 'struck' (you take damage) | 'heal' (you heal with an ability)
//            'kill' | 'cast' (you use an ability) | 'lowHp' (your health drops below 30%)
//   target:  'self' | 'target' | 'source' | 'randomEnemy' | 'lowestAlly' | 'allAllies'
//   effect:  any ability effect (damage/heal/status/shield/resource) plus
//            { kind:'reflect', pct } · { kind:'healPct', pct } · { kind:'shieldPct', pct, duration } · { kind:'cooldowns', seconds }
// Passive format: { damageVsBossPct, damageVsHighHpPct, costPct }
// Images: assets/items/unique_<id>.png and assets/items/set_<setId>_<baseId>.png (fall back to the base item image)
import { generateItem, ITEM_BASES, AFFIXES } from './items.js';

export const UNIQUES = {
  emberheart: {
    name: 'Emberheart', baseId: 'staff', minLevel: 8,
    flavor: 'Still warm from the forge of the Cinder Wyrm.',
    stats: { int: [3, 0.7], critChance: [0.02, 0.0004] },
    procs: [{ name: 'Emberheart', trigger: 'hit', chance: 0.2, icd: 1, filter: { school: 'magical' }, target: 'target', effect: { kind: 'status', status: 'burn', duration: 5, stat: 'magPower', power: 0.3 } }],
    description: 'Magic damage has a 20% chance to ignite the target, burning for 30% Magic Power per second for 5s.',
  },
  dawnbringer: {
    name: 'Dawnbringer', baseId: 'mace', minLevel: 8,
    flavor: 'Its light remembers every wound it closed.',
    stats: { healPower: [3, 0.8], vit: [2, 0.5] },
    procs: [{ name: 'Dawnbringer', trigger: 'heal', chance: 1, target: 'target', effect: { kind: 'status', status: 'renew', duration: 6, stat: 'healPower', power: 0.25 } }],
    description: 'Your healing abilities also apply Renew (25% Healing Power per second for 6s).',
  },
  widowmaker: {
    name: 'Widowmaker', baseId: 'dagger', minLevel: 10,
    flavor: 'Quick, quiet, and never the first strike.',
    stats: { dex: [3, 0.7], critDamage: [0.1, 0.004] },
    procs: [{ name: 'Widowmaker', trigger: 'kill', chance: 1, target: 'self', effect: { kind: 'resource', amount: 30 } }, { name: 'Widowmaker', trigger: 'kill', chance: 1, target: 'self', effect: { kind: 'cooldowns', seconds: 3 } }],
    description: 'Killing an enemy restores 30 resource and reduces all your cooldowns by 3 seconds.',
  },
  bulwark_of_ages: {
    name: 'Bulwark of Ages', baseId: 'shield', minLevel: 10,
    flavor: 'Generations of defenders have bled behind it.',
    stats: { vit: [3, 0.7], defense: [2, 0.6] },
    procs: [{ name: 'Bulwark of Ages', trigger: 'struck', chance: 0.12, icd: 6, target: 'self', effect: { kind: 'shieldPct', pct: 0.08, duration: 6 } }],
    description: 'When struck, 12% chance to gain a barrier absorbing 8% of your max health (6s cooldown).',
  },
  thornhide: {
    name: 'Thornhide Carapace', baseId: 'plate_chest', minLevel: 14,
    flavor: 'Whoever strikes it, bleeds.',
    stats: { vit: [2, 0.6], defense: [2, 0.5] },
    procs: [{ name: 'Thornhide', trigger: 'struck', chance: 1, filter: { school: 'physical' }, target: 'source', effect: { kind: 'reflect', pct: 0.2 } }],
    description: 'Reflects 20% of physical damage taken back at the attacker.',
  },
  stormstring: {
    name: 'Stormstring', baseId: 'bow', minLevel: 12,
    flavor: 'Every arrow calls a second one.',
    stats: { dex: [3, 0.7], attackSpeed: [0.02, 0.0006] },
    procs: [{ name: 'Stormstring', trigger: 'hit', chance: 0.15, icd: 0.5, target: 'randomEnemy', effect: { kind: 'damage', stat: 'physPower', power: 0.8, school: 'physical' } }],
    description: 'Hits have a 15% chance to loose an extra arrow at a random enemy for 80% Physical Power.',
  },
  last_breath: {
    name: 'Band of the Last Breath', baseId: 'ring', minLevel: 15,
    flavor: 'Not yet.',
    stats: { vit: [2, 0.5], hp: [10, 4] },
    procs: [{ name: 'Last Breath', trigger: 'lowHp', chance: 1, once: true, target: 'self', effect: { kind: 'healPct', pct: 0.25 } }, { name: 'Last Breath', trigger: 'lowHp', chance: 1, once: true, target: 'self', effect: { kind: 'status', status: 'shield_wall', duration: 6 } }],
    description: 'Once per fight, when you drop below 30% health: heal 25% of max health and gain Shield Wall for 6s.',
  },
  kingslayer: {
    name: 'Kingslayer Pendant', baseId: 'amulet', minLevel: 18,
    flavor: 'Worn by those who end dynasties.',
    stats: { critChance: [0.01, 0.0003], physPower: [1, 0.4], magPower: [1, 0.4] },
    passive: { damageVsBossPct: 0.15 },
    description: 'You deal 15% more damage to bosses.',
  },
  quickening_grips: {
    name: 'Grips of Quickening', baseId: 'leather_gloves', minLevel: 12,
    flavor: 'Faster than thought.',
    stats: { dex: [2, 0.6], critChance: [0.01, 0.0003] },
    procs: [{ name: 'Quickening', trigger: 'crit', chance: 0.5, icd: 8, target: 'self', effect: { kind: 'status', status: 'rapid_fire', duration: 4 } }],
    description: 'Critical hits have a 50% chance to grant +40% attack speed for 4s (8s cooldown).',
  },
  cowl_of_whispers: {
    name: 'Cowl of Whispers', baseId: 'leather_hood', minLevel: 16,
    flavor: 'It tells you where they are weakest.',
    stats: { dex: [2, 0.6], critDamage: [0.06, 0.003] },
    procs: [{ name: 'Whispers', trigger: 'crit', chance: 1, icd: 4, target: 'target', effect: { kind: 'status', status: 'exposed', duration: 5 } }],
    description: 'Critical hits expose the target (+15% damage taken for 5s).',
  },
  voidwalkers: {
    name: 'Voidwalkers', baseId: 'cloth_boots', minLevel: 20,
    flavor: 'Each step costs a little less.',
    stats: { int: [2, 0.6], magPower: [1, 0.5] },
    passive: { costPct: -0.15 },
    description: 'Your abilities cost 15% less resource.',
  },
  titans_cleaver: {
    name: "Titan's Cleaver", baseId: 'axe', minLevel: 22,
    flavor: 'The first blow decides everything.',
    stats: { str: [3, 0.8], critChance: [0.01, 0.0003] },
    passive: { damageVsHighHpPct: 0.3 },
    description: 'You deal 30% more damage to enemies above 80% health.',
  },
};
for (const [id, u] of Object.entries(UNIQUES)) u.id = id;

export const SETS = {
  juggernaut: {
    name: "Juggernaut's Bulwark", minLevel: 10,
    pieces: { plate_helm: 'Juggernaut Helm', plate_chest: 'Juggernaut Breastplate', plate_gloves: 'Juggernaut Gauntlets', plate_boots: 'Juggernaut Sabatons' },
    bonuses: {
      2: { description: '+15% Defense', stats: { defensePct: 0.15 } },
      4: { description: 'Using Taunt also grants Shield Wall for 4s.', procs: [{ name: 'Juggernaut', trigger: 'cast', chance: 1, filter: { ability: 'taunt' }, target: 'self', effect: { kind: 'status', status: 'shield_wall', duration: 4 } }] },
    },
  },
  archmage: {
    name: 'Regalia of the Archmage', minLevel: 10,
    pieces: { cloth_hat: 'Archmage Circlet', robe: 'Archmage Robe', cloth_gloves: 'Archmage Handwraps', cloth_boots: 'Archmage Slippers' },
    bonuses: {
      2: { description: '+10% Magic Power', stats: { magPowerPct: 0.10 } },
      4: { description: 'Area abilities have a 30% chance to refund 20 resource.', procs: [{ name: 'Archmage', trigger: 'cast', chance: 0.3, filter: { area: true }, target: 'self', effect: { kind: 'resource', amount: 20 } }] },
    },
  },
  nightstalker: {
    name: 'Nightstalker Garb', minLevel: 12,
    pieces: { leather_hood: 'Nightstalker Mask', leather_chest: 'Nightstalker Tunic', leather_gloves: 'Nightstalker Grips', leather_boots: 'Nightstalker Treads' },
    bonuses: {
      2: { description: '+5% Critical Chance', stats: { critChance: 0.05 } },
      4: { description: 'Critical hits make the target bleed for 6s.', procs: [{ name: 'Nightstalker', trigger: 'crit', chance: 1, icd: 1, target: 'target', effect: { kind: 'status', status: 'bleed', duration: 6, stat: 'physPower', power: 0.2 } }] },
    },
  },
  lightbringer: {
    name: 'Vestments of the Lightbringer', minLevel: 12,
    pieces: { cloth_hat: 'Lightbringer Halo', robe: 'Lightbringer Vestment', tome: 'Lightbringer Codex', cloth_boots: 'Lightbringer Sandals' },
    bonuses: {
      2: { description: '+10% healing done', stats: { healingPct: 0.10 } },
      4: { description: 'Your heals have a 25% chance to also heal the most injured ally for 60% Healing Power.', procs: [{ name: 'Lightbringer', trigger: 'heal', chance: 0.25, icd: 1, target: 'lowestAlly', effect: { kind: 'heal', stat: 'healPower', power: 0.6 } }] },
    },
  },
  wildwood: {
    name: 'Wildwood Trappings', minLevel: 14,
    pieces: { bow: 'Wildwood Longbow', quiver: 'Wildwood Quiver', leather_chest: 'Wildwood Jerkin', leather_boots: 'Wildwood Boots' },
    bonuses: {
      2: { description: '+8% Attack Speed', stats: { attackSpeed: 0.08 } },
      4: { description: 'Hits have a 15% chance to poison the target.', procs: [{ name: 'Wildwood', trigger: 'hit', chance: 0.15, target: 'target', effect: { kind: 'status', status: 'poison', duration: 8, stat: 'physPower', power: 0.18 } }] },
    },
  },
};
for (const [id, s] of Object.entries(SETS)) s.id = id;

export const DROP_CHANCE = {
  unique: { boss: 0.04, elite: 0.01, normal: 0.0004 },
  set: { boss: 0.06, elite: 0.015, normal: 0.0008 },
};

// ---------------------------------------------------------------- generation
export function generateUnique(rng, level, uniqueId = null) {
  const pool = Object.values(UNIQUES).filter(u => u.minLevel <= Math.max(level, 1));
  const u = UNIQUES[uniqueId] || (pool.length ? pool[Math.floor(rng() * pool.length)] : null);
  if (!u) return null;
  const lvl = Math.max(u.minLevel, Math.round(level));
  const item = generateItem(rng, lvl, { baseId: u.baseId, rarity: 'legendary' });
  for (const [k, [b, per]] of Object.entries(u.stats)) {
    const v = b + per * lvl;
    item.stats[k] = (item.stats[k] || 0) + (AFFIXES[k]?.pct ? Math.round(v * 1000) / 1000 : Math.round(v));
  }
  item.name = u.name;
  item.unique = u.id;
  return item;
}

export function generateSetItem(rng, level, setId = null, baseId = null) {
  const pool = Object.values(SETS).filter(s => s.minLevel <= Math.max(level, 1));
  const set = SETS[setId] || (pool.length ? pool[Math.floor(rng() * pool.length)] : null);
  if (!set) return null;
  const bases = Object.keys(set.pieces);
  const base = baseId && set.pieces[baseId] ? baseId : bases[Math.floor(rng() * bases.length)];
  const lvl = Math.max(set.minLevel, Math.round(level));
  const item = generateItem(rng, lvl, { baseId: base, rarity: 'epic' });
  item.name = set.pieces[base];
  item.set = set.id;
  return item;
}

// ---------------------------------------------------------------- equipped effects
export function equippedSetCounts(ch) {
  const counts = {};
  const seen = new Set();
  for (const it of Object.values(ch.equipment || {})) {
    if (!it?.set) continue;
    const k = `${it.set}:${it.baseId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    counts[it.set] = (counts[it.set] || 0) + 1;
  }
  return counts;
}

export function activeSetBonuses(ch) {
  const out = [];
  for (const [setId, n] of Object.entries(equippedSetCounts(ch))) {
    for (const [need, bonus] of Object.entries(SETS[setId]?.bonuses || {})) if (n >= Number(need)) out.push({ setId, need: Number(need), ...bonus });
  }
  return out;
}

// Stat bonuses from sets (merged into computeStats)
export function setStatBonuses(ch) {
  const out = {};
  for (const b of activeSetBonuses(ch)) for (const [k, v] of Object.entries(b.stats || {})) out[k] = (out[k] || 0) + v;
  return out;
}

// Procs and passives from uniques and set bonuses (used by the combat engine)
export function equipmentEffects(ch) {
  const procs = [];
  const passives = {};
  const addPassive = p => { for (const [k, v] of Object.entries(p || {})) passives[k] = (passives[k] || 0) + v; };
  for (const it of Object.values(ch.equipment || {})) {
    const u = it?.unique ? UNIQUES[it.unique] : null;
    if (!u) continue;
    for (const p of u.procs || []) procs.push({ ...p });
    addPassive(u.passive);
  }
  for (const b of activeSetBonuses(ch)) {
    for (const p of b.procs || []) procs.push({ ...p });
    addPassive(b.passive);
  }
  return { procs, passives };
}

export function specialItemImageKeys(item) {
  if (item.unique) return [`items/unique_${item.unique}`];
  if (item.set) return [`items/set_${item.set}_${item.baseId}`, `items/set_${item.set}`];
  return [];
}

export { ITEM_BASES };
