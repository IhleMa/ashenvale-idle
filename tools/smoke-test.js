// End-to-end smoke test: starts a server on a temp data dir and plays through the main flows.
// Usage: npm test
import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const PORT = 18000 + Math.floor(Math.random() * 1000);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ashenvale-test-'));
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? '✔' : '✘'} ${msg}`); if (!cond) failures++; };

const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT, DATA_DIR: DATA, ADMIN_USERS: 'alice' }, stdio: ['pipe', 'pipe', 'inherit'] });
await new Promise(res => srv.stdout.on('data', d => { if (String(d).includes('listening')) res(); }));

async function api(p, body) {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

class Client {
  constructor(token) {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${token}`);
    this.msgs = []; this.pending = new Map(); this.n = 0; this.state = null; this.group = null; this.invites = [];
    this.ws.on('message', d => {
      const m = JSON.parse(d);
      this.msgs.push(m);
      if (m.t === 'state') this.state = m.player;
      if (m.t === 'group') this.group = m.group;
      if (m.t === 'invites') this.invites = m.invites;
      if (m.t === 'result') { this.pending.get(m.id)?.(m); this.pending.delete(m.id); }
    });
  }
  open() { return new Promise(r => this.ws.on('open', r)); }
  act(type, payload = {}) {
    const id = ++this.n;
    return new Promise(res => {
      if (this.ws.readyState !== 1) return res({ ok: false, error: 'socket closed' });
      this.pending.set(id, res);
      this.ws.send(JSON.stringify({ t: 'action', id, type, payload }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); res({ ok: false, error: 'timeout' }); } }, 10000);
    });
  }
  count(t) { return this.msgs.filter(m => m.t === t).length; }
}

try {
  const r1 = await api('/api/register', { username: 'alice', password: 'secret123' });
  check(r1.status === 200 && r1.body.token, 'register alice');
  const dup = await api('/api/register', { username: 'Alice', password: 'secret123' });
  check(dup.status === 400, 'duplicate username rejected');
  const bad = await api('/api/login', { username: 'alice', password: 'wrong' });
  check(bad.status === 401, 'wrong password rejected');
  const r2 = await api('/api/register', { username: 'bob', password: 'secret456' });
  const assets = await (await fetch(BASE + '/api/assets')).json();
  check(typeof assets.assets === 'object', 'asset index served');
  const page = await fetch(BASE + '/');
  check(page.status === 200, 'index page served');
  const trav = await fetch(BASE + '/shared/..%2f..%2fpackage.json');
  check(trav.status === 403 || trav.status === 404, 'path traversal blocked');

  const a = new Client(r1.body.token); await a.open();
  const b = new Client(r2.body.token); await b.open();
  await sleep(300);
  check(a.state && !a.state.heroId, 'alice starts without hero');
  let res = await a.act('recruit', { offerId: 'x' });
  check(!res.ok, 'actions blocked before hero creation');
  res = await a.act('create_hero', { name: 'Aria', classId: 'warrior' });
  check(res.ok, 'create warrior hero');
  res = await b.act('create_hero', { name: 'Bram', classId: 'cleric' });
  check(res.ok, 'create cleric hero');
  res = await a.act('create_hero', { name: 'Again', classId: 'mage' });
  check(!res.ok, 'second hero rejected');
  await sleep(200);
  const offer = a.state.recruitment.offers[0];
  check(a.state.recruitment.costs[offer.offerId] === 0, 'first recruit is free');
  res = await a.act('recruit', { offerId: offer.offerId });
  check(res.ok, 'recruit companion');
  await sleep(200);
  check(Object.keys(a.state.characters).length === 2, 'roster has 2 characters');
  check(a.state.parties[0].members.length === 2, 'recruit auto-added to party');
  const heroId = a.state.heroId;
  res = await a.act('set_party', { index: 0, members: [a.state.parties[0].members[1]] });
  check(!res.ok, 'party without hero rejected');
  res = await a.act('set_rule', { charId: heroId, abilityId: 'heroic_strike', rule: { conditions: [{ type: 'self_hp_above', value: 150 }, { type: 'evil' }], target: { selector: 'ally_random' } } });
  check(!res.ok, 'invalid rule rejected');
  res = await a.act('set_rule', { charId: heroId, abilityId: 'heroic_strike', rule: { mode: 'any', conditions: [{ type: 'self_hp_above', value: 150 }], target: { selector: 'enemy_lowest_hp' }, targetConditions: [{ type: 'target_hp_below', value: 50 }] } });
  check(res.ok, 'valid rule accepted');
  await sleep(200);
  check(a.state.characters[heroId].rules.heroic_strike.conditions[0].value === 100, 'rule values clamped');
  res = await a.act('allocate_nodes', { charId: heroId, nodeIds: ['b0r3n0'] });
  check(!res.ok, 'cannot allocate a disconnected tree node');
  res = await a.act('allocate_nodes', { charId: heroId, nodeIds: ['b0r1n0', 'b0r2n0'] });
  check(!res.ok, 'cannot spend more tree points than available');
  res = await a.act('allocate_nodes', { charId: heroId, nodeIds: ['b0r1n0'] });
  check(res.ok, 'allocate first tree node (Taunt)');
  await sleep(200);
  check(a.state.characters[heroId].abilities.taunt === 1, 'tree node grants ability');
  check(a.state.characters[heroId].loadout.includes('taunt'), 'new ability added to loadout');
  res = await a.act('refund_node', { charId: heroId, nodeId: 'start' });
  check(!res.ok, 'origin cannot be refunded');

  await sleep(2500);
  check(a.count('battle_start') >= 1, 'idle battle started');
  check(a.count('bt') > 5, 'battle ticks streaming');
  for (let i = 0; i < 60 && a.count('battle_end') < 1; i++) await sleep(1000);
  check(a.count('battle_end') >= 1, 'a battle finished');
  check(a.state.stats.kills > 0 || a.msgs.some(m => m.t === 'battle_end' && m.summary.result === 'defeat'), 'kills recorded (or defeat)');

  // rankings & inspect
  res = await a.act('get_rankings', { category: 'level' });
  check(res.ok && res.result.total === 2 && res.result.mine, 'rankings list players and my rank');
  res = await a.act('inspect_player', { name: 'bob' });
  check(res.ok && res.result.hero.name === 'Bram' && res.result.hero.equipment && !('gold' in res.result), 'inspect shows build but not gold');
  await b.act('set_settings', { publicProfile: false });
  res = await a.act('inspect_player', { name: 'bob' });
  check(res.ok && res.result.hidden && !res.result.hero.equipment, 'private profile hides build');
  res = await a.act('inspect_player', { name: 'nobody' });
  check(!res.ok, 'inspecting unknown player fails');

  // groups (co-op and trading unlock by hero level: lock first, then level both heroes up)
  res = await a.act('group_create');
  check(!res.ok && /unlocks at hero level/.test(res.error), 'co-op locked for a new hero');
  for (const id of [a.state.id, b.state.id]) await a.act('admin_give_xp', { id, target: 'hero', mode: 'set', amount: 20 });
  await sleep(200);
  res = await a.act('group_create');
  check(res.ok, 'group created');
  res = await a.act('group_invite', { name: 'bob' });
  check(res.ok, 'bob invited');
  await sleep(200);
  check(b.invites.length === 1, 'bob received invite');
  res = await b.act('group_accept', { groupId: b.invites[0].groupId });
  check(res.ok, 'bob accepted');
  await sleep(200);
  check(a.group?.members.length === 2, 'group has 2 members');
  res = await b.act('group_start', { encounterId: 'void_incursion' });
  check(!res.ok, 'non-leader cannot start');
  res = await a.act('group_start', { encounterId: 'void_incursion' });
  check(!res.ok && /level/.test(res.error), 'level requirement enforced: ' + res.error);
  res = await a.act('group_chat', { text: 'hello <b>bob</b>' });
  await sleep(200);
  check(b.group.chat.some(c => c.text.includes('hello')), 'group chat works');
  res = await b.act('group_leave');
  check(res.ok, 'bob left group');

  // admin & auction house
  res = await b.act('admin_overview');
  check(!res.ok && /Admins only/.test(res.error), 'non-admin blocked from admin actions');
  res = await a.act('admin_overview');
  check(res.ok && res.result.accounts === 2, 'admin overview works');
  const bobId = b.state.id;
  res = await a.act('admin_give', { id: bobId, gold: 1000, item: { type: 'unique', uniqueId: 'emberheart', level: 10 } });
  check(res.ok && res.result.item.unique === 'emberheart', 'admin gift: unique item');
  await sleep(300);
  check(b.state.mailbox.length === 2, 'gift arrives by mail');
  const bobGold = b.state.gold;
  res = await b.act('collect_mail', {});
  await sleep(200);
  check(res.ok && b.state.gold === bobGold + 1000 && b.state.inventory.some(i => i.unique === 'emberheart'), 'mail collected (gold + unique)');
  const uniqueItem = b.state.inventory.find(i => i.unique === 'emberheart');
  res = await b.act('ah_list', { itemUid: uniqueItem.uid, price: 500, hours: 24 });
  check(res.ok && res.result.fee === 10, 'listed unique on auction house (fee 2%)');
  await sleep(200);
  check(!b.state.inventory.some(i => i.uid === uniqueItem.uid), 'listed item left the inventory');
  res = await b.act('ah_buy', { id: res.result.listing.id });
  check(!res.ok, 'cannot buy own auction');
  res = await a.act('ah_search', { query: 'ember' });
  check(res.ok && res.result.rows.length === 1, 'auction search finds listing');
  const listingId = res.result.rows[0].id;
  await a.act('admin_give', { id: a.state.id, gold: 2000 });
  await a.act('collect_mail', {});
  await sleep(200);
  const aliceGold = a.state.gold;
  res = await a.act('ah_buy', { id: listingId });
  await sleep(300);
  check(res.ok && a.state.gold === aliceGold - 500 && a.state.inventory.some(i => i.uid === uniqueItem.uid), 'buyer paid and received the item');
  check(b.state.mailbox.some(m => m.gold === 475), 'seller got 475 gold by mail (5% tax)');
  res = await a.act('admin_ban', { id: bobId, reason: 'testing', hours: 1 });
  await sleep(300);
  const banned = await api('/api/login', { username: 'bob', password: 'secret456' });
  check(res.ok && banned.status === 403, 'banned player cannot log in');
  await a.act('admin_unban', { id: bobId });
  const unbanned = await api('/api/login', { username: 'bob', password: 'secret456' });
  check(unbanned.status === 200, 'unbanned player can log in again');
  // persistent announcements: bob is offline (his socket was closed by the ban) while it is posted
  res = await a.act('admin_broadcast', { text: 'Patch tonight!', hours: 24 });
  const annId = res.result?.id;
  await sleep(200);
  check(res.ok && a.msgs.some(m => m.t === 'announcement' && m.announcement.id === annId), 'announcement delivered live to online players');
  const tmp = await a.act('admin_broadcast', { text: 'temporary', hours: 0 });
  const b2 = new Client(unbanned.body.token); await b2.open();
  await sleep(500);
  let annMsg = b2.msgs.find(m => m.t === 'announcements');
  check(annMsg && annMsg.unseen.includes(annId) && annMsg.list.some(x => x.text === 'Patch tonight!'), 'offline player gets the announcement as unread when coming back');
  await b2.act('ack_announcements', { upTo: Math.max(...annMsg.list.map(x => x.at)) });
  res = await a.act('admin_announcement_delete', { id: tmp.result.id });
  await sleep(200);
  check(res.ok && b2.msgs.some(m => m.t === 'announcement_removed' && m.id === tmp.result.id), 'deleted announcement removed for online players');
  b2.ws.close();
  await sleep(300);
  const b3 = new Client((await api('/api/login', { username: 'bob', password: 'secret456' })).body.token); await b3.open();
  await sleep(500);
  annMsg = b3.msgs.find(m => m.t === 'announcements');
  check(annMsg && annMsg.unseen.length === 0 && annMsg.list.length === 1, 'read announcements are not shown again; deleted one is gone');
  b3.ws.close();
  res = await b.act('admin_broadcast', { text: 'x' });
  check(!res.ok, 'non-admin cannot announce');
  res = await a.act('admin_settings', { changes: { xpRate: 2, motd: 'Welcome!' } });
  check(res.ok && res.result.xpRate === 2, 'admin settings saved');

  // premium currency
  res = await a.act('admin_give', { id: a.state.id, premium: 100 });
  check(res.ok, 'admin can send premium currency');
  await a.act('collect_mail', {});
  await sleep(200);
  check(a.state.premium === 100, 'crystals arrive through the mailbox');
  const recruitId = Object.keys(a.state.characters).find(id => id !== a.state.heroId);
  res = await a.act('expedition_start', { destId: 'copper_hills', charIds: [recruitId], hours: 8 });
  check(res.ok, 'expedition started (8h)');
  const exId = res.result.id;
  res = await a.act('expedition_speedup', { id: exId, maxCost: 1 });
  check(!res.ok && /price/.test(res.error), 'speed-up refuses to charge more than the shown price');
  res = await a.act('expedition_speedup', { id: exId, maxCost: 48 });
  await sleep(200);
  check(res.ok && res.result.cost === 48 && a.state.premium === 52, 'expedition finished instantly for 48 crystals (8h at 10 min/crystal)');
  res = await a.act('expedition_claim', { id: exId });
  check(res.ok && Object.keys(res.result.got).length > 0, 'sped-up expedition gives full rewards');
  res = await a.act('expedition_speedup', { id: 'not-mine', maxCost: 99 });
  check(!res.ok, 'cannot speed up an unknown expedition');
  res = await a.act('expedition_start', { destId: 'copper_hills', charIds: [recruitId], hours: 8 });
  await a.act('admin_give', { id: a.state.id, premium: 0, gold: 1 });
  const before = a.state.premium;
  const ex2 = res.result.id;
  a.state.premium = 0; // client view only; the server still knows the real balance
  res = await a.act('expedition_speedup', { id: ex2, maxCost: 48 });
  await sleep(200);
  await a.act('expedition_claim', { id: ex2 });
  check(res.ok && a.state.premium === before - 48, 'server uses its own balance, not the client\'s');
  res = await a.act('expedition_start', { destId: 'copper_hills', charIds: [recruitId], hours: 8 });
  res = await a.act('expedition_speedup', { id: res.result?.id, maxCost: 48 });
  check(!res.ok && /need/.test(res.error), 'not enough crystals is rejected: ' + res.error);

  // offline progression: stop the server, pretend alice was away for 3 hours (edit the database), start again
  a.ws.close();
  await sleep(500);
  srv.kill('SIGINT');
  await new Promise(r => srv.once('exit', r));
  const db = new Database(path.join(DATA, 'ashenvale.db'));
  check(db.prepare('SELECT COUNT(*) n FROM accounts').get().n === 2, 'accounts stored in SQLite');
  db.prepare("UPDATE players SET data = json_set(data, '$.lastActive', ?) WHERE id = ?").run(Date.now() - 3 * 3600 * 1000, a.state.id);
  check(JSON.parse(db.prepare("SELECT data FROM docs WHERE key = 'auction'").get().data).history.length === 1, 'auction house saved in the database');
  db.close();
  const srv2 = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT, DATA_DIR: DATA }, stdio: ['pipe', 'pipe', 'inherit'] });
  await new Promise(res2 => srv2.stdout.on('data', d => { if (String(d).includes('listening')) res2(); }));
  const login = await api('/api/login', { username: 'alice', password: 'secret123' });
  const a2 = new Client(login.body.token); await a2.open();
  await sleep(1500);
  const off = a2.msgs.find(m => m.t === 'offline');
  annMsg = a2.msgs.find(m => m.t === 'announcements');
  check(annMsg && annMsg.list.some(x => x.id === annId), 'announcements survive a server restart');
  check(off && off.summary.fights > 0 && off.summary.xp > 0, `offline progression: ${off ? JSON.stringify({ fights: off.summary.fights, xp: off.summary.xp, gold: off.summary.gold, levels: off.summary.levels }) : 'none'}`);
  res = await a2.act('group_create');
  res = await a2.act('group_start', { encounterId: 'ashen_crypt' });
  check(res.ok, 'solo group starts co-op dungeon ' + (res.error || ''));
  await sleep(2000);
  check(a2.msgs.some(m => m.t === 'battle_start' && m.k === 'coop'), 'co-op battle started');
  check(a2.msgs.filter(m => m.t === 'bt' && m.k === 'coop').length > 5, 'co-op ticks streaming');
  res = await a2.act('dismiss', { charId: Object.keys(a2.state.characters).find(id => id !== a2.state.heroId) });
  check(!res.ok, 'cannot dismiss during co-op');
  a2.ws.close(); b.ws.close();
  srv2.kill('SIGINT');
  await sleep(500);
} catch (e) {
  console.error(e); failures++;
} finally {
  srv.kill('SIGINT');
  fs.rmSync(DATA, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
