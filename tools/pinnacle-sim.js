// Pinnacle balance simulator: node tools/pinnacle-sim.js [runs] [rarity]
// Fights every pinnacle boss with a party built for it and a party without the answer to its mechanic,
// at level 60 with ascended heroes and generated gear, and prints win rate and average time.
import { createCharacter, syncTree, autoLoadout } from '../shared/character.js';
import { buildPartyUnits } from '../shared/party.js';
import { createBattle, runToEnd } from '../shared/combat.js';
import { generateItem } from '../shared/data/items.js';
import { createRng } from '../shared/rng.js';
import { SUBCLASSES } from '../shared/data/subclasses.js';
import { getTree, autoAllocate, pathTo } from '../shared/skilltree.js';
import { PINNACLE, PINNACLE_BOSSES, pinnacleWaves, pinnacleScale } from '../shared/pinnacle.js';

const runs = Number(process.argv[2] || 10);
const rarity = process.argv[3] || 'legendary';
const only = process.env.BOSS || null;
const rng = createRng(11);

// class[:ability,ability] — the abilities are learned first (interrupts, Purify, …)
export function buildChar(spec, i, level = PINNACLE.level) {
  const [clsSub, wants = ''] = spec.split(':');
  const [cls, sub] = clsSub.split('@');
  const ch = createCharacter({ id: 'c' + i, name: cls + i, classId: cls, isMain: i === 0, level, autoTree: false });
  ch.subclass = sub || Object.values(SUBCLASSES).find(s => s.classId === cls)?.id || null;
  const tree = getTree(ch.classId, ch.subclass);
  for (const a of wants.split(',').filter(Boolean)) {
    const node = Object.values(tree.nodes).find(n => n.ability === a);
    if (!node) throw new Error(`${cls} has no ${a} in its tree`);
    ch.tree.allocated.push(...pathTo(ch, node.id));
  }
  autoAllocate(ch);
  syncTree(ch);
  ch.loadout = autoLoadout(ch);
  for (const a of wants.split(',').filter(Boolean)) if (!ch.loadout.includes(a)) ch.loadout[ch.loadout.length - 1] = a;
  for (const slot of Object.keys(ch.equipment)) {
    for (let t = 0; t < 200; t++) {
      const it = generateItem(rng, level, { minRarity: rarity });
      if (it.slot === slot && (!it.classes || it.classes.includes(cls))) { ch.equipment[slot] = it; break; }
    }
  }
  return ch;
}

export const COMPS = {
  twin_wardens: { right: ['warrior', 'cleric', 'mage', 'rogue'], wrong: ['warrior', 'cleric', 'rogue', 'ranger'] },
  mother_of_plagues: { right: ['warrior', 'cleric', 'mage', 'druid:natures_cure'], chrono: ['warrior', 'cleric', 'mage', 'chronomancer:rewind'], wrong: ['warrior', 'cleric', 'mage', 'rogue'] },
  iron_tyrant: { right: ['warrior:taunt', 'sentinel', 'cleric', 'mage'], bear: ['warrior:taunt', 'druid:bear_form', 'cleric', 'mage'], wrong: ['warrior:taunt', 'cleric', 'mage', 'rogue'] },
  silent_choir: { right: ['warrior:pummel', 'cleric', 'rogue:kick', 'spellblade:counterspell'], one: ['warrior:pummel', 'cleric', 'mage', 'ranger'], wrong: ['sentinel', 'cleric', 'mage', 'ranger'] },
  hollow_king: { right: ['warrior', 'cleric', 'mage@cryomancer', 'spellblade'], wrong: ['warrior', 'cleric', 'warlock', 'mage@pyromancer'], single: ['warrior', 'cleric', 'ranger', 'rogue'] },
};

export function fight(bossId, party, seed) {
  const b = createBattle({ seed, allies: buildPartyUnits(party, { ownerId: 'p', ownerName: 'p' }), waves: pinnacleWaves(bossId), scale: pinnacleScale(bossId), meta: { kind: 'pinnacle' } });
  runToEnd(b);
  return b;
}

if (process.argv[1]?.endsWith('pinnacle-sim.js')) {
  console.log(`Pinnacle sim: level ${PINNACLE.level}, ascended, ${rarity} gear, ${runs} runs`);
  for (const [bossId, comps] of Object.entries(COMPS)) {
    if (only && bossId !== only) continue;
    for (const [label, comp] of Object.entries(comps)) {
      const party = comp.map((s, i) => buildChar(s, i));
      let wins = 0, t = 0, deaths = 0;
      for (let i = 0; i < runs; i++) {
        const b = fight(bossId, party, 100 + i);
        if (b.state === 'victory') { wins++; t += b.time; }
        deaths += b.units.filter(u => u.side === 'A' && u.kind === 'character' && !u.alive).length;
      }
      console.log(`${PINNACLE_BOSSES[bossId].name.padEnd(22)} ${label.padEnd(5)} [${comp.join(' ')}]  win ${String(Math.round(wins / runs * 100)).padStart(3)}%  avg ${wins ? (t / wins).toFixed(0) : '-'}s  dead/run ${(deaths / runs).toFixed(1)}`);
    }
  }
}
