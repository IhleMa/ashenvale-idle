// Loot filter: an ordered list of rules (first match wins) deciding whether a new drop is kept,
// salvaged into materials or sold. Shared so the client can preview exactly what the server does.
import { CONFIG, rarityIndex } from './config.js';
import { SLOTS, AFFIXES, AFFIX_TIERS, canEquip } from './data/items.js';
import { computeStats, powerRating } from './stats.js';
import { CONTENT, onContentReload, refillArray } from './content.js';

export const FILTER_ACTIONS = {
  keep: { label: 'Keep', icon: '✋' },
  salvage: { label: 'Salvage', icon: '🔨' },
  sell: { label: 'Sell', icon: '💰' },
};
export const MAX_RULES = CONTENT.lootfilter.maxRules;
export const FILTER_STATS = Object.keys(AFFIXES);
onContentReload(() => refillArray(FILTER_STATS, Object.keys(AFFIXES)));

export function defaultFilter() {
  return { enabled: false, protectUpgrades: true, rules: [] };
}

let ruleCounter = 0;
export function newRule(over = {}) {
  return {
    id: `r${Date.now().toString(36)}${(ruleCounter++).toString(36)}`, name: 'New rule', enabled: true, action: 'salvage',
    rarities: [], slots: [], levelsBelowHero: null, minLevel: null, maxLevel: null, unusable: false, anyStats: [], noStats: [], bestTierMax: null, bestTierMin: null,
    ...over,
  };
}

// Ready-made rules for the "Add preset" menu (content/lootfilter.json)
export const PRESETS = CONTENT.lootfilter.presets;

// Cleans up a filter sent by a client
export function sanitizeFilter(f) {
  const rarities = new Set(CONFIG.rarities.map(r => r.id));
  const num = (v, min, max) => (v === null || v === '' || v === undefined || !Number.isFinite(Number(v)) ? null : Math.max(min, Math.min(max, Math.round(Number(v)))));
  const list = (v, ok) => (Array.isArray(v) ? [...new Set(v.map(String).filter(x => ok(x)))] : []);
  const rules = (Array.isArray(f?.rules) ? f.rules : []).slice(0, MAX_RULES).map(r => ({
    id: String(r.id || newRule().id).slice(0, 24),
    name: String(r.name || 'Rule').trim().slice(0, 40) || 'Rule',
    enabled: r.enabled !== false,
    action: FILTER_ACTIONS[r.action] ? r.action : 'keep',
    rarities: list(r.rarities, x => rarities.has(x)),
    slots: list(r.slots, x => x in SLOTS),
    levelsBelowHero: num(r.levelsBelowHero, 0, CONFIG.levelCap),
    minLevel: num(r.minLevel, 1, CONFIG.levelCap),
    maxLevel: num(r.maxLevel, 1, CONFIG.levelCap),
    unusable: !!r.unusable,
    anyStats: list(r.anyStats, x => FILTER_STATS.includes(x)),
    noStats: list(r.noStats, x => FILTER_STATS.includes(x)),
    bestTierMax: num(r.bestTierMax, 1, AFFIX_TIERS.length),
    bestTierMin: num(r.bestTierMin, 1, AFFIX_TIERS.length),
  }));
  return { enabled: !!f?.enabled, protectUpgrades: f?.protectUpgrades !== false, rules };
}

// ---------------------------------------------------------------- evaluation
// ctx: { heroLevel, characters: [...] }  (characters used for "unusable" and upgrade protection)
export function makeContext(p) {
  const chars = Object.values(p.characters || {});
  const hero = p.characters?.[p.heroId];
  return { heroLevel: hero?.level || 1, characters: chars, powerCache: new Map() };
}

// Would equipping this item raise any character's power?
export function isUpgrade(item, ctx) {
  for (const ch of ctx.characters) {
    if (!canEquip(item, ch)) continue;
    const cur = ch.equipment?.[item.slot];
    if (!cur) return true;
    let base = ctx.powerCache.get(ch.id);
    if (base == null) { base = powerRating(computeStats(ch)); ctx.powerCache.set(ch.id, base); }
    const withItem = powerRating(computeStats({ ...ch, equipment: { ...ch.equipment, [item.slot]: item } }));
    if (withItem > base) return true;
  }
  return false;
}

function usableByRoster(item, ctx) {
  if (!item.classes) return true;
  return ctx.characters.some(ch => item.classes.includes(ch.classId));
}

// the item's best affix tier (1 = best); Infinity without affixes
export const bestTier = item => Math.min(Infinity, ...(item.affixes || []).map(a => a.tier));

export function ruleMatches(rule, item, ctx) {
  if (rule.rarities.length && !rule.rarities.includes(item.rarity)) return false;
  if (rule.slots.length && !rule.slots.includes(item.slot)) return false;
  if (rule.minLevel != null && item.level < rule.minLevel) return false;
  if (rule.maxLevel != null && item.level > rule.maxLevel) return false;
  if (rule.levelsBelowHero != null && item.level > ctx.heroLevel - rule.levelsBelowHero) return false;
  if (rule.unusable && usableByRoster(item, ctx)) return false;
  const stats = item.stats || {};
  if (rule.anyStats.length && !rule.anyStats.some(s => stats[s])) return false;
  if (rule.noStats.length && rule.noStats.some(s => stats[s])) return false;
  const best = bestTier(item);
  if (rule.bestTierMax != null && !(best <= rule.bestTierMax)) return false;
  if (rule.bestTierMin != null && best < rule.bestTierMin) return false;
  return true;
}

// → { action, reason, rule }
export function evaluateItem(filter, item, ctx) {
  if (!filter?.enabled) return { action: 'keep', reason: 'Filter is off' };
  if (item.unique || item.set) return { action: 'keep', reason: item.unique ? 'Unique — always kept' : 'Set item — always kept' };
  if (item.locked) return { action: 'keep', reason: 'Locked' };
  for (const rule of filter.rules) {
    if (!rule.enabled || !ruleMatches(rule, item, ctx)) continue;
    if (rule.action !== 'keep' && filter.protectUpgrades && isUpgrade(item, ctx)) return { action: 'keep', reason: `Upgrade for your roster (would match "${rule.name}")`, rule: rule.id };
    return { action: rule.action, reason: `Rule "${rule.name}"`, rule: rule.id };
  }
  return { action: 'keep', reason: 'No rule matched' };
}

// Plain-language summary of a rule, e.g. "Common or Uncommon · Weapons · 5+ levels below hero"
export function describeRule(rule) {
  const parts = [];
  if (rule.rarities.length) parts.push(rule.rarities.map(r => CONFIG.rarities.find(x => x.id === r)?.label || r).join(' or '));
  if (rule.slots.length) parts.push(rule.slots.map(s => SLOTS[s].label).join('/'));
  if (rule.levelsBelowHero != null) parts.push(`${rule.levelsBelowHero}+ levels below hero`);
  if (rule.minLevel != null) parts.push(`item level ≥ ${rule.minLevel}`);
  if (rule.maxLevel != null) parts.push(`item level ≤ ${rule.maxLevel}`);
  if (rule.unusable) parts.push('no class in roster can use it');
  if (rule.anyStats.length) parts.push(`has ${rule.anyStats.map(s => AFFIXES[s].label).join(' or ')}`);
  if (rule.noStats.length) parts.push(`without ${rule.noStats.map(s => AFFIXES[s].label).join(', ')}`);
  if (rule.bestTierMax != null) parts.push(`has a tier ${rule.bestTierMax}${rule.bestTierMax > 1 ? ' or better' : ''} affix`);
  if (rule.bestTierMin != null) parts.push(`no affix better than tier ${rule.bestTierMin}`);
  return `${FILTER_ACTIONS[rule.action].label}: ${parts.length ? parts.join(' · ') : 'every item'}`;
}

// Converts the old "auto-sell up to <rarity>" setting into a rule
export function filterFromLegacy(settings) {
  const f = defaultFilter();
  if (!settings?.autoSellBelow) return f;
  const max = rarityIndex(settings.autoSellBelow);
  f.enabled = true;
  f.protectUpgrades = false; // the old setting didn't protect upgrades; keep its behaviour
  f.rules.push(newRule({ name: 'Auto-loot (old setting)', action: settings.autoLootAction === 'salvage' ? 'salvage' : 'sell', rarities: CONFIG.rarities.filter((r, i) => i <= max).map(r => r.id) }));
  return f;
}
