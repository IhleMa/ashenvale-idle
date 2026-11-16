// Balance simulator: node tools/simulate.js [level] [zone] [fights]
// Runs the real combat engine headlessly to check win rates and fight lengths.
import { createCharacter } from '../shared/character.js';
import { buildPartyUnits } from '../shared/party.js';
import { createBattle, runToEnd } from '../shared/combat.js';
import { idleWaves, bossWaves, computeRewards } from '../shared/encounters.js';
import { generateItem } from '../shared/data/items.js';
import { createRng } from '../shared/rng.js';
import { ZONES } from '../shared/data/zones.js';

const level = Number(process.argv[2] || 1);
const zoneId = process.argv[3] || 'whispering_woods';
const fights = Number(process.argv[4] || 200);
const comp = (process.argv[5] || 'warrior,cleric,mage,rogue').split(',');
const gear = process.argv[6] !== 'nogear';

const rng = createRng(42);
const party = comp.map((cls, i) => {
  const ch = createCharacter({ id: 'c' + i, name: cls, classId: cls, isMain: i === 0, level });
  if (gear) {
    // give level-appropriate uncommon gear that fits the class
    for (const slot of Object.keys(ch.equipment)) {
      for (let t = 0; t < 60; t++) {
        const it = generateItem(rng, Math.max(1, level - 1), {});
        if (it.slot === slot && (!it.classes || it.classes.includes(cls))) { ch.equipment[slot] = it; break; }
      }
    }
  }
  return ch;
});

function run(wavesFn, n, boss = false) {
  let wins = 0, time = 0, xp = 0;
  for (let i = 0; i < n; i++) {
    const b = createBattle({ seed: 1000 + i, scale: (boss ? ZONES[zoneId].bossScale : ZONES[zoneId].scale), allies: buildPartyUnits(party, { ownerId: 'p', ownerName: 'p' }), waves: wavesFn() });
    runToEnd(b);
    if (b.state === 'victory') { wins++; xp += computeRewards(b.kills, rng).xp; }
    time += b.time;
  }
  return { winRate: (wins / n * 100).toFixed(0) + '%', avgSeconds: (time / n).toFixed(1), avgXp: (xp / Math.max(1, wins)).toFixed(0) };
}

console.log(`Level ${level} party [${comp}] in ${ZONES[zoneId].name}`);
console.log(' idle fights:', run(() => idleWaves(zoneId, level, rng, party.length), fights));
console.log(' boss fight :', run(() => bossWaves(zoneId, level), Math.max(10, Math.floor(fights / 10)), true));
