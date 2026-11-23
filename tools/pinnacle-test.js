// Pinnacle bosses: the engine mechanics (immunity, linked twins, plague, Sunder, interruptible channels, the Hollow
// King), Pinnacle Sigils, the pinnacle rewards and fighting together as a group.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createCharacter } from '../shared/character.js';
import { buildPartyUnits } from '../shared/party.js';
import { createBattle, stepBattle, drainEvents, makeEnemyUnit } from '../shared/combat.js';
import { resolveRule } from '../shared/rules.js';
import { ABILITIES } from '../shared/data/abilities.js';
import { rollSigils, pinnacleWaves, PINNACLE_BOSSES, pinnacleState } from '../shared/pinnacle.js';
import { computeRewards } from '../shared/encounters.js';
import { generateUnique, UNIQUES } from '../shared/data/legendaries.js';
import { createRng } from '../shared/rng.js';
import { ownsCosmetic } from '../shared/data/cosmetics.js';

let n = 0;
const ok = m => { n++; console.log(`  ✔ ${m}`); };
const party = classes => classes.map((c, i) => createCharacter({ id: 'c' + i, name: c + i, classId: c, isMain: i === 0, level: 60 }));
const battle = (classes, enemies, { scale = { hp: 1, damage: 1 } } = {}) => createBattle({ seed: 7, allies: buildPartyUnits(party(classes), { ownerId: 'p', ownerName: 'p' }), waves: [enemies.map(enemyId => ({ enemyId, level: 60 }))], scale });
const run = (b, seconds) => { const evs = []; const end = b.time + seconds; while (b.state === 'running' && b.time < end) { stepBattle(b); evs.push(...drainEvents(b)); } return evs; };
const foe = (b, id) => b.units.find(u => u.defId === id);
const allies = b => b.units.filter(u => u.side === 'A');
const freeze = b => { for (const u of allies(b)) { u.loadout = []; u.actionTimer = 1e9; } };

// ---- immunity & linked twins
{
  const b = battle(['warrior', 'mage'], ['warden_of_stone', 'warden_of_storm'], { scale: { hp: 0.01, damage: 0 } });
  freeze(b);
  const stone = foe(b, 'warden_of_stone'), storm = foe(b, 'warden_of_storm');
  const [w, m] = allies(b);
  // a physical basic attack does nothing to the Warden of Stone; the warrior picks the Warden of Storm instead
  w.actionTimer = 0; stepBattle(b);
  const ev = drainEvents(b);
  assert.ok(ev.some(e => e.type === 'damage' && e.tgt === storm.uid), 'warrior hits Storm');
  assert.ok(!ev.some(e => e.type === 'damage' && e.tgt === stone.uid && e.amount > 0), 'Stone is immune to physical');
  ok('school immunity: physical damage does nothing to the Warden of Stone, and characters pick the twin they can hurt');
  // kill Stone only: it rises again after 10 s while Storm lives
  stone.hp = 1; m.actionTimer = 0; stepBattle(b); drainEvents(b);
  assert.equal(stone.alive, false);
  assert.ok(stone.reviveAt > b.time);
  freeze(b);
  run(b, 10.5);
  assert.equal(stone.alive, true, 'Stone rose again');
  assert.ok(stone.hp > 0 && stone.hp < stone.maxHp);
  assert.equal(b.kills.filter(k => k.enemyId === 'warden_of_stone').length, 0, 'no reward for a kill that did not stay');
  ok('linked twins: a fallen warden rises again (at half health, no kill counted) when its twin outlives it by 10 s');
  // both within the window: victory
  stone.hp = 1; storm.hp = 1;
  for (const u of allies(b)) { u.loadout = []; u.actionTimer = 0; }
  run(b, 6);
  assert.equal(b.state, 'victory');
  ok('killing both wardens within the window wins the fight');
}

// ---- Mother of Plagues: stacking plague, only a cleanse removes it, the plague goes first
{
  const b = battle(['warrior', 'druid'], ['mother_of_plagues'], { scale: { hp: 100, damage: 0.01 } });
  freeze(b);
  const mom = foe(b, 'mother_of_plagues');
  mom.loadout = ['b_plague_wave'];
  const run1 = () => { mom.cooldowns.b_plague_wave = 0; mom.actionTimer = 0; stepBattle(b); drainEvents(b); mom.actionTimer = 1e9; };
  run1(); run1(); run1();
  const w = allies(b)[0];
  const plague = () => w.statuses.find(s => s.id === 'plague');
  assert.equal(plague().stacks, 3);
  run(b, 30);
  assert.equal(plague()?.stacks, 3, 'still there after 30 s');
  w.statuses.push({ id: 'chilled', remaining: 5, duration: 5, value: 0, stacks: 1, src: mom.uid, tickTimer: 1 });
  const druid = allies(b)[1];
  druid.loadout = ['natures_cure']; druid.cooldowns.natures_cure = 0; druid.resource = 100; druid.actionTimer = 0; druid.rules.natures_cure = { enabled: true, mode: 'all', conditions: [], target: { selector: 'ally_lowest_hp_pct' }, targetConditions: [] };
  druid.ranks.natures_cure = 1;
  const cure = { kind: 'cleanse', count: 1 };
  // one cleanse removes the plague (most dangerous) before the lesser debuff
  const statusesBefore = w.statuses.map(s => s.id);
  assert.ok(statusesBefore.includes('chilled') && statusesBefore.includes('plague'));
  ABILITIES.__test = { name: 't', classId: 'druid', cost: 0, cooldown: 1, target: 'ally', effects: [cure], defaultRule: { enabled: true, mode: 'all', conditions: [], target: { selector: 'party_1' }, targetConditions: [] } };
  druid.loadout = ['__test']; druid.rules.__test = ABILITIES.__test.defaultRule; druid.ranks.__test = 1; druid.actionTimer = 0;
  stepBattle(b); drainEvents(b);
  delete ABILITIES.__test;
  assert.ok(!plague(), 'plague cleansed');
  assert.ok(w.statuses.some(s => s.id === 'chilled'), 'the lesser debuff stays');
  ok('plague: stacks with every wave, never wears off, and a cleanse removes it before lesser debuffs');
}

// ---- Iron Tyrant: Sunder, the fifth stack executes, another ally's taunt resets it
{
  const b = battle(['warrior', 'sentinel'], ['iron_tyrant'], { scale: { hp: 100, damage: 0.001 } });
  freeze(b);
  const t = foe(b, 'iron_tyrant');
  t.loadout = ['b_sundering_blow'];
  const [w, sn] = allies(b);
  t.threatTable[w.uid] = 1e6;
  const blow = () => { t.cooldowns.b_sundering_blow = 0; t.actionTimer = 0; stepBattle(b); drainEvents(b); };
  for (let i = 0; i < 4; i++) blow();
  assert.equal(w.statuses.find(s => s.id === 'sunder').stacks, 4);
  // the sentinel taunts: the Tyrant lets go of the warrior, whose Sunder falls off
  sn.loadout = ['challenging_shout']; sn.cooldowns.challenging_shout = 0; sn.resource = 100; sn.actionTimer = 0;
  sn.rules.challenging_shout = { enabled: true, mode: 'all', conditions: [], target: { selector: 'self' }, targetConditions: [] };
  stepBattle(b); drainEvents(b); sn.actionTimer = 1e9;
  assert.ok(!w.statuses.some(s => s.id === 'sunder'), 'taunt reset the warrior');
  ok('a taunt by another ally makes the Iron Tyrant drop its Sunder on everyone else');
  for (let i = 0; i < 4; i++) blow();
  assert.equal(sn.statuses.find(s => s.id === 'sunder').stacks, 4);
  sn.undying = false;
  blow();
  assert.equal(sn.alive, false, 'the fifth stack executes');
  ok('the fifth Sunder stack executes its target');
}

// ---- Silent Choir: the Requiem, interrupts and stuns
{
  const b = battle(['warrior', 'cleric'], ['choir_soprano'], { scale: { hp: 100, damage: 0 } });
  freeze(b);
  const c = foe(b, 'choir_soprano');
  c.loadout = [];
  run(b, c.channel.first + 0.2);
  assert.ok(c.casting, 'started singing');
  const [w] = allies(b);
  // the interrupt rule: only while an enemy casts
  const pummel = ABILITIES.pummel;
  const rule = JSON.parse(JSON.stringify(pummel.defaultRule));
  assert.ok(resolveRule(rule, pummel, b, w), 'Pummel is ready to fire');
  w.loadout = ['pummel']; w.ranks.pummel = 1; w.rules.pummel = rule; w.cooldowns.pummel = 0; w.resource = 100; w.actionTimer = 0;
  stepBattle(b); drainEvents(b); w.actionTimer = 1e9;
  assert.ok(!c.casting, 'interrupted');
  assert.equal(resolveRule(rule, pummel, b, w), null, 'nothing to interrupt now');
  ok('Pummel fires only while an enemy casts, and interrupts the Requiem');
  // next cast, a stun breaks it too
  run(b, c.channel.every + 0.2);
  assert.ok(c.casting);
  const hp0 = allies(b).map(u => u.hp);
  run(b, c.channel.castTime + 0.3);
  assert.ok(!c.casting);
  allies(b).forEach((u, i) => assert.ok(hp0[i] - u.hp >= u.maxHp * 0.55, 'a finished Requiem takes about 60%'));
  assert.ok(c.statuses.some(s => s.id === 'crescendo'));
  ok('a Requiem sung to the end hits every hero for 60% of their health and strengthens the Choir');
  run(b, c.channel.every);
  assert.ok(c.casting);
  const sb = ABILITIES.shield_bash;
  w.loadout = ['shield_bash']; w.ranks.shield_bash = 1; w.cooldowns.shield_bash = 0; w.resource = 100; w.actionTimer = 0;
  w.rules.shield_bash = { enabled: true, mode: 'all', conditions: [], target: { selector: 'enemy_current' }, targetConditions: [] };
  assert.ok(sb);
  stepBattle(b); drainEvents(b);
  assert.ok(!c.casting, 'a stun interrupts');
  ok('any stun interrupts the Requiem too');
}

// ---- Hollow King: immune while knights stand; knights reflect damage over time
{
  const b = battle(['warrior', 'warlock'], ['hollow_king', 'hollow_knight'], { scale: { hp: 100, damage: 0 } });
  freeze(b);
  const king = foe(b, 'hollow_king'), knight = foe(b, 'hollow_knight');
  king.loadout = []; knight.loadout = []; knight.actionTimer = 1e9; king.actionTimer = 1e9;
  const [w, wl] = allies(b);
  w.actionTimer = 0; stepBattle(b);
  const ev = drainEvents(b);
  assert.ok(!ev.some(e => e.type === 'damage' && e.tgt === king.uid && e.amount > 0));
  assert.ok(ev.some(e => e.type === 'damage' && e.tgt === knight.uid), 'the warrior goes for the knight');
  ok('the Hollow King is immune while a Hollow Knight stands (characters attack the knights)');
  knight.statuses.push({ id: 'poison', remaining: 5, duration: 5, value: 200, stacks: 1, src: wl.uid, tickTimer: 0.01 });
  const hp = wl.hp;
  const evs = run(b, 1.2);
  assert.ok(evs.some(e => e.type === 'damage' && e.tgt === wl.uid && e.proc === 'Hollow Echo'));
  assert.ok(wl.hp < hp);
  ok('damage over time on a Hollow Knight hits its caster for half of it');
  knight.hp = 0; knight.alive = false;
  w.actionTimer = 0; stepBattle(b);
  assert.ok(drainEvents(b).some(e => e.type === 'damage' && e.tgt === king.uid && e.amount > 0));
  ok('without knights the King takes damage');
}

// ---- Pinnacle Sigils & uniques
{
  const rng = createRng(3);
  const kills = Array.from({ length: 20000 }, () => ({ enemyId: 'wolf', level: 60, boss: false, elite: false, summoned: false }));
  const s = rollSigils(kills, rng);
  assert.ok(s >= 0 && s < 10, `about 2 in 20000 (${s})`);
  assert.equal(rollSigils(kills.map(k => ({ ...k, level: 30 })), rng), 0);
  assert.equal(computeRewards(kills.slice(0, 5000).map(k => ({ ...k, boss: true })), rng, { noSigils: true }).sigils, 0);
  ok(`Pinnacle Sigils are very rare (${s} from 20000 level 60 kills), never below level 55 and never from rifts`);
  const pinUniques = Object.values(UNIQUES).filter(u => u.pinnacle).map(u => u.id);
  assert.ok(pinUniques.length >= 5);
  for (let i = 0; i < 3000; i++) { const u = generateUnique(rng, 60); assert.ok(!pinUniques.includes(u.unique), 'pinnacle unique in the normal pool'); }
  for (const b of Object.values(PINNACLE_BOSSES)) { for (const u of b.uniques) assert.equal(UNIQUES[u]?.pinnacle, b.id); assert.ok(pinnacleWaves(b.id).length); }
  ok(`the ${pinUniques.length} pinnacle uniques only drop from their boss`);
}

// ---- server: sigil entry, rewards, leaderboard and group fights
{
  const { Store } = await import('../server/store.js');
  const { Settings } = await import('../server/settings.js');
  const { AdminManager } = await import('../server/admin.js');
  const { Game } = await import('../server/game.js');
  const L = await import('../server/playerLogic.js');
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ashen-pin-'));
  const store = new Store(DATA, { log: () => {} });
  const game = new Game({ store, assets: { get: () => ({}) }, log: () => {}, settings: new Settings(store), admins: new AdminManager(store), buildId: 'test' });
  const join = (id, name, classId) => {
    const msgs = [];
    store.setAccount({ id, username: name, tokens: [] });
    const ws = { readyState: 1, send: d => msgs.push(JSON.parse(d)) };
    const s = game.connect(ws, store.getAccount(name));
    game.handleMessage(s, ws, JSON.stringify({ t: 'action', id: 1, type: 'create_hero', payload: { name: name + 'h', classId } }));
    const h = L.hero(s.player); h.level = 60;
    return { s, ws, msgs, p: s.player };
  };
  let aid = 10;
  const act = (u, type, payload = {}) => { u.msgs.length = 0; game.handleMessage(u.s, u.ws, JSON.stringify({ t: 'action', id: ++aid, type, payload })); const r = u.msgs.find(m => m.t === 'result' && m.id === aid); return r; };
  const A = join('pa', 'alpha', 'warrior');
  let r = act(A, 'pinnacle_start', { bossId: 'iron_tyrant' });
  assert.equal(r.ok, false); assert.match(r.error, /Sigil/);
  pinnacleState(A.p).sigils = 2;
  r = act(A, 'pinnacle_start', { bossId: 'iron_tyrant' });
  assert.equal(r.ok, true, r.error);
  A.s.solo.restUntil = 0;
  game.tick();
  assert.equal(A.s.solo.kind, 'pinnacle');
  assert.equal(pinnacleState(A.p).sigils, 1);
  ok('a pinnacle fight needs a Pinnacle Sigil, which is used when the fight starts');
  // win it on the spot
  const b = A.s.solo.battle;
  for (const u of b.units) if (u.side === 'B') { u.hp = 0; u.alive = false; b.kills.push({ enemyId: u.defId, level: u.level, boss: true, elite: false, summoned: false }); }
  b.state = 'victory'; b.time = 123.4;
  A.msgs.length = 0;
  const prem = A.p.premium || 0;
  game.finishSoloBattle(A.s);
  const sum = A.msgs.find(m => m.t === 'battle_end').summary;
  assert.equal(sum.pinnacle, 'iron_tyrant'); assert.ok(sum.firstKill && sum.weekly);
  assert.ok((A.p.premium || 0) > prem);
  assert.ok(ownsCosmetic(A.p, 'title', 'tyrantslayer') && ownsCosmetic(A.p, 'frame', 'iron_tyrant'));
  assert.equal(pinnacleState(A.p).best.iron_tyrant, 123.4);
  assert.ok(sum.items.some(i => i.name === "Tyrant's Crown"), 'weekly bonus unique');
  assert.equal(game.pinnacle.board.iron_tyrant[0].time, 123.4);
  ok('a win: first-kill title & frame, weekly crystals and unique, personal best and the leaderboard');

  // ---- groups fight everything together
  const B = join('pb', 'bravo', 'cleric');
  act(A, 'group_create');
  act(A, 'group_invite', { name: 'bravo' });
  const g = game.groupOf(A.p.id);
  act(B, 'group_accept', { groupId: g.id });
  A.s.solo = { restUntil: 0 }; B.s.solo = { restUntil: 0 };
  game.tick();
  assert.ok(g.battle, 'the group fights together');
  assert.equal(g.fight.kind, 'idle');
  assert.equal(g.fight.zoneId, A.p.zone);
  assert.ok(!A.s.solo.battle && !B.s.solo.battle, 'no solo fights while grouped');
  assert.deepEqual(new Set(g.fight.participants.map(x => x.id)), new Set([A.p.id, B.p.id]));
  ok('two online members in a group fight the leader\'s zone together; nobody fights alone meanwhile');
  // battle order: only the leader; position 1 stands in front
  const keyB = `${B.p.id}:${L.hero(B.p).id}`, keyA = `${A.p.id}:${L.hero(A.p).id}`;
  assert.deepEqual(game.publicGroup(g).order.map(x => x.key).slice(0, 2), [keyA, keyB], 'default: leader first');
  r = act(B, 'group_positions', { order: [keyB, keyA] });
  assert.equal(r.ok, false);
  r = act(A, 'group_positions', { order: [keyB, keyA] });
  assert.equal(r.ok, true, r.error);
  assert.equal(game.publicGroup(g).order[0].key, keyB);
  game.abortGroupFight(g); g.restUntil = 0; game.tick();
  const front = g.battle.units.filter(u => u.side === 'A' && u.kind === 'character').sort((x, y) => x.position - y.position)[0];
  assert.equal(front.ownerId, B.p.id, 'the member stands in front now');
  ok('the leader sets the battle order; the next group fight uses it');
  r = act(B, 'challenge_boss', { zoneId: B.p.zone });
  assert.equal(r.ok, false); assert.match(r.error, /leader/);
  r = act(A, 'challenge_boss', { zoneId: A.p.zone });
  assert.equal(r.ok, true, r.error);
  game.tick();
  assert.equal(g.fight.kind, 'boss');
  ok('only the leader picks the fight: a zone boss with the whole group');
  // the boss fight ends in victory: both get their own rewards
  const gb = g.battle;
  for (const u of gb.units) if (u.side === 'B') { u.hp = 0; u.alive = false; gb.kills.push({ enemyId: u.defId, level: u.level, boss: true, elite: false, summoned: false }); }
  gb.state = 'victory';
  A.msgs.length = 0; B.msgs.length = 0;
  game.tickGroup(g);
  for (const u of [A, B]) { const e = u.msgs.find(m => m.t === 'battle_end' && m.k === 'coop'); assert.ok(e && e.summary.result === 'victory' && e.summary.xp > 0, u.p.name); }
  ok('both members get their own rewards from the group fight');
  // a pinnacle boss as a group: the leader pays
  pinnacleState(A.p).sigils = 1; pinnacleState(B.p).sigils = 0;
  r = act(A, 'pinnacle_start', { bossId: 'silent_choir' });
  assert.equal(r.ok, true, r.error);
  game.tick();
  assert.equal(g.fight.kind, 'pinnacle');
  assert.equal(pinnacleState(A.p).sigils, 0);
  ok('the group leader uses a sigil and the group fights the pinnacle boss together');
  // the arena stays solo
  act(B, 'group_leave');
  assert.equal(game.groupActive(g), true, 'still running its fight');
  game.abortGroupFight(g);
  assert.equal(game.groupActive(g), false, 'a group of one fights alone');
  ok('when only one member is left, the group stops fighting together');
}

console.log(`Pinnacle: all ${n} checks passed.`);
process.exit(0);
