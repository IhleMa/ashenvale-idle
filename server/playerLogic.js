// Player state model and all validated player actions (pure game logic, no networking).
import crypto from 'node:crypto';
import { CONFIG, rarityIndex, xpToNext } from '../shared/config.js';
import { CLASSES, CLASS_IDS, TRAITS } from '../shared/data/classes.js';
import { ABILITIES, abilityPriority } from '../shared/data/abilities.js';
import { ZONES } from '../shared/data/zones.js';
import { ENEMIES } from '../shared/data/enemies.js';
import { masteryLevel } from '../shared/bestiary.js';
import { track as trackQuest } from './questLogic.js';
import { evaluateItem, makeContext, sanitizeFilter, filterFromLegacy } from '../shared/lootfilter.js';
import { ACHIEVEMENTS } from '../shared/data/achievements.js';
import { migrateLegacyItem, syncUniqueItem } from '../shared/data/legendaries.js';
import { SLOTS, SLOT_IDS, generateItem, canEquip, itemSellValue, ITEM_BASES } from '../shared/data/items.js';
import { createCharacter, addXp, autoDevelop, autoLoadout, syncTree, abilitySlots, cloneRule, treeRefundCost, treeResetCost } from '../shared/character.js';
import { allocateNode as treeAllocate, refundNode as treeRefund, resetTree as treeReset, availablePoints, cleanPlan, followPlan } from '../shared/skilltree.js';
import { sanitizeRule } from '../shared/rules.js';
import { createRng, randomSeed } from '../shared/rng.js';
import { migrateTown, rollProfession, autoSalvage, returnGems } from './townLogic.js';
import { rosterLimit, recruitOffers, bLevel, rescaleItem } from '../shared/town.js';
import { busyWith } from '../shared/expeditions.js';
import { EXPEDITIONS } from '../shared/data/expeditions.js';
import { BUILDINGS } from '../shared/data/town.js';
import { SUBCLASSES } from '../shared/data/subclasses.js';
import { killXp } from '../shared/encounters.js';
import { newArena, refillAttacks } from '../shared/arena.js';

const NAMES = ['Aldric', 'Brienna', 'Cassian', 'Dagna', 'Elowen', 'Fenris', 'Gwyn', 'Halvard', 'Isolde', 'Jorah', 'Kael', 'Liora', 'Merrick', 'Nyx', 'Orin', 'Perrin', 'Quill', 'Rowan', 'Sable', 'Thane', 'Ulric', 'Vesna', 'Wren', 'Xander', 'Yara', 'Zephyr', 'Ashka', 'Bram', 'Corin', 'Delia', 'Edda', 'Faelan', 'Garrick', 'Hesper', 'Ivo', 'Juniper', 'Kestrel', 'Lysa', 'Mordecai', 'Nessa', 'Oswin', 'Petra', 'Ronan', 'Selka', 'Tamsin', 'Vale'];

export class GameError extends Error {}
const fail = msg => { throw new GameError(msg); };
const uid = () => crypto.randomBytes(6).toString('hex');

export function newPlayer(account) {
  return {
    id: account.id, name: account.username, createdAt: Date.now(), lastActive: Date.now(),
    heroId: null, characters: {}, gold: 0, premium: 0, inventory: [],
    parties: Array.from({ length: CONFIG.party.presets }, (_, i) => ({ name: `Party ${i + 1}`, members: [] })),
    activeParty: 0, zone: 'whispering_woods', unlockedZones: ['whispering_woods'], bossKills: {},
    recruitment: { offers: [], refreshedAt: 0 },
    stats: { kills: 0, bossKills: 0, recruited: 0, epicFound: 0, legendaryFound: 0, coopWins: 0, heroLevel: 1, zonesUnlocked: 1, fights: 0 },
    achievements: {},
    cosmetics: { owned: [], equipped: {} }, // bought cosmetics ('kind:id') and the ones worn
    settings: { autoSellBelow: null, autoLootAction: 'sell', autoDevelopRecruits: true, autoDevelopHero: false, publicProfile: true },
    coopChars: [], mailbox: [],
    bestiary: {},       // enemyId -> { kills, seen }
    quests: null,       // daily/weekly quests (questLogic)
    rift: { best: 0, bestTimes: {}, runs: 0, timed: 0, history: [], auto: 'off', cleared: [] },
    arena: newArena(),
    lootFilter: { enabled: false, protectUpgrades: true, rules: [] },
    lootLog: [],        // recent items handled by the loot filter
    tutorial: null,     // new-player tutorial (tutorialLogic): { step, done, base }
  };
}

// Fills defaults for players saved by older versions (keeps saves forward-compatible)
export function migratePlayer(p) {
  const base = newPlayer({ id: p.id, username: p.name });
  for (const k of Object.keys(base)) if (p[k] === undefined) p[k] = base[k];
  p.stats = { ...base.stats, ...p.stats };
  p.settings = { ...base.settings, ...p.settings };
  // tiers whose XP & gold were already paid out; players from before this rule count every tier up to their best
  const hadCleared = Array.isArray(p.rift?.cleared);
  p.rift = { ...base.rift, ...p.rift };
  if (!hadCleared) p.rift.cleared = Array.from({ length: p.rift.best || 0 }, (_, i) => i + 1);
  if (!p.lootFilter) { p.lootFilter = filterFromLegacy(p.settings); p.settings.autoSellBelow = null; }
  p.lootLog ||= [];
  // players from before the tutorial existed don't get it
  if (!p.tutorial && p.heroId) p.tutorial = { done: true, step: 0, legacy: true };
  migrateTown(p);
  // tiered affixes: convert items from before
  for (const it of p.inventory || []) migrateLegacyItem(it);
  for (const ch of Object.values(p.characters || {})) for (const it of Object.values(ch.equipment || {})) migrateLegacyItem(it);
  for (const m of p.mailbox || []) migrateLegacyItem(m.item);
  syncUniques(p); // uniques follow their current definition in the content
  // zones inserted into the chain later: a player who reached a zone also has every zone before it
  const chain = Object.values(ZONES).sort((x, y) => (x.order ?? 0) - (y.order ?? 0));
  const furthest = Math.max(-1, ...chain.map((z, i) => (p.unlockedZones.includes(z.id) ? i : -1)));
  for (let i = 0; i < furthest; i++) if (!p.unlockedZones.includes(chain[i].id)) p.unlockedZones.push(chain[i].id);
  p.unlockedZones = p.unlockedZones.filter(id => ZONES[id]);
  if (!ZONES[p.zone]) p.zone = chain[0].id;
  while (p.parties.length < CONFIG.party.presets) p.parties.push({ name: `Party ${p.parties.length + 1}`, members: p.heroId ? [p.heroId] : [] });
  for (const ch of Object.values(p.characters)) {
    for (const s of SLOT_IDS) if (!(s in ch.equipment)) ch.equipment[s] = null;
    // v0.1 → skill tree: old attribute/ability points are refunded as tree points
    if (!ch.tree) {
      ch.tree = { allocated: ['start'] };
      delete ch.attributes; delete ch.unspentAttributePoints; delete ch.abilityPoints;
      ch.abilities = {};
      if (!ch.isMain) autoDevelop(ch);
    }
    syncTree(ch);
    // v0.3: companions on auto-develop get their loadout rebuilt by priority, so abilities learned
    // after the loadout filled up (e.g. Volley) are equipped and sensibly ordered
    if (!ch.loadoutV2) {
      ch.loadoutV2 = true;
      if (!ch.isMain && p.settings?.autoDevelopRecruits !== false) {
        ch.loadout = autoLoadout(ch);
      }
    }
  }
  return p;
}

export function hero(p) { return p.heroId ? p.characters[p.heroId] : null; }
export function getChar(p, id) { return p.characters[id] || fail('Character not found'); }
export function activePartyChars(p) {
  return (p.parties[p.activeParty]?.members || []).map(id => p.characters[id]).filter(c => c && !busyWith(p, c.id));
}

function busyText(p, ch) {
  const b = busyWith(p, ch.id);
  if (!b) return null;
  return b.type === 'work' ? `${ch.name} is working at the ${BUILDINGS[b.buildingId]?.name || 'town'}` : `${ch.name} is away on an expedition to ${EXPEDITIONS[b.destId]?.name || '…'}`;
}

// --------------------------------------------------------------------------- hero creation
export function createHero(p, { name, classId, portrait }, assetIndex) {
  if (p.heroId) fail('Hero already created');
  if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z' -]{1,15}$/.test(name.trim())) fail('Name must be 2-16 letters');
  if (!CLASSES[classId]) fail('Unknown class');
  if (portrait != null && (typeof portrait !== 'string' || !assetIndex[`portraits/${portrait}`])) portrait = null;
  const id = uid();
  const ch = createCharacter({ id, name: name.trim(), classId, isMain: true, portrait, autoTree: false });
  p.characters[id] = ch;
  p.heroId = id;
  for (const party of p.parties) party.members = [id];
  p.gold = 150;
  // starter gear
  const rng = createRng(randomSeed());
  const starter = { warrior: ['sword', 'leather_chest'], mage: ['staff', 'robe'], rogue: ['dagger', 'leather_chest'], cleric: ['mace', 'robe'], ranger: ['bow', 'leather_chest'] }[classId] || [];
  for (const baseId of starter) {
    const item = generateItem(rng, 1, { baseId, rarity: 'common' });
    ch.equipment[item.slot] = item;
  }
  refreshRecruits(p, true, assetIndex);
  return ch;
}

// --------------------------------------------------------------------------- skill tree
// nodeIds: one node, or an ordered path of nodes (each must connect to the tree when it is allocated)
export function allocateNodes(p, { charId, nodeIds }) {
  const ch = getChar(p, charId);
  if (!Array.isArray(nodeIds) || nodeIds.length < 1 || nodeIds.length > 80) fail('Invalid nodes');
  if (nodeIds.length > availablePoints(ch)) fail('Not enough skill points');
  const backup = [...ch.tree.allocated];
  try {
    for (const id of nodeIds) treeAllocate(ch, String(id));
  } catch (e) {
    ch.tree.allocated = backup;
    fail(e.message);
  }
  const notEquipped = syncTree(ch);
  return { notEquipped };
}

export function refundNode(p, { charId, nodeId }) {
  const ch = getChar(p, charId);
  const cost = treeRefundCost(ch);
  if (p.gold < cost) fail(`Refunding a node costs ${cost} gold`);
  try { treeRefund(ch, String(nodeId)); } catch (e) { fail(e.message); }
  p.gold -= cost;
  syncTree(ch);
  return { cost };
}

// ---------------------------------------------------------------- planned build: points go to these nodes as they come
export function setTreePlan(p, { charId, plan }) {
  const ch = getChar(p, charId);
  if (!Array.isArray(plan) || plan.length > 300) fail('Invalid plan');
  const clean = cleanPlan(ch, plan.map(String));
  if (clean.length !== plan.length) fail('Every planned node has to connect to the tree or an earlier planned node');
  ch.tree.plan = clean;
  const n = followPlan(ch);
  syncTree(ch);
  return { allocated: n, planned: ch.tree.plan.length };
}

// ---------------------------------------------------------------- builds: saved skill tree + ability loadout + rules
// Each character has BUILD_SLOTS slots. Saving and switching are free; switching loads the saved tree (trimmed to
// the points the character has and the nodes that exist in its current tree), the loadout and the ability rules.
export const BUILD_SLOTS = 3;
const buildSlot = slot => { const i = Math.floor(Number(slot)); if (!(i >= 0 && i < BUILD_SLOTS)) fail('Unknown build slot'); return i; };
export function saveBuild(p, { charId, slot, name }) {
  const ch = getChar(p, charId);
  const i = buildSlot(slot);
  ch.builds ||= [];
  const old = ch.builds[i];
  const nm = String(name ?? old?.name ?? '').trim().slice(0, 24) || `Build ${i + 1}`;
  ch.builds[i] = { name: nm, allocated: [...ch.tree.allocated], plan: [...(ch.tree.plan || [])], loadout: [...ch.loadout], rules: JSON.parse(JSON.stringify(ch.rules || {})), subclass: ch.subclass || null, level: ch.level, points: ch.tree.allocated.length - 1, savedAt: Date.now() };
  ch.activeBuild = i;
  return { slot: i, name: nm };
}
export function loadBuild(p, { charId, slot }) {
  const ch = getChar(p, charId);
  const i = buildSlot(slot);
  const b = ch.builds?.[i] || fail('That build slot is empty');
  ch.tree.allocated = [...b.allocated];
  syncTree(ch); // drops nodes that don't fit (other ascendancy, fewer points) and learns the abilities
  // nodes that didn't fit go back to the front of the plan, so they come back with the next levels
  const kept = new Set(ch.tree.allocated);
  ch.tree.plan = cleanPlan(ch, [...b.allocated.filter(id => !kept.has(id)), ...(b.plan || [])]);
  ch.loadout = b.loadout.filter(a => ch.abilities[a] && !ABILITIES[a]?.passive).slice(0, abilitySlots(ch));
  for (const [a, r] of Object.entries(b.rules || {})) if (ch.abilities[a]) ch.rules[a] = JSON.parse(JSON.stringify(r));
  ch.activeBuild = i;
  return { slot: i, name: b.name, missing: Math.max(0, b.allocated.length - ch.tree.allocated.length) };
}
export function renameBuild(p, { charId, slot, name }) {
  const ch = getChar(p, charId);
  const b = ch.builds?.[buildSlot(slot)] || fail('That build slot is empty');
  b.name = String(name || '').trim().slice(0, 24) || b.name;
  return { name: b.name };
}
export function deleteBuild(p, { charId, slot }) {
  const ch = getChar(p, charId);
  const i = buildSlot(slot);
  if (!ch.builds?.[i]) fail('That build slot is empty');
  ch.builds[i] = null;
  if (ch.activeBuild === i) ch.activeBuild = null;
}

export function resetTree(p, { charId }) {
  const ch = getChar(p, charId);
  const cost = treeResetCost(ch);
  if (ch.tree.allocated.length <= 1) fail('Nothing to reset');
  if (p.gold < cost) fail(`Resetting the tree costs ${cost} gold`);
  p.gold -= cost;
  treeReset(ch);
  syncTree(ch);
  return { cost };
}

export function autoTree(p, { charId }) {
  const ch = getChar(p, charId);
  if (availablePoints(ch) < 1) fail('No skill points to spend');
  autoDevelop(ch);
}

export function setLoadout(p, { charId, loadout }) {
  const ch = getChar(p, charId);
  if (!Array.isArray(loadout)) fail('Invalid loadout');
  const clean = [...new Set(loadout)].filter(a => typeof a === 'string');
  if (clean.length > abilitySlots(ch)) fail(`Only ${abilitySlots(ch)} ability slots`);
  for (const a of clean) if (!ch.abilities[a]) fail('Ability not unlocked');
  for (const a of clean) if (ABILITIES[a]?.passive) fail(`${ABILITIES[a].name} is passive and works without a slot`);
  ch.loadout = clean;
}

export function setRule(p, { charId, abilityId, rule }) {
  const ch = getChar(p, charId);
  if (!ch.abilities[abilityId]) fail('Ability not unlocked');
  try { ch.rules[abilityId] = sanitizeRule(rule, ABILITIES[abilityId]); } catch (e) { fail(e.message); }
}

export function resetRule(p, { charId, abilityId }) {
  const ch = getChar(p, charId);
  if (!ch.abilities[abilityId]) fail('Ability not unlocked');
  ch.rules[abilityId] = cloneRule(ABILITIES[abilityId].defaultRule);
}

export function setRole(p, { charId, role }) {
  const ch = getChar(p, charId);
  if (!CONFIG.roles[role]) fail('Unknown role');
  ch.role = role;
}

// --------------------------------------------------------------------------- equipment
function findItem(p, itemUid) {
  const idx = p.inventory.findIndex(i => i.uid === itemUid);
  if (idx < 0) fail('Item not found');
  return idx;
}

export function equip(p, { charId, itemUid }) {
  const ch = getChar(p, charId);
  const idx = findItem(p, itemUid);
  const item = p.inventory[idx];
  if (!canEquip(item, ch)) fail(item.requiredLevel > ch.level ? `Requires level ${item.requiredLevel}` : `${CLASSES[ch.classId].name}s cannot use this`);
  p.inventory.splice(idx, 1);
  const old = ch.equipment[item.slot];
  ch.equipment[item.slot] = item;
  if (old) p.inventory.push(old);
}

export function unequip(p, { charId, slot }) {
  const ch = getChar(p, charId);
  if (!SLOT_IDS.includes(slot)) fail('Invalid slot');
  const item = ch.equipment[slot];
  if (!item) fail('Nothing equipped');
  if (p.inventory.length >= CONFIG.inventory.limit) fail('Inventory is full');
  ch.equipment[slot] = null;
  p.inventory.push(item);
}

export function sellItem(p, { itemUid }) {
  const idx = findItem(p, itemUid);
  if (p.inventory[idx].locked) fail('Item is locked');
  const [item] = p.inventory.splice(idx, 1);
  returnGems(p, item);
  const v = itemSellValue(item);
  p.gold += v;
  return v;
}

export function sellByRarity(p, { maxRarity }) {
  const max = rarityIndex(maxRarity);
  let total = 0, n = 0;
  p.inventory = p.inventory.filter(i => {
    if (i.locked || rarityIndex(i.rarity) > max) return true;
    returnGems(p, i);
    total += itemSellValue(i); n++; return false;
  });
  p.gold += total;
  return { count: n, gold: total };
}

export function toggleLock(p, { itemUid }) {
  const item = p.inventory[findItem(p, itemUid)];
  item.locked = !item.locked;
}

export function setSettings(p, s) {
  if ('autoSellBelow' in s) p.settings.autoSellBelow = s.autoSellBelow === null || CONFIG.rarities.some(r => r.id === s.autoSellBelow) ? s.autoSellBelow : null;
  if ('autoDevelopRecruits' in s) p.settings.autoDevelopRecruits = !!s.autoDevelopRecruits;
  if ('autoDevelopHero' in s) p.settings.autoDevelopHero = !!s.autoDevelopHero;
  if ('publicProfile' in s) p.settings.publicProfile = !!s.publicProfile;
  if ('autoLootAction' in s) p.settings.autoLootAction = s.autoLootAction === 'salvage' ? 'salvage' : 'sell';
}

// Adds an item (auto-sell rules & capacity respected). Returns 'kept' | 'sold'
export function receiveItem(p, item) {
  const r = rarityIndex(item.rarity);
  if (r >= 3) p.stats.epicFound++;
  if (r >= 4) p.stats.legendaryFound++;
  if (item.unique || item.set) {
    // uniques and set pieces are never auto-sold; overflow goes to the mailbox
    if (p.inventory.length >= CONFIG.inventory.limit) { sendMail(p, { item, from: 'Loot', note: 'Your inventory was full.' }); return 'mailed'; }
    p.inventory.push(item);
    return 'kept';
  }
  // loot filter: first matching rule decides
  const verdict = evaluateItem(p.lootFilter, item, makeContext(p));
  if (verdict.action !== 'keep') return disposeItem(p, item, verdict.action, verdict.reason);
  if (p.inventory.length >= CONFIG.inventory.limit) {
    // inventory full: salvage or sell (setting "when inventory is full")
    return disposeItem(p, item, p.settings.autoLootAction === 'salvage' ? 'salvage' : 'sell', 'Inventory full');
  }
  p.inventory.push(item);
  return 'kept';
}

// Salvages or sells an item that never enters the inventory, and logs it for the player
function disposeItem(p, item, action, reason) {
  const entry = { name: item.name, rarity: item.rarity, level: item.level, slot: item.slot, baseId: item.baseId, reason, at: Date.now() };
  if (action === 'salvage' && p.town) {
    entry.action = 'salvaged';
    entry.materials = autoSalvage(p, item);
    p.stats.autoSalvaged = (p.stats.autoSalvaged || 0) + 1;
    trackQuest(p, 'salvage', 1);
  } else {
    entry.action = 'sold';
    entry.gold = itemSellValue(item);
    p.gold += entry.gold;
    p.stats.autoSold = (p.stats.autoSold || 0) + 1;
  }
  p.lootLog ||= [];
  p.lootLog.unshift(entry);
  if (p.lootLog.length > 60) p.lootLog.length = 60;
  return entry.action;
}

// ---------------------------------------------------------------- loot filter
export function setLootFilter(p, { filter }) {
  p.lootFilter = sanitizeFilter(filter);
  return { rules: p.lootFilter.rules.length };
}

// Runs the filter over the current inventory (dryRun: only report)
export function applyLootFilter(p, { dryRun = false } = {}) {
  const ctx = makeContext(p);
  const filter = { ...p.lootFilter, enabled: true };
  const hits = [];
  for (const item of p.inventory) {
    const v = evaluateItem(filter, item, ctx);
    if (v.action !== 'keep') hits.push({ item, action: v.action, reason: v.reason });
  }
  const summary = { salvage: hits.filter(h => h.action === 'salvage').length, sell: hits.filter(h => h.action === 'sell').length, items: hits.map(h => ({ uid: h.item.uid, action: h.action, reason: h.reason })) };
  if (dryRun) return summary;
  if (!hits.length) fail('Nothing in your inventory matches the filter');
  const gone = new Set(hits.map(h => h.item.uid));
  p.inventory = p.inventory.filter(i => !gone.has(i.uid));
  const materials = {};
  let gold = 0;
  for (const h of hits) {
    if (h.action === 'salvage' && p.town) for (const [k, v] of Object.entries(autoSalvage(p, h.item))) materials[k] = (materials[k] || 0) + v;
    else { returnGems(p, h.item); const g = itemSellValue(h.item); gold += g; p.gold += g; }
  }
  if (summary.salvage) trackQuest(p, 'salvage', summary.salvage);
  return { ...summary, items: undefined, gold, materials };
}

// --------------------------------------------------------------------------- mailbox
// Mail carries items, gold or materials (auction sales, expired listings, overflow loot, admin gifts).
// Updates every unique the player has to its current definition. An equipped unique that moved to another slot
// (or that its wearer can no longer use) is taken off and sent by mail. Returns how many items changed.
export function syncUniques(p) {
  let n = 0;
  for (const it of p.inventory || []) if (syncUniqueItem(it)) n++;
  for (const m of p.mailbox || []) if (m.item && syncUniqueItem(m.item)) n++;
  for (const ch of Object.values(p.characters || {})) {
    for (const [slot, it] of Object.entries(ch.equipment || {})) {
      const r = it && syncUniqueItem(it);
      if (!r) continue;
      n++;
      const wrongClass = it.classes && !it.classes.includes(ch.classId);
      if (it.slot === slot && !wrongClass) continue;
      ch.equipment[slot] = null;
      const now = SLOTS[it.slot]?.label || it.slot;
      sendMail(p, { item: it, from: 'Ashenvale', note: `${it.name} was changed${r.slotChanged ? ` and is now worn as ${/^[aeiou]/i.test(now) ? 'an' : 'a'} ${now.toLowerCase()}` : ` and can no longer be used by ${ch.name}`}, so it was taken off ${ch.name} and sent to you.` });
    }
  }
  return n;
}

export function sendMail(p, { item = null, gold = 0, premium = 0, materials = null, from = 'System', note = '' }) {
  p.mailbox ||= [];
  p.mailbox.push({ id: uid(), item, gold: Math.max(0, Math.floor(gold)), premium: Math.max(0, Math.floor(premium)), materials, from, note, at: Date.now() });
  if (p.mailbox.length > 200) p.mailbox.splice(0, p.mailbox.length - 200);
}

export function collectMail(p, { id }) {
  p.mailbox ||= [];
  const ids = id ? [String(id)] : p.mailbox.map(m => m.id);
  let gold = 0, items = 0, skipped = 0, premium = 0;
  for (const mid of ids) {
    const idx = p.mailbox.findIndex(m => m.id === mid);
    if (idx < 0) continue;
    const m = p.mailbox[idx];
    if (m.item && p.inventory.length >= CONFIG.inventory.limit) { skipped++; continue; }
    if (m.item) { p.inventory.push(m.item); items++; }
    if (m.gold) { p.gold += m.gold; gold += m.gold; }
    if (m.premium) { p.premium = (p.premium || 0) + m.premium; premium += m.premium; }
    if (m.materials) { p.town ||= { materials: {} }; for (const [k, v] of Object.entries(m.materials)) p.town.materials[k] = (p.town.materials[k] || 0) + v; }
    p.mailbox.splice(idx, 1);
  }
  if (!gold && !items && !premium && skipped) fail('Your inventory is full');
  return { gold, items, skipped, premium };
}

// --------------------------------------------------------------------------- recruitment
export function recruitCost(p, offer) {
  if (p.stats.recruited === 0) return 0; // first companion is free
  return CONFIG.recruitment.costBase + CONFIG.recruitment.costPerLevel * offer.level;
}

export function refreshRecruits(p, free = false, assetIndex = {}) {
  const h = hero(p);
  const lvl = h ? h.level : 1;
  if (!free) {
    const cost = CONFIG.recruitment.refreshCostPerLevel * lvl;
    if (p.gold < cost) fail(`Refreshing costs ${cost} gold`);
    p.gold -= cost;
  }
  const rng = createRng(randomSeed());
  const offers = [];
  const classes = [...CLASS_IDS];
  // first offer set guarantees complementary classes for a new hero
  const innLevel = p.town ? bLevel(p, 'inn') : 1;
  for (let i = 0; i < (p.town ? recruitOffers(p) : CONFIG.recruitment.offers); i++) {
    const classId = classes.length ? classes.splice(rng.int(0, classes.length - 1), 1)[0] : rng.pick(CLASS_IDS);
    const portraits = Object.keys(assetIndex).filter(k => k.startsWith(`portraits/${classId}`)).map(k => k.slice(10));
    offers.push({
      offerId: uid(), name: rng.pick(NAMES), classId, trait: rng.pick(Object.keys(TRAITS)),
      level: Math.max(1, lvl - rng.int(0, 2)), portrait: portraits.length ? rng.pick(portraits) : null,
      profession: rollProfession(rng, innLevel),
    });
  }
  p.recruitment = { offers, refreshedAt: Date.now() };
}

export function maybeAutoRefreshRecruits(p, assetIndex) {
  if (Date.now() - p.recruitment.refreshedAt > CONFIG.recruitment.refreshSeconds * 1000) {
    refreshRecruits(p, true, assetIndex);
    return true;
  }
  return false;
}

export function recruit(p, { offerId }) {
  if (!p.heroId) fail('Create your hero first');
  const idx = p.recruitment.offers.findIndex(o => o.offerId === offerId);
  if (idx < 0) fail('Recruit no longer available');
  const recruits = Object.values(p.characters).filter(c => !c.isMain).length;
  if (recruits >= rosterLimit(p)) fail(`Your Inn has room for ${rosterLimit(p)} companions — upgrade it in the Town`);
  const offer = p.recruitment.offers[idx];
  const cost = recruitCost(p, offer);
  if (p.gold < cost) fail(`Costs ${cost} gold`);
  p.gold -= cost;
  const ch = createCharacter({ id: uid(), name: offer.name, classId: offer.classId, level: offer.level, portrait: offer.portrait, trait: offer.trait });
  ch.profession = offer.profession ? { ...offer.profession } : rollProfession(createRng(randomSeed()), 1);
  p.characters[ch.id] = ch;
  p.recruitment.offers.splice(idx, 1);
  p.stats.recruited++;
  // put new recruit into the active party if there is space
  const party = p.parties[p.activeParty];
  if (party.members.length < CONFIG.party.size) party.members.push(ch.id);
  return ch;
}

export function dismiss(p, { charId }) {
  const ch = getChar(p, charId);
  if (ch.isMain) fail('Your hero cannot be dismissed');
  if (busyWith(p, charId)?.type === 'expedition') fail(`${ch.name} is away on an expedition`);
  for (const item of Object.values(ch.equipment)) if (item) receiveItem(p, item);
  delete p.characters[charId];
  for (const party of p.parties) party.members = party.members.filter(id => id !== charId);
  p.coopChars = p.coopChars.filter(id => id !== charId);
  for (const b of Object.values(p.town?.buildings || {})) if (b.worker === charId) b.worker = null;
}
// note: dismissing is blocked while a companion is on an expedition (see dismiss)

export function renameCharacter(p, { charId, name }) {
  const ch = getChar(p, charId);
  if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z' -]{1,15}$/.test(name.trim())) fail('Name must be 2-16 letters');
  ch.name = name.trim();
}

// --------------------------------------------------------------------------- parties
export function setParty(p, { index, members }) {
  const party = p.parties[index] || fail('Invalid party');
  if (!Array.isArray(members)) fail('Invalid members');
  const clean = [...new Set(members)];
  if (clean.length > CONFIG.party.size) fail(`Party size is limited to ${CONFIG.party.size}`);
  for (const id of clean) { const ch = getChar(p, id); const busy = busyText(p, ch); if (busy) fail(busy); }
  if (!clean.includes(p.heroId)) fail('Your hero must be in every party');
  party.members = clean;
}

export function renameParty(p, { index, name }) {
  const party = p.parties[index] || fail('Invalid party');
  if (typeof name !== 'string' || name.trim().length < 1 || name.length > 24) fail('Invalid name');
  party.name = name.trim().replace(/[<>]/g, '');
}

export function activateParty(p, { index }) {
  if (!p.parties[index]) fail('Invalid party');
  if (!p.parties[index].members.includes(p.heroId)) fail('Party is empty');
  p.activeParty = index;
}

export function setCoopChars(p, { charIds }) {
  if (!Array.isArray(charIds)) fail('Invalid selection');
  const clean = [...new Set(charIds)].filter(id => p.characters[id] && id !== p.heroId);
  for (const id of clean) { const busy = busyText(p, p.characters[id]); if (busy) fail(busy); }
  p.coopChars = clean.slice(-(CONFIG.coop.recruitsPerPlayer ?? 1)); // the latest pick wins
}

// The recruits a player offers for co-op, in preference order (who actually fights is decided by shared/coop.js).
// Defaults to the companions of the active party when nothing was chosen.
export function coopPicks(p) {
  const picks = (p.coopChars.length ? p.coopChars : (p.parties[p.activeParty]?.members || []).filter(id => id !== p.heroId)).filter(id => !busyWith(p, id));
  return picks.map(id => p.characters[id]).filter(Boolean).slice(0, CONFIG.coop.recruitsPerPlayer ?? 1);
}

// --------------------------------------------------------------------------- zones
export function setZone(p, { zoneId }) {
  if (!ZONES[zoneId]) fail('Unknown zone');
  if (!p.unlockedZones.includes(zoneId)) fail('Zone locked — defeat the previous zone boss');
  p.zone = zoneId;
}

export function onBossDefeated(p, zoneId) {
  p.bossKills[zoneId] = (p.bossKills[zoneId] || 0) + 1;
  const unlocked = [];
  for (const z of Object.values(ZONES)) {
    if (z.unlock === zoneId && !p.unlockedZones.includes(z.id)) { p.unlockedZones.push(z.id); unlocked.push(z); }
  }
  p.stats.zonesUnlocked = p.unlockedZones.length;
  return unlocked;
}

// --------------------------------------------------------------------------- rewards & achievements
// chars: characters who participated. Returns { levelUps: [{name, level}], sold, kept }
// called as fn(player, character, newLevel, secondsAtPreviousLevel) — used by the balance dashboard
export const levelHooks = [];

// An ascended hero gets XP as if enemies were at most ascension.xpLevelGap levels above it, so being carried
// through a high zone by max-level companions doesn't skip the climb.
export function ascendedXpFactor(ch, killList) {
  const gap = CONFIG.ascension?.xpLevelGap;
  if (!ch.subclass || !gap || !killList?.length) return 1;
  let full = 0, capped = 0;
  for (const k of killList) {
    full += killXp(k);
    capped += k.level > ch.level + gap ? killXp({ ...k, level: ch.level + gap }) : killXp(k);
  }
  return full > 0 ? capped / full : 1;
}

// --------------------------------------------------------------------------- ascension
// At max level the hero may ascend into a subclass of its class: back to level 1 with a fresh skill tree that
// has the subclass branches, a permanent subclass bonus and extra skill points. Equipped gear is mailed to the
// player. An ascended hero at max level again may switch to another subclass the same way.
export function canAscend(p) {
  const h = hero(p);
  if (!CONFIG.ascension?.enabled) return 'Ascension is turned off on this server';
  if (!h) return 'No hero';
  if (h.level < CONFIG.levelCap) return `Your hero needs level ${CONFIG.levelCap} to ascend`;
  return null;
}
export function ascendHero(p, { subclassId }) {
  const why = canAscend(p);
  if (why) fail(why);
  const h = hero(p);
  const sub = SUBCLASSES[subclassId] || fail('Unknown subclass');
  if (sub.classId !== h.classId) fail(`${sub.name} is not a ${CLASSES[h.classId].name} subclass`);
  if (h.subclass === sub.id) fail(`${h.name} already is a ${sub.name}`);
  // the hero keeps its gear, scaled down to level 1 (reforge it back up in town while levelling)
  let rescaled = 0;
  for (const slot of SLOT_IDS) {
    const item = h.equipment[slot];
    if (!item) continue;
    rescaleItem(item, 1);
    rescaled++;
  }
  const from = h.subclass || null;
  h.subclass = sub.id;
  h.ascensions = (h.ascensions || 0) + 1;
  h.ascendedAt = Date.now();
  (h.ascensionHistory ||= []).push({ subclass: sub.id, from, at: h.ascendedAt });
  h.level = 1;
  h.xp = 0;
  h.levelAt = Date.now();
  h.tree = { allocated: ['start'] };
  h.loadout = [];
  syncTree(h);
  h.loadout = autoLoadout(h);
  if (p.settings?.autoDevelopHero) autoDevelop(h);
  p.stats.ascensions = (p.stats.ascensions || 0) + 1;
  p.stats.heroLevel = 1;
  // the party now fights at the hero's level (level sync): start again in the lowest unlocked zone
  const start = Object.values(ZONES).filter(z => (p.unlockedZones || []).includes(z.id)).sort((a, b) => a.levelRange[0] - b.levelRange[0])[0];
  if (start) p.zone = start.id;
  return { subclass: sub.id, name: sub.name, rescaled, switched: !!from };
}

// Admin: give experience to characters. mode "xp" adds raw XP (no hero/trait bonus, no ascension cap),
// "levels" adds whole levels (keeping progress into the current level), "set" sets an exact level (also lower).
// Level-ups behave like normal ones (skill points, auto-develop) but don't count for the balance statistics.
export function adminGrantXp(p, { target = 'hero', mode = 'xp', amount = 0 } = {}) {
  const chars = target === 'hero' ? [hero(p)]
    : target === 'party' ? (p.parties[p.activeParty]?.members || []).map(id => p.characters[id])
    : target === 'all' ? Object.values(p.characters)
    : [p.characters[target]];
  const list = chars.filter(Boolean);
  if (!list.length) fail('No matching character');
  amount = Math.floor(Number(amount) || 0);
  if (mode === 'xp' && (amount < 1 || amount > 1e12)) fail('XP must be between 1 and 1,000,000,000,000');
  if (mode === 'levels' && (amount < 1 || amount > CONFIG.levelCap)) fail(`Levels must be between 1 and ${CONFIG.levelCap}`);
  if (mode === 'set' && (amount < 1 || amount > CONFIG.levelCap)) fail(`Level must be between 1 and ${CONFIG.levelCap}`);
  if (!['xp', 'levels', 'set'].includes(mode)) fail('Unknown mode');
  const now = Date.now();
  const out = [];
  for (const ch of list) {
    const from = ch.level;
    if (mode === 'xp') addXp(ch, amount);
    else if (mode === 'levels') {
      const frac = ch.level < CONFIG.levelCap ? ch.xp / xpToNext(ch.level) : 0;
      for (let i = 0; i < amount && ch.level < CONFIG.levelCap; i++) ch.level++;
      ch.xp = ch.level < CONFIG.levelCap ? Math.floor(frac * xpToNext(ch.level)) : 0;
    } else { ch.level = amount; ch.xp = 0; }
    if (ch.level !== from) {
      ch.levelAt = now; // don't let the jump distort "time per level" statistics
      if (ch.level > from) followPlan(ch);
      if (ch.level > from && ((ch.isMain && p.settings.autoDevelopHero) || (!ch.isMain && p.settings.autoDevelopRecruits))) autoDevelop(ch);
      else syncTree(ch); // a lower level drops skill points that are no longer covered
    }
    out.push({ name: ch.name, from, to: ch.level, isMain: !!ch.isMain });
  }
  const h = hero(p);
  if (h) p.stats.heroLevel = h.level;
  return out;
}

export function applyRewards(p, chars, rewards) {
  const levelUps = [];
  const now = Date.now();
  for (const ch of chars) {
    if (!p.characters[ch.id]) continue;
    const bonus = ch.isMain ? CONFIG.mainCharacter.xpBonus : 0;
    const traitXp = ch.trait ? TRAITS[ch.trait]?.bonus?.xpPct || 0 : 0;
    const gained = addXp(ch, rewards.xp * (1 + bonus + traitXp) * ascendedXpFactor(ch, rewards.killList));
    if (gained) {
      levelUps.push({ name: ch.name, level: ch.level, charId: ch.id });
      // time spent per level (split evenly when several levels came at once)
      if (ch.levelAt) for (let l = ch.level - gained + 1; l <= ch.level; l++) for (const fn of levelHooks) fn(p, ch, l, (now - ch.levelAt) / 1000 / gained);
      ch.levelAt = now;
      followPlan(ch); // a planned build gets the new points first
      if ((ch.isMain && p.settings.autoDevelopHero) || (!ch.isMain && p.settings.autoDevelopRecruits)) {
        autoDevelop(ch);
      } else {
        syncTree(ch); // newly earned points stay unspent; nothing else changes
      }
    }
  }
  p.gold += rewards.gold;
  if (rewards.materials && p.town) for (const [k, v] of Object.entries(rewards.materials)) p.town.materials[k] = (p.town.materials[k] || 0) + v;
  if (rewards.gems && p.town) for (const [k, v] of Object.entries(rewards.gems)) p.town.gems[k] = (p.town.gems[k] || 0) + v;
  let sold = 0, kept = 0;
  for (const it of rewards.items) (receiveItem(p, it) === 'kept' ? kept++ : sold++);
  p.stats.kills += rewards.kills || 0;
  const h = hero(p);
  if (h) p.stats.heroLevel = h.level;
  return { levelUps, sold, kept };
}

// Bestiary: remember which enemies were met and how many were killed. Returns new mastery ranks.
export function recordBestiary(p, { kills = [], seen = [] }) {
  const b = p.bestiary || (p.bestiary = {});
  const now = Date.now();
  for (const id of seen) if (ENEMIES[id] && !b[id]) b[id] = { kills: 0, seen: now };
  const ups = [];
  for (const k of kills) {
    const e = b[k.enemyId] || (b[k.enemyId] = { kills: 0, seen: now });
    const before = masteryLevel(k.enemyId, e.kills);
    e.kills++;
    const after = masteryLevel(k.enemyId, e.kills);
    if (after > before) ups.push({ enemyId: k.enemyId, name: ENEMIES[k.enemyId].name, level: after });
  }
  return ups;
}

export function checkAchievements(p) {
  const granted = [];
  for (const a of Object.values(ACHIEVEMENTS)) {
    if (p.achievements[a.id]) continue;
    if ((p.stats[a.stat] || 0) >= a.goal) {
      p.achievements[a.id] = Date.now();
      p.gold += a.reward.gold || 0;
      granted.push(a);
    }
  }
  return granted;
}

// --------------------------------------------------------------------------- client view
export function publicPlayer(p) {
  return {
    id: p.id, name: p.name, heroId: p.heroId, characters: p.characters, gold: p.gold, premium: p.premium || 0, inventory: p.inventory,
    parties: p.parties, activeParty: p.activeParty, zone: p.zone, unlockedZones: p.unlockedZones, bossKills: p.bossKills,
    recruitment: { ...p.recruitment, costs: Object.fromEntries(p.recruitment.offers.map(o => [o.offerId, recruitCost(p, o)])) },
    stats: p.stats, achievements: p.achievements, settings: p.settings, coopChars: p.coopChars,
    town: p.town, expeditions: p.expeditions || [], mailbox: p.mailbox || [], serverTime: Date.now(),
    bestiary: p.bestiary || {}, quests: p.quests, rift: p.rift, lootFilter: p.lootFilter, lootLog: p.lootLog || [],
    tutorial: p.tutorial || null, cosmetics: p.cosmetics || { owned: [], equipped: {} },
    arena: p.arena ? (refillAttacks(p.arena), { ...p.arena, recent: undefined, nextAttackAt: refillAttacks(p.arena) }) : null,
  };
}

export { ITEM_BASES };

// --------------------------------------------------------------------------- premium currency
// maxCost: the price the player saw; protects against paying more if the time/rate changed meanwhile
export function spendPremium(p, cost, maxCost) {
  if (maxCost != null && cost > Number(maxCost)) fail(`The price changed to ${cost} crystals — please try again`);
  if ((p.premium || 0) < cost) fail(`You need ${cost} Ashen Crystals (you have ${p.premium || 0})`);
  p.premium -= cost;
  p.stats.premiumSpent = (p.stats.premiumSpent || 0) + cost;
}
