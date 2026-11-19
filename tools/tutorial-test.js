// Plays through the new-player tutorial with the real game logic, then checks it through a running server.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const L = await import('../server/playerLogic.js');
const TL = await import('../server/townLogic.js');
const XL = await import('../server/expeditionLogic.js');
const TU = await import('../server/tutorialLogic.js');
const { currentStep, stepProgress, visibleViews, tutorialSteps } = await import('../shared/tutorial.js');
const { getTree } = await import('../shared/data/skilltree.js');
const { canAfford, upgradeCost } = await import('../shared/town.js');
const { speedUpCost } = await import('../shared/premium.js');

let n = 0;
const ok = m => { n++; console.log(`  ✔ ${m}`); };
const stepId = p => currentStep(p)?.id ?? (p.tutorial.done ? 'DONE' : '?');

// ---------------------------------------------------------------- the first fights can't be lost, whatever the class
{
  const { TUTORIAL } = await import('../shared/tutorial.js');
  const C = await import('../shared/combat.js');
  const { buildPartyUnits } = await import('../shared/party.js');
  const { idleWaves } = await import('../shared/encounters.js');
  const { createRng } = await import('../shared/rng.js');
  const { CLASS_IDS } = await import('../shared/data/classes.js');
  const { createCharacter } = await import('../shared/character.js');
  assert.ok(TUTORIAL.protectedSteps.includes('first_fight'));
  for (const classId of CLASS_IDS) for (let seed = 1; seed <= 3; seed++) {
    const ch = createCharacter({ id: 'h', name: 'H', classId, level: 1, isMain: true });
    // three times the usual damage: without protection most classes would lose
    const b = C.createBattle({ seed, allies: buildPartyUnits([ch], { ownerId: 'p', ownerName: 'P' }), waves: idleWaves('whispering_woods', 1, createRng(seed), 1), scale: { hp: 1.5, damage: 3 } });
    b.protected = true; for (const u of b.units) if (u.side === 'A') u.undying = true; // what game.startSoloBattle does during the protected steps
    C.runToEnd(b);
    assert.equal(b.state, 'victory', `${classId} seed ${seed}`);
    assert.equal(b.units.find(u => u.side === 'A').stat.deaths, 0);
  }
  ok(`the first tutorial fights can't be lost: every class wins at level 1 even against 3× enemy damage`);
}

// ---------------------------------------------------------------- logic walk-through
const p = L.migratePlayer(L.newPlayer({ id: 'tut1', username: 'Tutee' }));
assert.equal(p.tutorial, null);
L.createHero(p, { name: 'Tutee', classId: 'warrior' }, {});
TU.startTutorial(p);
assert.equal(stepId(p), 'welcome');
assert.deepEqual([...visibleViews(p)].sort(), ['admin', 'combat', 'progression']);
ok('a new hero starts the tutorial; only Combat (and Progression) are visible');

assert.deepEqual(TU.checkTutorial(p), [], 'acknowledge steps never complete by themselves');
assert.throws(() => TU.ackTutorial(p, { stepId: 'recruit' }), /moved on/);
TU.ackTutorial(p, { stepId: 'welcome' });
assert.equal(stepId(p), 'first_fight');
assert.throws(() => TU.ackTutorial(p, {}), /Finish the current step/);
ok('Continue moves past the welcome; goal steps can not be skipped with Continue');

const gold0 = p.gold;
p.stats.kills += 3;
assert.deepEqual(stepProgress(p), { value: 3, target: 5, done: false });
assert.equal(TU.checkTutorial(p).length, 0);
p.stats.kills += 2;
const r1 = TU.checkTutorial(p);
assert.equal(r1[0].step.id, 'first_fight');
assert.equal(p.gold, gold0 + 100);
assert.equal(stepId(p), 'recruit');
assert.ok(visibleViews(p).has('recruitment') && visibleViews(p).has('party') && !visibleViews(p).has('town'));
ok('5 kills complete the first fight (+100 gold); Recruitment and Party appear');

const offer = p.recruitment.offers[0];
const comp = L.recruit(p, { offerId: offer.offerId });
TU.checkTutorial(p);
assert.equal(stepId(p), 'skill_tree');
ok('recruiting a companion completes the recruit step');

const hero = p.characters[p.heroId];
const tree = getTree(hero.classId);
const next = Object.values(tree.nodes).find(nd => nd.links.includes('start') || tree.nodes.start.links.includes(nd.id));
L.allocateNodes(p, { charId: hero.id, nodeIds: [next.id] });
TU.checkTutorial(p);
assert.equal(stepId(p), 'town');
assert.ok(canAfford(p, upgradeCost('town_hall', 2)), 'the reward covers the Town Hall upgrade exactly');
ok('allocating a skill-tree node completes the step; the reward pays for the Town Hall');

TL.upgradeBuilding(p, { buildingId: 'town_hall' });
const prem0 = p.premium || 0;
TU.checkTutorial(p);
assert.equal(stepId(p), 'expedition');
assert.equal(p.premium, prem0 + 5);
ok('starting the Town Hall upgrade completes the town step (+5 crystals)');

const ex = XL.startExpedition(p, { destId: 'whispering_glade', charIds: [comp.id], hours: 0.25 });
p.stats.expeditionsSent = (p.stats.expeditionsSent || 0) + 1; // done by the expedition_start action
TU.checkTutorial(p);
assert.equal(stepId(p), 'speed_up');
const cost = speedUpCost(ex.endsAt - Date.now(), 10);
assert.ok(cost <= p.premium, `speeding up a 15 min expedition (${cost} 💠) is affordable with the reward`);
L.spendPremium(p, cost);
ex.endsAt = Date.now();
p.stats.expeditionSpeedups = 1;
TU.checkTutorial(p);
assert.equal(stepId(p), 'claim');
ok('sending the expedition and speeding it up with crystals completes both steps');

XL.claimExpedition(p, { id: ex.id });
p.stats.expeditionsClaimed = 1;
TU.checkTutorial(p);
assert.equal(stepId(p), 'party');
assert.equal(p.parties[p.activeParty].members.length, 1, 'the companion left the party for the expedition');
L.setParty(p, { index: p.activeParty, members: [p.heroId, comp.id] });
const gold1 = p.gold;
TU.checkTutorial(p);
assert.equal(stepId(p), 'done');
assert.equal(p.gold, gold1 + 250);
TU.ackTutorial(p, { stepId: 'done' });
assert.equal(p.tutorial.done, true);
assert.equal(visibleViews(p), null);
ok('claim → back into the party → final step; afterwards every page is visible');

// a natural return also counts (no softlock when the player waits instead of paying)
{
  const q = L.migratePlayer(L.newPlayer({ id: 'tut2', username: 'Waiter' }));
  L.createHero(q, { name: 'Waiter', classId: 'mage' }, {});
  TU.startTutorial(q);
  q.tutorial.step = tutorialSteps().findIndex(s => s.id === 'speed_up');
  q.tutorial.base = {};
  q.expeditions.push({ id: 'x', destId: 'whispering_glade', charIds: [], hours: 0.25, startedAt: 0, endsAt: Date.now() - 1000 });
  TU.checkTutorial(q);
  assert.equal(stepId(q), 'claim');
  TU.skipTutorial(q);
  assert.ok(q.tutorial.done && q.tutorial.skipped && visibleViews(q) === null);
  ok('a naturally returned expedition also completes the speed-up step; skipping unlocks everything');
}
// existing players don't get the tutorial
{
  const old = { id: 'old', name: 'Veteran', heroId: 'h', characters: { h: { id: 'h', classId: 'warrior', level: 30, equipment: {}, tree: { allocated: ['start'] }, isMain: true, loadoutV2: true } } };
  L.migratePlayer(old);
  assert.equal(old.tutorial.done, true);
  ok('players from before the tutorial skip it');
}

// ---------------------------------------------------------------- through the server
const PORT = 18_900 + Math.floor(Math.random() * 500);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ashen-tut-'));
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, BACKUP_HOURS: '0' }, stdio: ['pipe', 'pipe', 'inherit'] });
try {
  await new Promise(res => srv.stdout.on('data', d => { if (String(d).includes('listening')) res(); }));
  const reg = await (await fetch(`http://127.0.0.1:${PORT}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'newbie', password: 'secret123' }) })).json();
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${reg.token}`);
  let state = null; const pending = new Map(); let id = 0; const msgs = [];
  ws.on('message', d => { const m = JSON.parse(d); msgs.push(m); if (m.t === 'state') state = m.player; if (m.t === 'result') { pending.get(m.id)?.(m); pending.delete(m.id); } });
  await new Promise(r => ws.on('open', r));
  const act = (type, payload = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ t: 'action', id: i, type, payload })); });
  await act('create_hero', { name: 'Newbie', classId: 'ranger' });
  const until = async (fn, ms = 60_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise(r => setTimeout(r, 200)); } return false; };
  assert.ok(await until(() => state?.tutorial?.step === 0 && !state.tutorial.done), 'state carries the tutorial');
  ok('server: a new hero gets the tutorial in its state');
  const r = await act('tutorial_ack', { stepId: 'welcome' });
  assert.ok(r.ok, r.error);
  // the real battles count the kills
  assert.ok(await until(() => state?.tutorial?.step >= 2, 90_000), 'first fight completes from real battles');
  assert.ok(msgs.some(m => m.t === 'tutorial' && m.done.some(d => d.id === 'first_fight')));
  assert.ok(msgs.some(m => m.t === 'toast' && /Your first fights/.test(m.text)));
  ok('server: real battles complete the first-fight step, with toast and reward');
  const sk = await act('tutorial_skip');
  assert.ok(sk.ok);
  assert.ok(await until(() => state?.tutorial?.done && state.tutorial.skipped));
  ok('server: skipping works');
  ws.close();
} finally {
  srv.kill('SIGTERM');
  fs.rmSync(DATA, { recursive: true, force: true });
}
console.log(`Tutorial: all ${n} checks passed.`);
process.exit(0);
