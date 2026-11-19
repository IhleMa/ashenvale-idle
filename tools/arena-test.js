// Arena: level balancing to the average of the two heroes (synced up and down), PvP modifiers, the time-limit
// decision, Elo rating for attacker and defender, attacks and refill, opponent list, full attack flow.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const { Store } = await import('../server/store.js');
const { Settings } = await import('../server/settings.js');
const { AdminManager } = await import('../server/admin.js');
const { Game } = await import('../server/game.js');
const L = await import('../server/playerLogic.js');
const C = await import('../shared/combat.js');
const { CONFIG } = await import('../shared/config.js');
const { arenaLevel, eloDelta, refillAttacks, pvpOptions } = await import('../shared/arena.js');
const { buildPartyUnits } = await import('../shared/party.js');
const { createCharacter } = await import('../shared/character.js');
const { CLASS_IDS } = await import('../shared/data/classes.js');
const { generateItem } = await import('../shared/data/items.js');
const { createRng } = await import('../shared/rng.js');

let n = 0;
const ok = m => { n++; console.log(`  ✔ ${m}`); };

// ---- pure rules
assert.equal(arenaLevel(20, 40), 30);
assert.equal(arenaLevel(59, 60), 60);
assert.equal(eloDelta(1000, 1000, true), 16);
assert.equal(eloDelta(1000, 1000, false), -16);
assert.ok(eloDelta(1000, 1400, true) > 28 && eloDelta(1400, 1000, true) < 4, 'beating a stronger player gives more');
const a = { attacks: 0, attacksAt: 0 };
const t0 = 1_000_000_000;
refillAttacks(a, t0);
const step = CONFIG.arena.attackRefillMinutes * 60_000;
refillAttacks(a, t0 + step * 2.5);
assert.equal(a.attacks, 2);
assert.equal(refillAttacks(a, t0 + step * 2.5), t0 + step * 3, 'next attack in half a refill');
refillAttacks(a, t0 + step * 100);
assert.equal(a.attacks, CONFIG.arena.attacksMax);
ok('arena level = average hero level; Elo ±16 between equals; attacks refill one by one up to the maximum');

// ---- level sync up and down
{
  const low = createCharacter({ id: 'l', name: 'Low', classId: 'warrior', level: 20, isMain: true });
  const high = createCharacter({ id: 'h', name: 'High', classId: 'warrior', level: 40, isMain: true });
  low.equipment.weapon = generateItem(createRng(1), 20, { rarity: 'rare' });
  const [lu] = buildPartyUnits([low], { ownerId: 'x', ownerName: 'x', syncLevel: 30 });
  const [hu] = buildPartyUnits([high], { ownerId: 'y', ownerName: 'y', syncLevel: 30 });
  const [l30] = buildPartyUnits([createCharacter({ id: 'm', name: 'M', classId: 'warrior', level: 30, isMain: true })], { ownerId: 'z', ownerName: 'z' });
  assert.equal(lu.level, 30); assert.equal(hu.level, 30);
  assert.ok(Math.abs(lu.maxHp - l30.maxHp) / l30.maxHp < 0.15, `synced up: ${lu.maxHp} vs ${l30.maxHp}`);
  assert.ok(Math.abs(hu.maxHp - l30.maxHp) / l30.maxHp < 0.15, `synced down: ${hu.maxHp} vs ${l30.maxHp}`);
  ok('both teams are synced to the fight level: a level 20 and a level 40 hero both fight like level 30');
}

// ---- every class can fight on either side; time limit; PvP damage
{
  const team = (ids, owner, lvl) => buildPartyUnits(ids.map((c, i) => createCharacter({ id: `${owner}${i}`, name: `${c}`, classId: c, level: lvl, isMain: i === 0 })), { ownerId: owner, ownerName: owner, syncLevel: lvl });
  const ids = [...CLASS_IDS];
  for (let i = 0; i < ids.length; i += 4) {
    const A = ids.slice(i, i + 4), B = [...ids.slice(i + 4, i + 8), ...ids].slice(0, 4);
    const b = C.createBattle({ seed: i + 1, allies: team(A, 'a', 40), waves: [team(B, 'b', 40).map(unit => ({ unit }))], pvp: pvpOptions(), meta: { kind: 'arena' } });
    C.runToEnd(b);
    assert.ok(['victory', 'defeat'].includes(b.state), `${A} vs ${B}: ${b.state}`);
    assert.ok(b.time <= pvpOptions().timeLimit + 0.2);
  }
  ok('teams of every class fight each other to a result within the time limit');

  // two healers who can't kill each other: decided at the time limit by remaining health
  const b = C.createBattle({ seed: 3, allies: team(['cleric'], 'a', 30), waves: [team(['druid'], 'b', 30).map(unit => ({ unit }))], pvp: { ...pvpOptions(), timeLimit: 20 }, meta: { kind: 'arena' } });
  b.units.find(u => u.side === 'B').hp *= 0.5;
  C.runToEnd(b);
  assert.ok(Math.abs(b.time - 20) < 0.2, `ended at ${b.time}`);
  assert.equal(b.state, C.healthShare(b, 'A') >= C.healthShare(b, 'B') ? 'victory' : 'defeat');
  ok('at the time limit the team with more health left wins');

  const hit = mult => { const bb = C.createBattle({ seed: 1, allies: team(['mage'], 'a', 30), waves: [team(['warrior'], 'b', 30).map(unit => ({ unit }))], pvp: { ...pvpOptions(), damageMult: mult }, meta: {} }); bb.rng = () => 0.5;
    const [s, t] = [bb.units[0], bb.units[1]]; const before = t.hp; C.__test.applyEffect(bb, s, t, { kind: 'damage', stat: 'magPower', power: 1, school: 'magical' }, null); return before - t.hp; };
  assert.ok(Math.abs(hit(0.5) / hit(1) - 0.5) < 0.02);
  ok('PvP damage multiplier applies between the teams');
}

// ---- full flow through the server
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ashen-arena-'));
const store = new Store(DATA, { log: () => {} });
const game = new Game({ store, assets: { get: () => ({}) }, log: () => {}, settings: new Settings(store), admins: new AdminManager(store, ''), buildId: 'test' });
const conn = (id, username, classId, level) => {
  const acc = { id, username, tokens: [] };
  store.setAccount(acc);
  const msgs = [];
  const ws = { readyState: 1, send: d => msgs.push(JSON.parse(d)) };
  const s = game.connect(ws, acc);
  let rid = 0;
  const call = (type, payload) => { const my = ++rid; game.handleMessage(s, ws, JSON.stringify({ t: 'action', id: my, type, payload })); return msgs.find(m => m.t === 'result' && m.id === my); };
  call('create_hero', { name: username, classId });
  const h = L.hero(s.player); h.level = level; s.player.parties[0].members = [h.id];
  return { s, call, msgs };
};
const att = conn('p1', 'attacker', 'mage', 30);
const def = conn('p2', 'defender', 'warrior', 14);
assert.equal(att.call('arena_attack', { opponentId: 'p2' }).ok, false);
assert.ok(att.call('arena_set_party', { party: 0 }).ok);
let v = att.call('arena_view').result;
assert.equal(v.opponents.length, 0, 'the defender has no arena team yet');
assert.ok(def.call('arena_set_party', { party: 0 }).ok);
game.rankings.cache = null;
v = att.call('arena_refresh').result;
assert.equal(v.opponents.length, 1);
assert.equal(v.opponents[0].fightLevel, 22);
ok('players pick a party as their arena team; the opponent list only shows players with a team and the fight level');

const r = att.call('arena_attack', { opponentId: 'p2' });
assert.ok(r.ok, r.error);
assert.equal(att.s.solo.kind, 'arena');
assert.equal(att.s.solo.battle.units.find(u => u.side === 'B').level, 22);
assert.equal(att.s.player.arena.attacks, CONFIG.arena.attacksMax - 1);
assert.equal(att.call('arena_attack', { opponentId: 'p2' }).ok, false, 'not twice in a row');
C.runToEnd(att.s.solo.battle);
const won = att.s.solo.battle.state === 'victory';
game.finishSoloBattle(att.s);
const A = att.s.player.arena, D = def.s.player.arena;
assert.equal(A.rating + D.rating, 2 * CONFIG.arena.startRating, 'rating moves from one to the other');
assert.equal(A.log[0].type, 'attack'); assert.equal(D.log[0].type, 'defense');
assert.equal(D.log[0].won, !won);
assert.ok(att.msgs.some(m => m.t === 'battle_end' && m.summary.kind === 'arena'));
assert.ok(def.msgs.some(m => m.t === 'toast' && /attacked your arena team/.test(m.text)), 'the defender is told');
const board = game.rankings.board({ category: 'arena' }, 'p1');
assert.equal(board.rows[0].id, won ? 'p1' : 'p2');
ok(`a full attack: fought at level 22, ${won ? 'won' : 'lost'}, rating ${A.rating} / ${D.rating}, both logs and the arena ranking updated`);

console.log(`Arena: all ${n} checks passed.`);
process.exit(0);
