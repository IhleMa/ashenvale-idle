// Town logic test: node tools/town-test.js
import * as L from '../server/playerLogic.js';
import * as TL from '../server/townLogic.js';
import * as T from '../shared/town.js';
import { generateItem } from '../shared/data/items.js';
import { createRng } from '../shared/rng.js';
import { computeStats } from '../shared/stats.js';
const ok = (c, m) => console.log(c ? '✔' : '✘', m);
const tryErr = f => { try { f(); return null; } catch (e) { return e.message; } };
const p = L.newPlayer({ id: 'abc', username: 'tester' });
L.migratePlayer(p);
L.createHero(p, { name: 'Hero', classId: 'warrior' }, {});
ok(p.town && p.town.buildings.inn.level === 1 && p.town.buildings.mine.level === 0, 'town created with starter buildings');
ok(p.recruitment.offers.length === T.recruitOffers(p) && p.recruitment.offers.every(o => o.profession), `offers (${p.recruitment.offers.length}) have professions`);
// roster limit
p.gold = 1e6;
for (let i = 0; i < 6; i++) { L.refreshRecruits(p, true, {}); try { L.recruit(p, { offerId: p.recruitment.offers[0].offerId }); } catch (e) { ok(i === 3 && /Inn/.test(e.message), `roster capped at ${T.rosterLimit(p)}: ${e.message}`); break; } }
// salvage
const rng = createRng(1);
for (let i = 0; i < 40; i++) p.inventory.push(generateItem(rng, 20, { boost: 2 }));
const r = TL.salvageByRarity(p, { maxRarity: 'mythic' });
ok(r.count === 40 && r.materials.arcane_dust > 0, `salvaged 40 items → ${JSON.stringify(r.materials)}`);
// build mine
let e = tryErr(() => TL.upgradeBuilding(p, { buildingId: 'blacksmith' }));
ok(!e || /Missing/.test(e), 'blacksmith requires materials: ' + e);
p.town.materials = { metal_scrap: 999, leather_scrap: 999, cloth_scrap: 999, ore: 999, gem_fragment: 999, herb: 999, arcane_dust: 999, magic_essence: 99, prismatic_shard: 99, void_crystal: 99 };
TL.upgradeBuilding(p, { buildingId: 'mine' });
e = tryErr(() => TL.upgradeBuilding(p, { buildingId: 'blacksmith' }));
ok(/at a time/.test(e), 'concurrent build limit: ' + e);
p.town.buildings.mine.upgrade.endsAt = Date.now() - 1;
ok(TL.finishConstructions(p).length === 1 && p.town.buildings.mine.level === 1, 'construction finishes');
e = tryErr(() => TL.upgradeBuilding(p, { buildingId: 'mine' }));
ok(/Town Hall/.test(e), 'building capped by town hall: ' + e);
// workers
const miner = Object.values(p.characters).find(c => !c.isMain);
miner.profession = { id: 'mining', level: 5, xp: 0 };
TL.assignWorker(p, { buildingId: 'mine', charId: miner.id });
p.town.buildings.mine.updatedAt -= 3600000 * 2;
const st = T.gatherStored(p, 'mine');
ok(st.ore > 19, `2h production ~ ${st.ore.toFixed(1)} ore`);
const before = p.town.materials.ore;
TL.collect(p, { buildingId: 'mine' });
ok(p.town.materials.ore - before >= 19, 'collect adds ore');
// blacksmith craft
for (const b of ['blacksmith', 'enchanter', 'alchemy_lab']) { p.town.buildings[b].level = 1; }
e = tryErr(() => TL.craft(p, { buildingId: 'blacksmith', baseId: 'sword', level: 10 }, 20));
ok(/Assign/.test(e), 'craft needs worker: ' + e);
const smith = Object.values(p.characters).filter(c => !c.isMain)[1];
smith.profession = { id: 'blacksmithing', level: 10, xp: 0 };
TL.assignWorker(p, { buildingId: 'blacksmith', charId: smith.id });
e = tryErr(() => TL.craft(p, { buildingId: 'blacksmith', baseId: 'staff', level: 10 }, 20));
ok(/can't make/.test(e), 'wrong recipe rejected');
e = tryErr(() => TL.craft(p, { buildingId: 'blacksmith', baseId: 'sword', level: 30 }, 20));
ok(/Item level/.test(e), 'level cap enforced: ' + e);
const c = TL.craft(p, { buildingId: 'blacksmith', baseId: 'sword', level: 12 }, 20);
ok(c.item.level === 12 && c.item.baseId === 'sword', `crafted ${c.item.name} (${c.item.rarity})`);
// reforge
const old = generateItem(rng, 3, { baseId: 'plate_chest', rarity: 'rare' });
p.inventory.push(old);
const oldDef = old.stats.defense;
TL.reforge(p, { buildingId: 'blacksmith', itemUid: old.uid }, 20);
ok(old.level === 12 && old.stats.defense > oldDef, `reforged defense ${oldDef} → ${old.stats.defense}`);
// enchant equipped hero item
const hero = L.hero(p);
const sw = hero.equipment.weapon;
const ench = Object.values(p.characters).filter(c => !c.isMain)[2];
ench.profession = { id: 'enchanting', level: 1, xp: 0 };
TL.assignWorker(p, { buildingId: 'enchanter', charId: ench.id });
const s0 = computeStats(hero).attributes.str;
TL.enchant(p, { itemUid: sw.uid, charId: hero.id, stat: 'str' });
ok(computeStats(hero).attributes.str > s0, `enchant raises hero STR ${s0} → ${computeStats(hero).attributes.str}`);
e = tryErr(() => TL.enchant(p, { itemUid: sw.uid, charId: hero.id, stat: 'critChance' }));
ok(/higher level/.test(e), 'enchant stat gated by level');
// alchemy
const alch = Object.values(p.characters).filter(c => !c.isMain)[0];
alch.profession = { id: 'alchemy', level: 1, xp: 0 };
TL.assignWorker(p, { buildingId: 'alchemy_lab', charId: alch.id });
ok(alch.id !== miner.id || p.town.buildings.mine.worker === null, 'reassigning moves the worker');
TL.brew(p, { elixirId: 'might' }, 20);
ok(T.elixirBonuses(p).damagePct === 0.1, 'elixir active');
e = tryErr(() => TL.brew(p, { elixirId: 'wisdom' }, 20));
ok(/level 2/.test(e), 'elixir gated by lab level');
for (let i = 0; i < 6; i++) TL.brew(p, { elixirId: 'might' }, 20);
e = tryErr(() => TL.brew(p, { elixirId: 'might' }, 20));
ok(/8 hours/.test(e), 'elixir duration capped');
// dismiss clears worker
L.dismiss(p, { charId: smith.id });
ok(p.town.buildings.blacksmith.worker === null, 'dismiss clears worker');
// migration of an old save with big roster
const old2 = L.newPlayer({ id: 'old', username: 'old' });
old2.heroId = null; for (let i = 0; i < 8; i++) old2.characters['r' + i] = { ...miner, id: 'r' + i, profession: undefined, tree: miner.tree, equipment: miner.equipment };
delete old2.town; L.migratePlayer(old2);
ok(T.rosterLimit(old2) >= 8 && Object.values(old2.characters).every(c => c.profession), `old save: inn level ${old2.town.buildings.inn.level}, roster limit ${T.rosterLimit(old2)}`);
