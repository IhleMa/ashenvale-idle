// Town actions (all validated server-side).
import crypto from 'node:crypto';
import { CONFIG, rarityIndex } from '../shared/config.js';
import { BUILDINGS, MATERIALS, PROFESSIONS, PROFESSION_IDS, PROFESSION_MAX, professionXpToNext, ITEM_MATERIAL, CRAFT_BUILDING_OF_TYPE, QUALITIES, ELIXIRS, ELIXIR_MAX_HOURS, ENCHANT_STATS_BY_LEVEL, INN_ROSTER } from '../shared/data/town.js';
import { ITEM_BASES, generateItem, canEquip, maxSockets } from '../shared/data/items.js';
import * as G from '../shared/gems.js';
import * as T from '../shared/town.js';
import { createRng, randomSeed } from '../shared/rng.js';
import { busyWith } from '../shared/expeditions.js';
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
  p.town.gems ||= {}; // gem pouch: 'kind:quality' -> count
  // resonance gems replaced the stat gems: old gems and stat shards become Gem Fragments
  if (!p.town.gemsV2) {
    p.town.gemsV2 = true;
    let frags = 0;
    for (const [k, n] of Object.entries(p.town.gems)) { const r = G.legacyGemRefund(k); if (r) { frags += r * n; delete p.town.gems[k]; } }
    const items = [...(p.inventory || []), ...Object.values(p.characters || {}).flatMap(c => Object.values(c.equipment || {})), ...(p.mailbox || []).map(m => m.item)];
    for (const it of items) if (it?.sockets) it.sockets = it.sockets.map(g => { if (g && !G.parseGemKey(g)) { frags += G.legacyGemRefund(g); return null; } return g; });
    let shards = 0;
    for (const k of Object.keys(p.town.materials)) if (k.startsWith('shard_')) { shards += p.town.materials[k]; delete p.town.materials[k]; }
    frags += Math.floor(shards / G.LEGACY_SHARDS_PER_FRAGMENT);
    if (frags) { p.town.materials.gem_fragment = (p.town.materials.gem_fragment || 0) + frags; p.town.gemRefund = { fragments: frags, at: Date.now() }; }
  }
  // v0.5: Mine & Herb Garden were replaced by expeditions — refund what was spent on them
  const LEGACY = { mine: { gold: 200, metal_scrap: 10, leather_scrap: 6 }, herb_garden: { gold: 200, leather_scrap: 8, cloth_scrap: 8 } };
  for (const [id, cost] of Object.entries(LEGACY)) {
    const old = p.town.buildings[id];
    if (!old) continue;
    const lvl = old.upgrade ? old.upgrade.to : old.level;
    for (let L = 1; L <= lvl; L++) for (const [k, v] of Object.entries(cost)) {
      if (k === 'gold') p.gold += Math.round(v * Math.pow(L, 2.2));
      else p.town.materials[k] = (p.town.materials[k] || 0) + Math.ceil(v * Math.pow(L, 1.5));
    }
    for (const [k, v] of Object.entries(old.stored || {})) p.town.materials[k] = (p.town.materials[k] || 0) + Math.floor(v);
    delete p.town.buildings[id];
  }
  // one socket per item: extra sockets go, their gems back into the pouch
  if (!p.town.socketsV1) {
    p.town.socketsV1 = true;
    const items = [...(p.inventory || []), ...Object.values(p.characters || {}).flatMap(c => Object.values(c.equipment || {})), ...(p.mailbox || []).map(m => m.item)];
    for (const it of items) for (const g of G.trimSockets(it)) p.town.gems[g] = (p.town.gems[g] || 0) + 1;
  }
  for (const [id, def] of Object.entries(BUILDINGS)) {
    if (!p.town.buildings[id]) p.town.buildings[id] = { level: def.start, upgrade: null, worker: null };
  }
  p.expeditions ||= [];
  p.town.materials ||= {};
  p.town.elixirs ||= {};
  const rng = createRng(randomSeed());
  for (const ch of Object.values(p.characters)) {
    if (!ch.isMain && !ch.profession) ch.profession = { id: rng.pick(PROFESSION_IDS), level: 1 + Math.floor(ch.level / 6), xp: 0 };
  }
  // drop workers that no longer exist; busy companions can't be in a party
  for (const b of Object.values(p.town.buildings)) {
    if (b.worker && !p.characters[b.worker]) b.worker = null;
    if (b.worker) removeFromParties(p, b.worker);
  }
  for (const ex of p.expeditions) for (const id of ex.charIds) removeFromParties(p, id);
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

// ---------------------------------------------------------------- workers
// Workers live in town: they leave every party and co-op team and cannot fight.
export function removeFromParties(p, charId) {
  for (const party of p.parties) party.members = party.members.filter(id => id !== charId);
  p.coopChars = (p.coopChars || []).filter(id => id !== charId);
}

export function assignWorker(p, { buildingId, charId }) {
  const def = BUILDINGS[buildingId] || fail('Unknown building');
  if (!def.profession) fail('This building has no worker slot');
  if (T.bLevel(p, buildingId) < 1) fail(`Build the ${def.name} first`);
  if (!charId) { p.town.buildings[buildingId].worker = null; return; }
  const ch = p.characters[charId] || fail('Character not found');
  if (ch.isMain) fail('Your hero leads the town — assign a companion');
  if (ch.profession?.id !== def.profession) fail(`${ch.name} doesn't know ${PROFESSIONS[def.profession].name}`);
  const busy = busyWith(p, charId);
  if (busy?.type === 'expedition') fail(`${ch.name} is away on an expedition`);
  for (const b of Object.values(p.town.buildings)) if (b.worker === charId) b.worker = null;
  p.town.buildings[buildingId].worker = charId;
  removeFromParties(p, charId);
}

// ---------------------------------------------------------------- salvage
function salvageOne(p, item) {
  const lvl = T.bLevel(p, 'salvage_yard');
  const y = { ...T.salvageYield(item, lvl, !!T.worker(p, 'enchanter')) };
  addMaterials(p, y);
  returnGems(p, item);
  return y;
}

// ---------------------------------------------------------------- gems & sockets
// gems in a destroyed/sold item go back into the gem pouch
export function returnGems(p, item) {
  if (!item?.sockets || !p.town) return 0;
  let n = 0;
  for (const g of item.sockets) if (g && G.parseGemKey(g)) { p.town.gems[g] = (p.town.gems[g] || 0) + 1; n++; }
  item.sockets = item.sockets.map(() => null);
  return n;
}

function jewelerWorkerLevel(p) { return T.worker(p, 'jeweler')?.profession?.level || 1; }
function rollDoubles(p, count) {
  const ch = G.doubleChance(jewelerWorkerLevel(p));
  let extra = 0;
  for (let i = 0; i < count; i++) if (Math.random() < ch) extra++;
  return extra;
}

export function cutGem(p, { kind, stat, count = 1 }) {
  kind = kind || stat;
  if (!G.GEM_KINDS[kind]) fail('Unknown gem');
  requireBuilding(p, 'jeweler');
  const w = requireWorker(p, 'jeweler');
  const n = Math.max(1, Math.min(50, Math.floor(Number(count) || 1)));
  pay(p, G.cutCost(n));
  const extra = rollDoubles(p, n);
  const key = G.gemKey(kind, 1);
  p.town.gems[key] = (p.town.gems[key] || 0) + n + extra;
  const msg = gainProfessionXp(w, 6 * n);
  return { gem: key, count: n + extra, extra, msg };
}

export function fuseGems(p, { kind, stat, tier, count = 1 }) {
  kind = kind || stat;
  const t = Math.floor(Number(tier));
  if (!G.GEM_KINDS[kind] || !(t >= 1 && t < G.MAX_GEM_TIER)) fail('Unknown gem');
  requireBuilding(p, 'jeweler');
  const w = requireWorker(p, 'jeweler');
  const need = G.GEM_TIERS[t + 1].jeweler;
  if (T.bLevel(p, 'jeweler') < need) fail(`${G.GEM_TIERS[t + 1].name} gems need Jeweler level ${need}`);
  const n = Math.max(1, Math.min(50, Math.floor(Number(count) || 1)));
  const from = G.gemKey(kind, t), to = G.gemKey(kind, t + 1);
  if ((p.town.gems[from] || 0) < G.GEM_CONFIG.fuseCount * n) fail(`You need ${G.GEM_CONFIG.fuseCount * n}× ${G.gemName(kind, t)}`);
  pay(p, G.fuseCost(t, n));
  p.town.gems[from] -= G.GEM_CONFIG.fuseCount * n;
  if (!p.town.gems[from]) delete p.town.gems[from];
  const extra = rollDoubles(p, n);
  p.town.gems[to] = (p.town.gems[to] || 0) + n + extra;
  const msg = gainProfessionXp(w, 12 * n * t);
  return { gem: to, count: n + extra, extra, msg };
}

export function socketGem(p, { itemUid, charId, index, gem }) {
  const { item } = findItemRef(p, String(itemUid), charId ? String(charId) : null);
  const g = G.parseGemKey(gem) || fail('Unknown gem');
  const i = Math.floor(Number(index));
  if (!item.sockets || !(i >= 0 && i < item.sockets.length)) fail('This item has no such socket');
  if (!(p.town.gems[gem] > 0)) fail(`You have no ${G.gemName(g.kind, g.tier)}`);
  // one gem of each kind per item
  if (item.sockets.some((x, j) => j !== i && G.parseGemKey(x)?.kind === g.kind)) fail(`This item already has a ${G.GEM_KINDS[g.kind].name}`);
  let fee = 0;
  if (item.sockets[i]) { // swap: pull the old gem out first (costs the unsocket fee)
    const old = G.parseGemKey(item.sockets[i]);
    fee = G.unsocketCost(old.tier, item.level);
    pay(p, { gold: fee });
    p.town.gems[item.sockets[i]] = (p.town.gems[item.sockets[i]] || 0) + 1;
  }
  p.town.gems[gem]--;
  if (!p.town.gems[gem]) delete p.town.gems[gem];
  item.sockets[i] = gem;
  return { item, fee };
}

export function unsocketGem(p, { itemUid, charId, index }) {
  const { item } = findItemRef(p, String(itemUid), charId ? String(charId) : null);
  const i = Math.floor(Number(index));
  const key = item.sockets?.[i];
  const g = key && G.parseGemKey(key);
  if (!g) fail('That socket is empty');
  const fee = G.unsocketCost(g.tier, item.level);
  pay(p, { gold: fee });
  item.sockets[i] = null;
  p.town.gems[key] = (p.town.gems[key] || 0) + 1;
  return { item, fee, gem: key };
}

export function drillSocket(p, { itemUid, charId }) {
  requireBuilding(p, 'jeweler');
  const w = requireWorker(p, 'jeweler');
  const { item } = findItemRef(p, String(itemUid), charId ? String(charId) : null);
  const have = (item.sockets || []).length;
  if (have >= maxSockets(item)) fail(`This item can't hold more than ${maxSockets(item)} socket${maxSockets(item) > 1 ? 's' : ''}`);
  const need = G.drillJewelerLevel(item);
  if (T.bLevel(p, 'jeweler') < need) fail(`Socket #${have + 1} needs Jeweler level ${need}`);
  pay(p, G.drillCost(item));
  item.sockets = [...(item.sockets || []), null];
  const msg = gainProfessionXp(w, 15 + item.level / 3);
  return { item, msg };
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
  T.rescaleItem(item, target); // stats and enchantment (exact for gear scaled down by ascension)
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
  item.enchant = { stat, value: T.enchantValue(stat, item.level, L, w.profession.level), ...(stat === 'critChance' ? { critInc: true } : {}) };
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
