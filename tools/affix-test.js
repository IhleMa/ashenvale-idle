// Tiered item affixes: generation rules, exact recomputation (reforge/ascension), legacy migration,
// loot filter tier rules and the new combat stats.
import assert from 'node:assert/strict';
const { generateItem, itemStats, AFFIXES, AFFIX_TIERS, isSoulbound, affixValue } = await import('../shared/data/items.js');
const { generateUnique, migrateLegacyItem, UNIQUES } = await import('../shared/data/legendaries.js');
const { rescaleItem } = await import('../shared/town.js');
const { ruleMatches, newRule } = await import('../shared/lootfilter.js');
const { createCharacter } = await import('../shared/character.js');
const { computeStats } = await import('../shared/stats.js');
const C = await import('../shared/combat.js');
const { CONFIG } = await import('../shared/config.js');

let n = 0;
const ok = m => { n++; console.log(`  ✔ ${m}`); };
let seed = 7;
const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

// generation
{
  const tierCount = {};
  for (let i = 0; i < 3000; i++) {
    const lv = i % 2 ? 60 : 1 + Math.floor(rng() * 60);
    const it = generateItem(rng, lv);
    const r = CONFIG.rarities.find(x => x.id === it.rarity);
    assert.ok(it.affixes.length <= r.affixes);
    const types = it.affixes.map(a => AFFIXES[a.stat].type);
    assert.ok(types.filter(t => t === 'prefix').length <= 3 && types.filter(t => t === 'suffix').length <= 3);
    assert.equal(new Set(it.affixes.map(a => a.stat)).size, it.affixes.length, 'no stat twice');
    for (const a of it.affixes) {
      assert.ok(!AFFIXES[a.stat].slots || AFFIXES[a.stat].slots.includes(it.slot), `${a.stat} not allowed on ${it.slot}`);
      assert.ok(AFFIX_TIERS.find(t => t.tier === a.tier).minLevel <= lv, 'tier above item level');
      if (lv >= 55) tierCount[a.tier] = (tierCount[a.tier] || 0) + 1;
    }
    assert.deepEqual(it.stats, itemStats(it));
  }
  assert.ok((tierCount[1] || 0) < (tierCount[4] || 0) && (tierCount[4] || 0) < tierCount[7], JSON.stringify(tierCount));
  ok(`items obey rarity counts, 3 prefixes/3 suffixes, slots and item-level tiers (T1 ${tierCount[1]} vs T7 ${tierCount[7]} at ilvl 55+)`);
}

// reforge / ascension: exact, soulbound until back at the original level
{
  const it = generateItem(rng, 50, { rarity: 'legendary' });
  const before = JSON.stringify(it.stats);
  rescaleItem(it, 1);
  assert.ok(isSoulbound(it));
  assert.ok(it.stats[it.affixes[0].stat] < JSON.parse(before)[it.affixes[0].stat] || AFFIXES[it.affixes[0].stat].pct);
  rescaleItem(it, 30);
  assert.ok(isSoulbound(it));
  rescaleItem(it, 50);
  assert.ok(!isSoulbound(it));
  assert.equal(JSON.stringify(it.stats), before);
  ok('scaled-down gear is soulbound and comes back exactly at its original level');
}

// legacy items
{
  const legacy = { uid: 'x', baseId: 'dagger', name: 'Iron Dagger of Embers', slot: 'weapon', rarity: 'epic', level: 20, requiredLevel: 18, stats: { physPower: 50, str: 9 }, classes: ['rogue'], sockets: [null] };
  assert.ok(migrateLegacyItem(legacy));
  assert.equal(legacy.affixes.length, 3);
  assert.deepEqual(legacy.stats, itemStats(legacy));
  assert.deepEqual(legacy.sockets, [null]);
  assert.ok(!migrateLegacyItem(legacy), 'only once');
  const uid = Object.keys(UNIQUES)[0];
  const lu = { uid: 'u', baseId: UNIQUES[uid].baseId, name: UNIQUES[uid].name, slot: 'chest', rarity: 'legendary', level: 10, requiredLevel: 8, stats: {}, unique: uid,
    statRef: { level: 30, stats: {}, enchant: null } };
  migrateLegacyItem(lu);
  assert.equal(lu.name, UNIQUES[uid].name);
  for (const k of Object.keys(UNIQUES[uid].stats)) assert.ok(lu.stats[k] > 0, `unique stat ${k}`);
  assert.ok(isSoulbound(lu));
  assert.ok(AFFIX_TIERS.find(t => t.tier === Math.min(...lu.affixes.map(a => a.tier))).minLevel <= 30, 'rolled at its original level');
  const fresh = generateUnique(rng, 20, uid);
  for (const k of Object.keys(UNIQUES[uid].stats)) assert.ok(fresh.stats[k] > 0);
  ok('old items get tiered affixes and keep base, sockets, unique stats and soulbinding');
}

// loot filter
{
  const it = generateItem(rng, 60, { rarity: 'mythic' });
  const best = Math.min(...it.affixes.map(a => a.tier));
  assert.ok(ruleMatches(newRule({ bestTierMax: best }), it, { heroLevel: 60, characters: [] }));
  assert.ok(!ruleMatches(newRule({ bestTierMin: best + 1 }), it, { heroLevel: 60, characters: [] }));
  const plain = generateItem(rng, 60, { rarity: 'common' });
  assert.ok(!ruleMatches(newRule({ bestTierMax: 7 }), plain, { heroLevel: 60, characters: [] }));
  assert.ok(ruleMatches(newRule({ bestTierMin: 1 }), plain, { heroLevel: 60, characters: [] }));
  ok('loot filter rules on the best affix tier');
}

// combat stats from gear
{
  const gear = stats => ({ uid: 'g', baseId: 'dagger', slot: 'ring', rarity: 'common', level: 30, stats }); // plain stats, no affix list
  const make = stats => {
    const ch = createCharacter({ id: 'r', name: 'R', classId: 'rogue', level: 30, isMain: true });
    ch.equipment = { ...ch.equipment, ring: gear(stats) };
    return ch;
  };
  const s = computeStats(make({ strPct: 0.5, damageReduction: 0.1, lifeSteal: 0.2, damagePct: 0.3 }));
  const s0 = computeStats(make({}));
  assert.ok(s.attributes.str > s0.attributes.str * 1.4);
  assert.ok(Math.abs(s.damageTakenPct - (s0.damageTakenPct - 0.1)) < 1e-9);
  assert.equal(s.lifeSteal, 0.2);
  assert.ok(Math.abs(s.damagePct - s0.damagePct - 0.3) < 1e-9);

  const ch = make({ lifeSteal: 0.5, hpRegen: 50, blockChance: 1 });
  const b = C.createBattle({ seed: 3, allies: [C.makeCharacterUnit(ch, { ownerId: 'p', ownerName: 'P', position: 0 })], waves: [[{ enemyId: 'swamp_troll', level: 30 }]] });
  const me = b.units[0], foe = b.units.find(u => u.side === 'B');
  foe.hp = foe.maxHp = 1e7;
  me.hp = 10;
  C.__test.applyEffect(b, me, foe, { kind: 'damage', stat: 'physPower', power: 2, school: 'physical' }, 'backstab');
  assert.ok(me.hp > 10, 'life steal healed');
  C.drainEvents(b);
  const hp = me.hp;
  for (let i = 0; i < 20; i++) { me.hp = me.maxHp; C.__test.applyEffect(b, foe, me, { kind: 'damage', stat: 'physPower', power: 0.1, school: 'physical' }, null); }
  assert.ok(C.drainEvents(b).some(e => e.type === 'damage' && e.blocked), 'blocked');
  me.hp = 100; me.statuses = [];
  const before = me.hp;
  foe.actionTimer = 1e9;
  for (let i = 0; i < 10; i++) C.stepBattle(b);
  assert.ok(me.hp >= before + 45, `regenerated ${me.hp - before}`);
  ok('gear stats: attribute %, damage reduction, life steal, block and health regeneration work');
}
// auction house affix search
{
  const { affixQuery, matchesAffixQuery } = await import('../server/auction.js');
  const it = { uid: 'a', baseId: 'ring', slot: 'ring', rarity: 'epic', level: 50, stats: {}, affixes: [{ stat: 'lifeSteal', tier: 2, roll: 0.5 }, { stat: 'str', tier: 6, roll: 0.5 }, { stat: 'critChance', tier: 4, roll: 0.5 }], sockets: [null] };
  it.stats = itemStats(it);
  const m = q => { const af = affixQuery(q); return !af || matchesAffixQuery(it, af); };
  assert.ok(m({ affixes: [{ stat: 'lifeSteal' }] }));
  assert.ok(m({ affixes: [{ stat: 'lifeSteal', tier: 2 }] }) && !m({ affixes: [{ stat: 'lifeSteal', tier: 1 }] }));
  assert.ok(m({ affixes: [{ stat: 'lifeSteal', min: it.stats.lifeSteal }] }) && !m({ affixes: [{ stat: 'lifeSteal', min: it.stats.lifeSteal + 0.001 }] }));
  assert.ok(!m({ affixes: [{ stat: 'lifeSteal' }, { stat: 'dodge' }] }) && m({ affixes: [{ stat: 'lifeSteal' }, { stat: 'dodge' }], affixMode: 'any' }));
  assert.ok(m({ bestTier: 2 }) && !m({ bestTier: 1 }) && m({ minAffixes: 3 }) && !m({ minAffixes: 4 }));
  assert.ok(m({ socket: 'empty' }) && !m({ socket: 'gem' }) && !m({ socket: 'ladder' }));
  ok('auction search: stat, minimum value, tier, all/any, best tier, affix count and socket filters');
}
console.log(`affix-test: ${n} checks passed`);
