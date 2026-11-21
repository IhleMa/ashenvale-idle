// Path of Exile style crit: (base + added) × (1 + % increased), capped. Every hit uses the weapon's base crit;
// the real crit rate in combat matches the formula.
import assert from 'node:assert/strict';
import { createCharacter } from '../shared/character.js';
import { computeStats } from '../shared/stats.js';
import { CONFIG } from '../shared/config.js';
import { ITEM_BASES, generateItem } from '../shared/data/items.js';
import { createRng } from '../shared/rng.js';
import * as C from '../shared/combat.js';
import { buildPartyUnits } from '../shared/party.js';

let n = 0;
const ok = m => { n++; console.log(`  ✔ ${m}`); };
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

const rogue = createCharacter({ id: 'r', name: 'R', classId: 'rogue', isMain: true, level: 30 });
let s = computeStats(rogue);
close(s.critChance, Math.min(CONFIG.combat.critCap, CONFIG.combat.unarmedCritBase * (1 + s.critInc)));
const rng = createRng(3);
let dagger; while (!(dagger = generateItem(rng, 30, {})) || dagger.baseId !== 'dagger') ;
rogue.equipment.weapon = dagger;
s = computeStats(rogue);
close(s.weaponCrit, ITEM_BASES.dagger.baseCrit);
close(s.critChance, Math.min(CONFIG.combat.critCap, ITEM_BASES.dagger.baseCrit * (1 + s.critInc)));
assert.ok(s.critInc > 1, 'Dexterity gives % increased crit');
ok(`every hit: weapon base × (1 + increased) — dagger ${(ITEM_BASES.dagger.baseCrit * 100)}% × ${(1 + s.critInc).toFixed(2)} = ${(s.critChance * 100).toFixed(1)}%`);

// the real crit rate of basic attacks over many swings
let crits = 0, hits = 0;
for (let f = 0; f < 40; f++) {
  const b = C.createBattle({ seed: 9 + f, allies: buildPartyUnits([rogue], { ownerId: 'p', ownerName: 'p' }), waves: [[{ enemyId: 'swamp_troll', level: 30 }]] });
  const me = b.units.find(u => u.side === 'A'), foe = b.units.find(u => u.side === 'B');
  foe.hp = foe.maxHp = 1e12; me.loadout = [];
  while (b.state === 'running') {
    C.stepBattle(b);
    for (const e of C.drainEvents(b)) if (e.type === 'damage' && e.src === me.uid && e.ability == null && !e.dot && !e.proc) { hits++; if (e.crit) crits++; }
    me.hp = me.maxHp;
  }
}
assert.ok(hits > 1500, `enough swings (${hits})`);
close(crits / hits, s.critChance, 0.03);
ok(`in combat basic attacks crit ${(crits / hits * 100).toFixed(1)}% of ${hits} swings (expected ${(s.critChance * 100).toFixed(1)}%)`);
{ // ability preview = what the engine really deals (no defense, average of the ±8% spread)
  const b = C.createBattle({ seed: 5, allies: buildPartyUnits([rogue], { ownerId: 'p', ownerName: 'p' }), waves: [[{ enemyId: 'swamp_troll', level: 30 }]] });
  const me = b.units.find(u => u.side === 'A'), foe = b.units.find(u => u.side === 'B');
  foe.stats.defense = 0; foe.hp = foe.maxHp = 1e12;
  const pv = C.previewAbility(me, 'backstab');
  const eff = (me.abilityDefs.backstab || {}).effects.find(e => e.kind === 'damage');
  let sum = 0, cnt = 0, crit = 0, all = 0;
  for (let i = 0; i < 4000; i++) {
    C.__test.applyEffect(b, me, foe, eff, 'backstab');
    for (const e of C.drainEvents(b)) if (e.type === 'damage' && e.ability === 'backstab' && !e.proc) { all++; if (e.crit) crit++; else { sum += e.amount; cnt++; } }
  }
  const d = pv.lines[0];
  close(sum / cnt / d.hit, 1, 0.02);
  close(crit / all, d.crit, 0.03);
  ok(`Backstab preview ${d.hit} (crit ${(d.crit * 100).toFixed(1)}%) matches the engine: average ${(sum / cnt).toFixed(0)}, crit ${(crit / all * 100).toFixed(1)}%`);
}
{ // attack speed: weapon base × (1 + increased) × more, capped
  const r = createCharacter({ id: 'r2', name: 'R', classId: 'rogue', isMain: true, level: 30 });
  r.equipment.weapon = dagger;
  const st = computeStats(r);
  close(st.attackSpeed, Math.min(CONFIG.combat.attackSpeedCap, ITEM_BASES.dagger.baseSpeed * (1 + st.speedInc) * st.speedMore));
  r.equipment.weapon = null;
  close(computeStats(r).attackSpeed, Math.min(CONFIG.combat.attackSpeedCap, 1 * (1 + st.speedInc) * st.speedMore));
  ok(`attack speed: weapon base × (1 + increased) — dagger ${ITEM_BASES.dagger.baseSpeed} × ${(1 + st.speedInc).toFixed(2)} = ${(st.attackSpeed * 100).toFixed(0)}%`);
}
console.log(`Crit: all ${n} checks passed.`);
