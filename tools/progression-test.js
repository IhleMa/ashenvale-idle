// Progression: 12 zones in a chain, zone-exclusive uniques/sets and materials, town levels 6–10 with zone
// materials and hero-level unlocks, features unlocking by hero level, the slower XP curve.
import assert from 'node:assert/strict';
const { CONFIG, xpToNext } = await import('../shared/config.js');
const { ZONES } = await import('../shared/data/zones.js');
const { UNIQUES, SETS, generateUnique, generateSetItem } = await import('../shared/data/legendaries.js');
const { computeRewards } = await import('../shared/encounters.js');
const { createRng } = await import('../shared/rng.js');
const { MATERIALS, BUILDINGS } = await import('../shared/data/town.js');
const T = await import('../shared/town.js');
const { featureLock, ACTION_FEATURE } = await import('../shared/unlocks.js');
const L = await import('../server/playerLogic.js');

let n = 0;
const ok = m => { n++; console.log(`  ✔ ${m}`); };

// ---- zones
const chain = Object.values(ZONES).sort((a, b) => a.order - b.order);
assert.equal(chain.length, 12);
assert.ok(!chain[0].unlock);
for (let i = 1; i < chain.length; i++) {
  assert.equal(chain[i].unlock, chain[i - 1].id, `${chain[i].id} unlocks after ${chain[i - 1].id}`);
  assert.ok(chain[i].levelRange[0] > chain[i - 1].levelRange[0] && chain[i].levelRange[0] <= chain[i - 1].levelRange[1] + 1, 'ranges rise and overlap a little');
}
assert.equal(chain.at(-1).levelRange[1], CONFIG.levelCap);
ok('12 zones in one unlock chain, ranges spread over levels 1–60');

// old save: a player who had reached the Voidscar gets every zone before it
const old = L.newPlayer({ id: 'x', username: 'Old' });
if (old) {
  old.unlockedZones = ['whispering_woods', 'ashen_barrows', 'emberfall_caverns', 'frostpeak', 'voidscar'];
  L.migratePlayer(old);
  assert.equal(old.unlockedZones.length, 12);
  ok('old saves: zones inserted into the chain are unlocked up to the furthest zone');
}

// ---- zone-exclusive items
for (const z of chain) {
  const own = [...Object.values(UNIQUES), ...Object.values(SETS)].filter(x => x.zones?.includes(z.id));
  assert.ok(own.length >= 1, `${z.id} has exclusive items`);
  assert.ok(z.material && MATERIALS[z.material], `${z.id} has a material`);
}
const rng = createRng(5);
for (let i = 0; i < 40; i++) {
  const u = generateUnique(rng, 60, null, 'whispering_woods');
  assert.ok(u && UNIQUES[u.unique].zones.includes('whispering_woods'));
  const s = generateSetItem(rng, 60, null, null, 'ashen_barrows');
  assert.ok(s && SETS[s.set].zones.includes('ashen_barrows'));
}
assert.equal(generateSetItem(rng, 60, null, null, 'whispering_woods'), null, 'no set drops where none belongs');
ok('uniques and sets only drop in their zone');

// ---- zone materials
const z = ZONES.mirefen_marsh;
const kills = [{ enemyId: z.boss, level: 12, boss: true }, ...Array.from({ length: 400 }, () => ({ enemyId: z.enemies[0], level: 12 }))];
const r = computeRewards(kills, createRng(9), { zoneId: z.id });
assert.ok(r.materials[z.material] >= 3 && r.materials[z.material] < 30, `got ${r.materials[z.material]}`);
assert.deepEqual(computeRewards(kills, createRng(9), {}).materials, {}, 'no zone → no zone material');
ok(`zone materials drop in their zone (boss 3–5, ~2% per kill): ${r.materials[z.material]} ${MATERIALS[z.material].name}`);

// ---- town 6–10
assert.ok(Object.values(BUILDINGS).every(b => b.maxLevel === 10));
const c2 = T.upgradeCost('blacksmith', 2), c10 = T.upgradeCost('blacksmith', 10), h10 = T.upgradeCost('town_hall', 10);
assert.ok(c2.mats.sylvan_sap > 0);
assert.ok(c10.mats.dragonbone > 0 && c10.mats.void_ichor > 0);
assert.ok(h10.mats.void_ichor > c10.mats.void_ichor, 'town hall needs more');
assert.ok(T.buildSeconds('blacksmith', 10) >= 2 * 86400, 'level 10 takes days');
assert.ok(T.buildSeconds('blacksmith', 5) >= 3600);
assert.ok(T.craftCost('sword', 40, 'masterwork').mats[T.zoneMaterialForLevel(40)] > 0);
assert.equal(T.craftCost('sword', 40, 'standard').mats[T.zoneMaterialForLevel(40)], undefined);
ok(`town to level 10: zone materials, level 10 takes ${Math.round(T.buildSeconds('blacksmith', 10) / 3600)} h; top crafts need zone materials`);

// ---- unlocks by hero level
const p = { heroId: 'h', characters: { h: { level: 3 } }, town: { buildings: { jeweler: { level: 0 }, town_hall: { level: 5 } }, materials: {} }, gold: 1e9 };
assert.ok(featureLock(p, 'quests') && featureLock(p, 'rifts') && featureLock(p, 'gems'));
assert.match(T.upgradeBlocker(p, 'jeweler'), /hero level/);
p.characters.h.level = 16;
assert.equal(featureLock(p, 'rifts'), 0);
assert.ok(featureLock(p, 'gems'));
p.characters.h = { level: 1, ascensions: 1 };
assert.equal(featureLock(p, 'gems'), 0, 'ascended heroes keep everything unlocked');
assert.ok(Object.values(ACTION_FEATURE).every(f => CONFIG.featureUnlocks[f]));
ok('features and buildings unlock by hero level (ascended heroes keep them)');

// ---- slower curve
let total = 0;
for (let l = 1; l < CONFIG.levelCap; l++) total += xpToNext(l);
assert.ok(xpToNext(1) < 200 && xpToNext(59) > 2e6, 'slow at the top, quick at the start');
ok(`XP curve: level 1 needs ${xpToNext(1)}, level 59 needs ${xpToNext(59).toLocaleString('en')} (total ${total.toLocaleString('en')})`);

console.log(`Progression: all ${n} checks passed.`);
process.exit(0);
