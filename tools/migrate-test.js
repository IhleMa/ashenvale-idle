// Checks that old JSON saves are imported into SQLite and that saving/deleting/backups work.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/store.js';
import { Settings } from '../server/settings.js';
import { AdminManager } from '../server/admin.js';
import { Announcements } from '../server/announcements.js';

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? '✔' : '✘'} ${msg}`); if (!ok) failures++; };
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ashen-migrate-'));
const w = (f, v) => fs.writeFileSync(path.join(DATA, f), JSON.stringify(v));

try {
  // ---- an old JSON data folder
  fs.mkdirSync(path.join(DATA, 'players'));
  w('accounts.json', { alice: { id: 'a1', username: 'Alice', hash: 'x', salt: 'y', tokens: [] }, bob: { id: 'b2', username: 'bob', hash: 'x', salt: 'y', tokens: [] } });
  w('players/a1.json', { id: 'a1', name: 'Alice', gold: 1234, inventory: [{ uid: 'i1' }] });
  w('players/b2.json', { id: 'b2', name: 'bob', gold: 5 });
  w('settings.json', { xpRate: 3, motd: 'hi' });
  w('admins.json', ['bob']);
  w('admin-log.json', [{ at: 1, admin: 'bob', action: 'test', target: '-' }]);
  w('auction.json', { listings: [{ id: 'L1', sellerId: 'a1' }], history: [] });
  w('announcements.json', [{ id: 'n1', text: 'old news', from: 'bob', at: Date.now(), expiresAt: null }]);
  w('groups.json', [{ id: 'g1', leaderId: 'a1', members: ['a1'], chat: [] }]);

  const logs = [];
  let store = new Store(DATA, { log: m => logs.push(m) });
  check(logs.some(l => /2 accounts, 2 players, 6 other files/.test(l)), 'import reported: ' + logs[0]);
  check(store.getAccount('ALICE')?.id === 'a1', 'accounts imported (case-insensitive lookup)');
  check(store.loadPlayer('a1')?.gold === 1234, 'player imported');
  check(new Settings(store).get('xpRate') === 3, 'settings imported');
  check(new AdminManager(store).has('bob'), 'admins imported');
  check(new Announcements(store).active()[0]?.text === 'old news', 'announcements imported');
  check(store.getDoc('auction').listings.length === 1 && store.getDoc('groups').length === 1, 'auction house and groups imported');
  check(!fs.existsSync(path.join(DATA, 'accounts.json')) && !fs.existsSync(path.join(DATA, 'players')), 'old files moved out of the way');
  const backupDir = fs.readdirSync(DATA).find(f => f.startsWith('json-backup-'));
  check(backupDir && fs.existsSync(path.join(DATA, backupDir, 'players', 'a1.json')), 'old files kept in ' + backupDir);

  // ---- changes, flush, reopen
  const p = store.loadPlayer('a1');
  p.gold = 999;
  store.savePlayerSoon(p);
  store.setAccount({ id: 'c3', username: 'Cara', hash: 'x', salt: 'y', tokens: [] });
  store.putDoc('auction', { listings: [], history: [{ key: 'k', unit: 5, at: 1 }] });
  store.flush();
  const backup = store.backup();
  check(fs.existsSync(backup) && fs.statSync(backup).size > 0, 'backup written');
  store.deleteAccount(store.getAccount('bob'));
  store.close();

  // a JSON file that shows up again later must not be imported a second time
  w('accounts.json', { zed: { id: 'z9', username: 'zed', tokens: [] } });
  store = new Store(DATA, { log: () => {} });
  check(store.loadPlayer('a1').gold === 999, 'player changes survive a restart');
  check(store.getAccount('cara')?.id === 'c3', 'new account survives a restart');
  check(!store.getAccount('bob') && !store.loadPlayer('b2'), 'deleted account and player are gone');
  check(!store.getAccount('zed'), 'legacy import runs only once');
  check(store.getDoc('auction').history.length === 1, 'documents survive a restart');
  store.close();
} catch (e) {
  console.error(e); failures++;
} finally {
  fs.rmSync(DATA, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
