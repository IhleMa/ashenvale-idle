// Town actions (all validated server-side).
import crypto from 'node:crypto';
import { CONFIG, rarityIndex } from '../shared/config.js';
import { BUILDINGS, MATERIALS, PROFESSIONS, PROFESSION_IDS, PROFESSION_MAX, professionXpToNext, ITEM_MATERIAL, CRAFT_BUILDING_OF_TYPE, QUALITIES, ELIXIRS, ELIXIR_MAX_HOURS, ENCHANT_STATS_BY_LEVEL, INN_ROSTER } from '../shared/data/town.js';
import { ITEM_BASES, generateItem, canEquip } from '../shared/data/items.js';
import * as T from '../shared/town.js';
import { createRng, randomSeed } from '../shared/rng.js';
import { GameError } from './playerLogic.js';

const fail = m => { throw new GameError(m); };

// ---------------------------------------------------------------- migration / setup
export function migrateTown(p) {
  if (!p.town) {
    p.town = T.newTown();
    // existing players keep their whole roster: give the Inn enough rooms
    const recruits = Object.values(p.characters).filter(c => !c.isMain).length;
    let inn = 1;
    while (inn < 5 && INN_ROSTER[inn] < recruits) inn++;
    p.town.buildings.inn.level = inn;
  }
  for (const [id, def] of Object.entries(BUILDINGS)) {
    if (!p.town.buildings[id]) p.town.buildings[id] = { level: def.start, upgrade: null, worker: null, stored: {}, updatedAt: Date.now() };
  }
  p.town.materials ||= {};
  p.town.elixirs ||= {};
  const rng = createRng(randomSeed());
  for (const ch of Object.values(p.characters)) {
    if (!ch.isMain && !ch.profession) ch.profession = { id: rng.pick(PROFESSION_IDS), level: 1 + Math.floor(ch.level / 6), xp: 0 };
  }
  // drop workers that no longer exist
  for (const b of Object.values(p.town.buildings)) if (b.worker && !p.characters[b.worker]) b.worker = null;
}

export function rollProfession(rng, innLevel) {
  const bonus = innLevel >= 3 ? (innLevel - 2) * 3 : 0;
  return { id: rng.pick(PROFESSION_IDS), level: 1 + bonus + rng.int(0, 2 + innLevel), xp: 0 };
}

// ---------------------------------------------------------------- helpers
function pay(p, cost) {
  if (!T.canAfford(p, cost)) {
    const missing = [];
    if (p.gold < (cost.gold || 0)) missing.push(`${cost.gold - p.gold} gold`);
    for (const [k, v] of Object.entries(cost.mats || {})) { const have = p.town.materials[k] || 0; if (have < v) missing.push(`${v - have} ${MATERIALS[k].name}`); }
    fail(`Missing ${missing.join(', ')}`);
  }
  p.gold -= cost.gold || 0;
  for (const [k, v] of Object.entries(cost.mats || {})) p.town.materials[k] -= v;
}

export function addMaterials(p, mats) {
  for (const [k, v] of Object.entries(mats)) if (v > 0) p.town.materials[k] = (p.town.materials[k] || 0) + v;
}

function gainProfessionXp(ch, amount) {
  if (!ch?.profession) return null;
  const pr = ch.profession;
  if (pr.level >= PROFESSION_MAX) return null;
  pr.xp += Math.round(amount);
  let up = false;
  while (pr.level < PROFESSION_MAX && pr.xp >= professionXpToNext(pr.level)) { pr.xp -= professionXpToNext(pr.level); pr.level++; up = true; }
  return up ? `${ch.name}'s ${PROFESSIONS[pr.id].name} reached ${pr.level}!` : null;
}

function requireBuilding(p, id, kind) {
  const def = BUILDINGS[id] || fail('Unknown building');
  if (kind && def.kind !== kind) fail('Wrong building');
  if (T.bLevel(p, id) < 1) fail(`Build the ${def.name} first`);
  return def;
}

function requireWorker(p, id) {
  const w = T.worker(p, id);
  if (!w) fail(`Assign a companion with ${PROFESSIONS[BUILDINGS[id].profession].name} to the ${BUILDINGS[id].name} first`);
  return w;
}

// Item in inventory (charId empty) or equipped on a character
function findItemRef(p, uid, charId) {
  if (charId) {
    const ch = p.characters[charId] || fail('Character not found');
    const slot = Object.keys(ch.equipment).find(s => ch.equipment[s]?.uid === uid);
    if (!slot) fail('Item not found');
    return { item: ch.equipment[slot], ch };
  }
  const item = p.inventory.find(i => i.uid === uid) || fail('Item not found');
  return { item, ch: null };
}

// ---------------------------------------------------------------- construction
export function finishConstructions(p, now = Date.now()) {
  const done = [];
  for (const [id, b] of Object.entries(p.town.buildings)) {
    if (b.upgrade && b.upgrade.endsAt <= now) {
      if (BUILDINGS[id].kind === 'gather') settleGather(p, id, b.upgrade.endsAt);
      b.level = b.upgrade.to;
      b.upgrade = null;
      done.push({ id, level: b.level, name: BUILDINGS[id].name });
    }
  }
  return done;
}

export function upgradeBuilding(p, { buildingId }) {
  finishConstructions(p);
  const err = T.upgradeBlocker(p, buildingId);
  const b = p.town.buildings[buildingId];
  if (err && err !== 'Not enough gold or materials') fail(err);
  const to = b.level + 1;
  pay(p, T.upgradeCost(buildingId, to));
  b.upgrade = { to, startedAt: Date.now(), endsAt: Date.now() + T.buildSeconds(buildingId, to) * 1000 };
  return { endsAt: b.upgrade.endsAt };
}

// ---------------------------------------------------------------- workers & gathering
function settleGather(p, id, at = Date.now()) {
  const b = p.town.buildings[id];
  b.stored = T.gatherStored(p, id, at);
  b.updatedAt = at;
}

export function assignWorker(p, { buildingId, charId }) {
  const def = BUILDINGS[buildingId] || fail('Unknown building');
  if (!def.profession) fail('This building has no worker slot');
  if (T.bLevel(p, buildingId) < 1) fail(`Build the ${def.name} first`);
  if (def.kind === 'gather') settleGather(p, buildingId);
  if (!charId) { p.town.buildings[buildingId].worker = null; return; }
  const ch = p.characters[charId] || fail('Character not found');
  if (ch.isMain) fail('Your hero leads the town — assign a companion');
  if (ch.profession?.id !== def.profession) fail(`${ch.name} doesn't know ${PROFESSIONS[def.profession].name}`);
  for (const [id, b] of Object.entries(p.town.buildings)) {
    if (b.worker === charId) { if (BUILDINGS[id].kind === 'gather') settleGather(p, id); b.worker = null; }
  }
  p.town.buildings[buildingId].worker = charId;
}

export function collect(p, { buildingId }) {
  requireBuilding(p, buildingId, 'gather');
  settleGather(p, buildingId);
  const b = p.town.buildings[buildingId];
  const got = {};
  for (const [m, v] of Object.entries(b.stored)) { const n = Math.floor(v); if (n > 0) { got[m] = n; b.stored[m] = v - n; } }
  if (!Object.keys(got).length) fail('Nothing to collect yet');
  addMaterials(p, got);
  const msg = gainProfessionXp(T.worker(p, buildingId), Object.values(got).reduce((a, x) => a + x, 0) * 0.6);
  return { got, msg };
}

export function collectAll(p) {
  const got = {};
  const msgs = [];
  for (const [id, def] of Object.entries(BUILDINGS)) {
    if (def.kind !== 'gather' || T.bLevel(p, id) < 1) continue;
    try { const r = collect(p, { buildingId: id }); for (const [k, v] of Object.entries(r.got)) got[k] = (got[k] || 0) + v; if (r.msg) msgs.push(r.msg); } catch { /* nothing stored */ }
  }
  if (!Object.keys(got).length) fail('Nothing to collect yet');
  return { got, msgs };
}

// ---------------------------------------------------------------- salvage
function salvageOne(p, item) {
  const y = T.salvageYield(item, T.bLevel(p, 'salvage_yard'), !!T.worker(p, 'enchanter'));
  addMaterials(p, y);
  return y;
}

export function salvageItems(p, { itemUids }) {
  if (!Array.isArray(itemUids) || !itemUids.length) fail('Nothing selected');
  const set = new Set(itemUids.map(String));
  const total = {};
  let n = 0;
  p.inventory = p.inventory.filter(i => {
    if (!set.has(i.uid)) return true;
    if (i.locked) return true;
    for (const [k, v] of Object.entries(salvageOne(p, i))) total[k] = (total[k] || 0) + v;
    n++;
    return false;
  });
  if (!n) fail('No unlocked items selected');
  return { count: n, materials: total };
}

export function salvageByRarity(p, { maxRarity }) {
  const max = rarityIndex(maxRarity);
  const uids = p.inventory.filter(i => !i.locked && rarityIndex(i.rarity) <= max).map(i => i.uid);
  if (!uids.length) fail('No matching unlocked items');
  return salvageItems(p, { itemUids: uids });
}

// used by auto-loot
export function autoSalvage(p, item) { return salvageOne(p, item); }

// ---------------------------------------------------------------- crafting
export function craft(p, { buildingId, baseId, level, quality = 'standard' }, heroLevel) {
  const def = requireBuilding(p, buildingId, 'craft');
  const w = requireWorker(p, buildingId);
  const base = ITEM_BASES[baseId] || fail('Unknown recipe');
  if (ITEM_MATERIAL[baseId] !== def.type) fail(`The ${def.name} can't make that`);
  const q = QUALITIES[quality] || fail('Unknown quality');
  const L = T.bLevel(p, buildingId);
  if (q.building > L) fail(`${q.label} quality requires ${def.name} level ${q.building}`);
  const cap = T.craftLevelCap(p, buildingId, heroLevel);
  const lvl = Math.floor(Number(level));
  if (!(lvl >= 1 && lvl <= cap)) fail(`Item level must be 1–${cap}`);
  if (p.inventory.length >= CONFIG.inventory.limit) fail('Inventory is full');
  pay(p, T.craftCost(baseId, lvl, quality));
  const rng = createRng(randomSeed());
  const item = generateItem(rng, lvl, { baseId: base.id, minRarity: q.minRarity, boost: T.craftRarityBoost(L, w.profession.level) });
  item.crafted = w.name;
  p.inventory.push(item);
  if (rarityIndex(item.rarity) >= 3) p.stats.epicFound++;
  if (rarityIndex(item.rarity) >= 4) p.stats.legendaryFound++;
  p.stats.crafted = (p.stats.crafted || 0) + 1;
  const msg = gainProfessionXp(w, 12 + lvl / 2 + rarityIndex(item.rarity) * 5);
  return { item, msg };
}

export function reforge(p, { buildingId, itemUid, charId }, heroLevel) {
  const def = requireBuilding(p, buildingId, 'craft');
  const w = requireWorker(p, buildingId);
  const { item, ch } = findItemRef(p, String(itemUid), charId);
  if (ITEM_MATERIAL[item.baseId] !== def.type) fail(`The ${def.name} can't reforge that item`);
  const target = T.craftLevelCap(p, buildingId, heroLevel);
  if (target <= item.level) fail(`This item is already item level ${item.level} (the ${def.name} reforges up to ${target})`);
  pay(p, T.reforgeCost(item, target));
  item.stats = T.reforgedStats(item, target);
  item.level = target;
  item.requiredLevel = Math.max(1, target - 2);
  if (ch && !canEquip(item, ch)) { // shouldn't happen (target ≤ hero level) but never leave unusable gear equipped
    const slot = Object.keys(ch.equipment).find(s => ch.equipment[s] === item);
    ch.equipment[slot] = null;
    p.inventory.push(item);
  }
  const msg = gainProfessionXp(w, 8 + target / 4);
  return { item, msg };
}

export function enchant(p, { itemUid, charId, stat }) {
  requireBuilding(p, 'enchanter');
  const w = requireWorker(p, 'enchanter');
  const L = T.bLevel(p, 'enchanter');
  if (!ENCHANT_STATS_BY_LEVEL(L).includes(stat)) fail('That enchantment needs a higher level Enchanter\'s Study');
  const { item } = findItemRef(p, String(itemUid), charId);
  pay(p, T.enchantCost(item.level, item.rarity));
  item.enchant = { stat, value: T.enchantValue(stat, item.level, L, w.profession.level) };
  const msg = gainProfessionXp(w, 10 + item.level / 4);
  return { item, msg };
}

// ---------------------------------------------------------------- alchemy
export function brew(p, { elixirId }, heroLevel) {
  requireBuilding(p, 'alchemy_lab');
  const w = requireWorker(p, 'alchemy_lab');
  const e = ELIXIRS[elixirId] || fail('Unknown elixir');
  const L = T.bLevel(p, 'alchemy_lab');
  if (e.level > L) fail(`Requires Alchemy Lab level ${e.level}`);
  const now = Date.now();
  const current = Math.max(now, p.town.elixirs[elixirId] || 0);
  const add = T.elixirMinutes(L, w.profession.level) * 60000;
  if (current + add - now > ELIXIR_MAX_HOURS * 3600000 + 60000) fail(`Elixirs can be stacked up to ${ELIXIR_MAX_HOURS} hours`);
  pay(p, T.elixirCost(elixirId, heroLevel));
  p.town.elixirs[elixirId] = current + add;
  const msg = gainProfessionXp(w, 10);
  return { expiresAt: p.town.elixirs[elixirId], msg };
}

export { uidHex };
function uidHex() { return crypto.randomBytes(6).toString('hex'); }
