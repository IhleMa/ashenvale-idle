// Resonance gems and sockets.
//
// A gem in a socket changes the affixes of its own item (content/gems/<kind>.json: "effect" and "values" per
// quality). Static gems (Ladder, Keystone, Underdog, Harmony, Balance, Purity, Sacrifice, Mirror) change the item's
// stats directly; combat gems (Tide, Last Stand, Momentum) switch on and off during a fight (shared/combat.js).
// Gems drop from enemies (more from bosses and rifts); the Jeweler cuts Chipped gems from Gem Fragments and fuses
// three gems of one quality into one of the next. Gems are kept in the gem pouch as 'kind:quality' → count.
import { AFFIXES, AFFIX_TIERS, AFFIX_LIMITS, PCT_STATS, SLOTS, maxSockets, rollSockets, itemStats, affixValue } from './data/items.js';

import { CONTENT, onContentReload, refillArray } from './content.js';

const G = CONTENT.gems;
export const GEM_KINDS = G.kinds;
export const GEM_IDS = Object.keys(GEM_KINDS);
export const GEM_TIERS = [null, ...G.tiers];      // index = quality (1-based)
export let MAX_GEM_TIER = GEM_TIERS.length - 1;
export const GEM_CONFIG = G.config;
onContentReload(() => { refillArray(GEM_IDS, Object.keys(GEM_KINDS)); refillArray(GEM_TIERS, [null, ...G.tiers]); MAX_GEM_TIER = GEM_TIERS.length - 1; });

// { base, perItemLevel, perItemLevels } → number
const scaled = (v, level = 0) => (typeof v === 'number' ? v : (v.base || 0) + (v.perItemLevel || 0) * level + (v.perItemLevels ? Math.floor(level / v.perItemLevels) : 0));
const scaleMats = (mats, mult = 1, level = 0) => Object.fromEntries(Object.entries(mats || {}).map(([k, v]) => [k, scaled(v, level) * mult]));

export const gemKey = (kind, tier) => `${kind}:${tier}`;
export function parseGemKey(key) {
  const [kind, t] = String(key).split(':');
  const tier = Number(t);
  return GEM_KINDS[kind] && tier >= 1 && tier <= MAX_GEM_TIER ? { kind, tier } : null;
}
export const gemName = (kind, tier) => `${GEM_TIERS[tier]?.name || ''} ${GEM_KINDS[kind]?.name || kind}`.trim();
// the gem's number at a quality (values list, the last one repeats)
export const gemValue = (kind, tier) => { const v = GEM_KINDS[kind]?.values || [0]; return v[Math.min(v.length, tier) - 1]; };
const pctText = v => `${Math.round(v * 100)}%`;
// the gem's description with its numbers filled in
export function gemText(kind, tier) {
  const g = GEM_KINDS[kind];
  if (!g) return '';
  const v = gemValue(kind, tier);
  return g.description.replace('{v}', g.effect === 'keystone' ? String(v) : pctText(v)).replace('{n}', String(v))
    .replace('{period}', String(g.period ?? 8)).replace('{threshold}', pctText(g.threshold ?? 0.5))
    .replace('{duration}', String(g.duration ?? 10)).replace('{maxStacks}', String(g.maxStacks ?? 5));
}
export const COMBAT_GEMS = new Set(['tide', 'last_stand', 'momentum']);

// gems socketed in an item: [{ kind, tier, effect, v }]
export function itemGems(item) {
  const out = [];
  for (const g of item?.sockets || []) {
    const p = g && parseGemKey(g);
    if (p) out.push({ ...p, effect: GEM_KINDS[p.kind].effect, v: gemValue(p.kind, p.tier), def: GEM_KINDS[p.kind] });
  }
  return out;
}

// ---------------------------------------------------------------- what the gems do to an item's affixes
// dyn: the combat state for combat gems { tide: 'prefix'|'suffix'|null, lastStand: bool, momentum: stacks }
// → [{ stat, type, tier (original), eff (tier used), roll, mult, off, value, mirror? }] plus notes for the tooltip
const worstTier = () => Math.max(...AFFIX_TIERS.map(t => t.tier));
export function affixPlan(item, dyn = null) {
  const gems = itemGems(item);
  const has = e => gems.find(g => g.effect === e);
  const lvl = item.level;
  const list = (item.affixes || []).filter(a => AFFIXES[a.stat]).map(a => ({ ...a, type: AFFIXES[a.stat].type, group: AFFIXES[a.stat].group, eff: a.tier, mult: 1, off: false }));
  if (!list.length) return list;
  const weakest = arr => arr.slice().sort((a, b) => b.eff - a.eff || a.roll - b.roll)[0];
  const best = arr => arr.slice().sort((a, b) => a.eff - b.eff || b.roll - a.roll)[0];
  // Keystone: the weakest affix climbs up to N tiers, never past the best one
  const ks = has('keystone');
  if (ks && list.length > 1) { const w = weakest(list), top = best(list); w.eff = Math.max(top.eff, w.eff - ks.v); w.keystone = true; }
  // Sacrifice: the weakest affix is switched off, the others get stronger per affix that remains
  const sac = has('sacrifice');
  if (sac && list.length > 1) { weakest(list).off = true; const on = list.filter(a => !a.off); for (const a of on) a.mult += sac.v * on.length; }
  const on = list.filter(a => !a.off);
  const T7 = worstTier();
  const lad = has('ladder'); if (lad) for (const a of on) a.mult += lad.v * (T7 - a.eff);
  const und = has('underdog'); if (und) for (const a of on) if (a.eff >= T7 - 2) a.mult += und.v;
  const har = has('harmony');
  if (har) for (const type of ['prefix', 'suffix']) { const side = on.filter(a => a.type === type); if (side.length && side.length >= (AFFIX_LIMITS[type] ?? 3)) for (const a of side) a.mult += har.v; }
  const bal = has('balance');
  if (bal) { const np = on.filter(a => a.type === 'prefix').length, ns = on.filter(a => a.type === 'suffix').length; if (np && np === ns) for (const a of on) a.mult += bal.v; }
  const pur = has('purity');
  if (pur && on.length >= 2 && on.every(a => a.eff === on[0].eff)) for (const a of on) a.mult += pur.v;
  // combat gems
  if (dyn) {
    const tide = has('tide'); if (tide && dyn.tide) for (const a of on) if (a.type === dyn.tide) a.mult += tide.v;
    const ls = has('last_stand'); if (ls && dyn.lastStand) for (const a of on) if (a.group === 'defense') a.mult += ls.v;
    const mo = has('momentum'); if (mo && dyn.momentum) for (const a of on) if (a.group === 'offense') a.mult += mo.v * dyn.momentum;
  }
  for (const a of list) {
    const v = a.off ? 0 : affixValue({ stat: a.stat, tier: a.eff, roll: a.roll }, lvl) * a.mult;
    a.value = PCT_STATS.has(a.stat) ? Math.round(v * 1000) / 1000 : Math.round(v);
  }
  // Mirror: the best affix once more at a share of its value
  const mir = has('mirror');
  if (mir && on.length) {
    const b = best(on);
    const v = b.value * mir.v;
    list.push({ stat: b.stat, type: b.type, group: b.group, tier: b.tier, eff: b.eff, roll: b.roll, mult: mir.v, off: false, mirror: true, value: PCT_STATS.has(b.stat) ? Math.round(v * 1000) / 1000 : Math.round(v) });
  }
  return list;
}

// all stats an equipped item gives (base, unique and affixes with its gems applied)
export function gearItemStats(item, dyn = null) {
  if (!item.affixes) return { ...item.stats };
  const stats = itemStats({ ...item, affixes: [] });
  for (const a of affixPlan(item, dyn)) if (a.value) stats[a.stat] = (stats[a.stat] || 0) + a.value;
  for (const k of Object.keys(stats)) if (PCT_STATS.has(k)) stats[k] = Math.round(stats[k] * 1000) / 1000;
  return stats;
}
// the combat gems on an item, for the battle engine
export const combatGems = item => itemGems(item).filter(g => COMBAT_GEMS.has(g.effect));

// ---------------------------------------------------------------- drops
// chance per kill by enemy kind; the quality depends on the enemy level (qualityByLevel: [[minLevel, weights]])
export function rollGemDrop(rng, level, kind = 'normal', mult = 1) {
  const D = G.drops;
  const weights = (D?.qualityByLevel || [[1, [1]]]).filter(([l]) => level >= l).pop()?.[1];
  if (!weights || !(rng() < (D[kind] ?? 0) * mult)) return null; // too low-level enemies drop none
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rng() * total, tier = 1;
  for (let i = 0; i < weights.length; i++) if ((r -= weights[i]) <= 0) { tier = i + 1; break; }
  const ids = Object.keys(GEM_KINDS);
  return gemKey(ids[Math.floor(rng() * ids.length)], Math.min(tier, MAX_GEM_TIER));
}

// ---------------------------------------------------------------- crafting costs
// costs use the town format { gold, mats }
export function cutCost(count = 1) {
  const c = GEM_TIERS[1].cutCost;
  return { gold: c.gold * count, mats: scaleMats(c.mats, count) };
}
// fusing 3× quality T into T+1
export function fuseCost(tier, count = 1) {
  const c = GEM_TIERS[tier + 1].fuseCost;
  return { gold: c.gold * count, mats: scaleMats(c.mats, count) };
}
// chance that a cut/fuse yields one extra gem, from the jeweler's skill
export function doubleChance(professionLevel = 1) { return Math.min(G.bonusGemChance.max, professionLevel / G.bonusGemChance.levelDivisor); }

// ---------------------------------------------------------------- sockets
export { maxSockets, rollSockets }; // defined in data/items.js (used when items drop)
export function drillCost(item) {
  const n = (item.sockets || []).length; // the socket being added is #n+1
  const d = G.drill.sockets[n] || G.drill.sockets[G.drill.sockets.length - 1];
  return { gold: Math.round((G.drill.gold.base + item.level * G.drill.gold.perItemLevel) * d.goldMult), mats: scaleMats(d.mats, 1, item.level) };
}
export function drillJewelerLevel(item) { return G.drill.sockets[(item.sockets || []).length]?.jeweler ?? 99; }
// gold to pull a gem back out intact
export function unsocketCost(tier, itemLevel) { return G.unsocketCost.perTierSquared * tier * tier + itemLevel * G.unsocketCost.perItemLevel; }

// ---------------------------------------------------------------- old stat gems (before resonance gems)
// 'str:2' and friends: refunded as Gem Fragments
export function legacyGemRefund(key) {
  if (parseGemKey(key)) return 0;
  const t = Number(String(key).split(':')[1]);
  const list = G.legacyRefund?.gemFragmentsPerOldGem || [10];
  return t >= 1 ? list[Math.min(list.length, t) - 1] : 0;
}

// items from when they could hold several sockets: keep the allowed number (gems first), return the removed gems
export function trimSockets(item) {
  if (!item?.sockets || item.sockets.length <= maxSockets(item)) return [];
  const gems = item.sockets.filter(Boolean);
  const keep = gems.slice(0, maxSockets(item));
  item.sockets = Array.from({ length: maxSockets(item) }, (_, i) => keep[i] || null);
  return gems.slice(keep.length);
}
export const LEGACY_SHARDS_PER_FRAGMENT = G.legacyRefund?.shardsPerFragment || 10;

export function slotLabel(slot) { return SLOTS[slot]?.label || slot; }
