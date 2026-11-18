// Rift balance simulator: node tools/rift-sim.js [level] [zone] [runs]
// Plays rifts of increasing tier with a geared party and prints success / timed rates.
import { createCharacter } from '../shared/character.js';
import { buildPartyUnits } from '../shared/party.js';
import { createBattle, runToEnd } from '../shared/combat.js';
import { generateItem } from '../shared/data/items.js';
import { createRng } from '../shared/rng.js';
import { RIFT, riftWaves, riftScale, riftHooks, affixesFor, riftLevel } from '../shared/rifts.js';

const level = Number(process.argv[2] || 20);
const zoneId = process.argv[3] || 'emberfall_caverns';
const runs = Number(process.argv[4] || 20);
const comp = (process.argv[5] || 'warrior,cleric,mage,rogue').split(',');
const rng = createRng(7);
const party = comp.map((cls, i) => {
  const ch = createCharacter({ id: 'c' + i, name: cls, classId: cls, isMain: i === 0, level });
  for (const slot of Object.keys(ch.equipment)) {
    for (let t = 0; t < 80; t++) {
      const it = generateItem(rng, level, { minRarity: 'rare' });
      if (it.slot === slot && (!it.classes || it.classes.includes(cls))) { ch.equipment[slot] = it; break; }
    }
  }
  return ch;
});
console.log(`Level ${level} [${comp}] rifts themed ${zoneId}, time limit ${RIFT.timeLimit}s`);
for (let tier = Number(process.env.FROM || 1); tier <= 1000; tier += tier < 10 ? 1 : 5) {
  let wins = 0, timed = 0, t = 0;
  for (let i = 0; i < runs; i++) {
    const b = createBattle({ seed: 50 + i, allies: buildPartyUnits(party, { ownerId: 'p', ownerName: 'p' }), waves: riftWaves(zoneId, tier, createRng(i), party.length), scale: riftScale(tier), hooks: riftHooks(affixesFor(tier)) });
    runToEnd(b);
    if (b.state === 'victory') { wins++; t += b.time; if (b.time <= RIFT.timeLimit) timed++; }
  }
  console.log(`tier ${String(tier).padStart(3)} (enemy level ${riftLevel(tier)}): win ${String(Math.round(wins / runs * 100)).padStart(3)}%  timed ${String(Math.round(timed / runs * 100)).padStart(3)}%  avg ${wins ? (t / wins).toFixed(0) : '-'}s  affixes ${affixesFor(tier).join(',')}`);
  if (!wins) break;
}
