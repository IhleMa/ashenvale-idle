// Existing uniques follow their definition: changed base / fixed stats / name reach dropped items; an equipped unique
// that moves to another slot (or can no longer be used by its wearer) is taken off and sent by mail.
import assert from 'node:assert/strict';
import { UNIQUES, generateUnique } from '../shared/data/legendaries.js';
import { ITEM_BASES } from '../shared/data/items.js';
import { createRng } from '../shared/rng.js';
import { createCharacter } from '../shared/character.js';
import * as L from '../server/playerLogic.js';

let n = 0;
const ok = m => { n++; console.log(`  ✔ ${m}`); };
const u = UNIQUES.alpha_pelt;
const saved = JSON.parse(JSON.stringify(u));
const rng = createRng(7);
const p = L.newPlayer({ id: 'p1', username: 'Tess' });
const ch = createCharacter({ id: 'h', name: 'Ranga', classId: 'ranger', level: 30, isMain: true });
p.characters = { h: ch }; p.heroId = 'h';
const worn = generateUnique(rng, 30, u.id), spare = generateUnique(rng, 30, u.id);
ch.equipment.chest = worn;
p.inventory.push(spare);
const affixes = JSON.stringify(worn.affixes), level = worn.level;
try {
  assert.equal(L.syncUniques(p), 0, 'nothing to do while the content is unchanged');

  // fixed stats + name change, same slot: stays equipped, gets the new values
  u.stats = { ...u.stats, dex: [50, 1] };
  u.name = 'Pelt of the Old Alpha';
  assert.equal(L.syncUniques(p), 2);
  assert.equal(ch.equipment.chest, worn);
  assert.equal(worn.name, 'Pelt of the Old Alpha');
  assert.ok(worn.stats.dex >= 50, 'new fixed stats are in the item stats');
  assert.equal(JSON.stringify(worn.affixes), affixes, 'random affixes stay');
  assert.equal(worn.level, level);
  assert.equal(p.mailbox.length, 0);
  ok('changed fixed stats and name reach existing copies; equipped copy stays on');

  // base moves to another slot: taken off and mailed (even though the inventory has room)
  u.baseId = 'leather_hood';
  assert.equal(L.syncUniques(p), 2);
  assert.equal(ch.equipment.chest, null);
  assert.equal(p.mailbox.length, 1);
  assert.equal(p.mailbox[0].item, worn);
  assert.equal(worn.slot, 'head');
  assert.equal(worn.baseId, 'leather_hood');
  assert.equal(spare.slot, 'head');
  assert.match(p.mailbox[0].note, /taken off Ranga/);
  ok('a slot change takes the unique off and sends it by mail; inventory copies change base too');

  // can no longer be used by the wearer's class: also mailed
  const plate = Object.values(ITEM_BASES).find(b => b.slot === 'head' && b.classes && !b.classes.includes('ranger'));
  if (plate) {
    p.mailbox = []; ch.equipment.head = worn; u.baseId = plate.id;
    L.syncUniques(p);
    assert.equal(ch.equipment.head, null);
    assert.match(p.mailbox[0].note, /no longer be used by Ranga/);
    ok(`a base the wearer's class can't use (${plate.id}) also mails it`);
  }
} finally { Object.assign(u, saved); }
console.log(`Unique sync: all ${n} checks passed.`);
