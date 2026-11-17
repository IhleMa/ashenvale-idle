// Ashenvale Idle server: static files + JSON API + WebSocket game channel.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Store } from './store.js';
import { AssetIndex } from './assets.js';
import { Game } from './game.js';
import { BotManager, ARCHETYPES } from './bots.js';
import { computeBuildId } from './version.js';
import { Settings } from './settings.js';
import { AdminManager, isBanned } from './admin.js';
import { execFile } from 'node:child_process';
import { createAccount, verifyLogin, issueToken, accountFromToken, revokeToken, RateLimiter } from './auth.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.SERVER_PORT || process.env.PORT || 8080);
const APP_NAME = process.env.APP_NAME || 'Ashenvale Idle';
const APP_SHORT_NAME = process.env.APP_SHORT_NAME || APP_NAME.split(' ')[0];
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || 'data');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SHARED_DIR = path.join(ROOT, 'shared');
const ASSETS_DIR = path.join(PUBLIC_DIR, 'assets');
const ALLOW_REGISTRATION = process.env.ALLOW_REGISTRATION !== 'false';
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';

const log = (...a) => console.log(new Date().toISOString(), ...a);
let store;
try { store = new Store(DATA_DIR, { log }); } catch (e) { log('Could not open the database:', e.message); process.exit(1); }
const assets = new AssetIndex(ASSETS_DIR);
const settings = new Settings(store, { registrationOpen: ALLOW_REGISTRATION });
const admins = new AdminManager(store, process.env.ADMIN_USERS || '');
const game = new Game({ store, assets, log, settings, admins, buildId: computeBuildId(ROOT) });
const bots = new BotManager(game, { log });
game.bots = bots;
game.loadGroups();
const authLimiter = new RateLimiter(20, 60_000);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};

function clientIp(req) {
  if (TRUST_PROXY && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return req.socket.remoteAddress;
}

function sendText(res, type, body, headers = {}) {
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', ...headers });
  res.end(body);
}

// Web app manifest. Your own icons override the defaults: public/assets/ui/app-icon-192.png and app-icon-512.png
function appManifest() {
  const own = size => fs.existsSync(path.join(PUBLIC_DIR, 'assets', 'ui', `app-icon-${size}.png`));
  const icon = (size, purpose = 'any') => ({ src: own(size) ? `/assets/ui/app-icon-${size}.png` : `/icons/${purpose === 'maskable' ? 'maskable' : 'icon'}-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose });
  return {
    id: '/', name: APP_NAME, short_name: APP_SHORT_NAME, description: 'Multiplayer idle RPG — build your party, script their tactics, conquer together.',
    start_url: '/?source=app', scope: '/', display: 'standalone', orientation: 'any',
    background_color: '#120d0b', theme_color: '#120d0b', categories: ['games'],
    icons: [icon(192), icon(512), icon(512, 'maskable')],
  };
}

// Service worker: network-first (so updates arrive immediately), cached copy when offline.
// The cache name contains the build id, so every update replaces the old cache.
function serviceWorkerSource() {
  return `// Ashenvale Idle service worker — build ${game.buildId}
const CACHE = 'ashenvale-${game.buildId}';
const SHELL = ['/', '/css/style.css', '/js/main.js', '/favicon.svg', '/icons/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('ashenvale-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname === '/ws' || url.pathname === '/sw.js') return;
  e.respondWith(fetch(req).then(res => {
    if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(r => r || (req.mode === 'navigate' ? caches.match('/') : Response.error()))));
});
`;
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readBody(req, limit = 10_000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

function serveStatic(req, res, baseDir, relPath) {
  const decoded = decodeURIComponent(relPath);
  const file = path.normalize(path.join(baseDir, decoded));
  if (!file.startsWith(baseDir + path.sep) && file !== baseDir) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    const ext = path.extname(file).toLowerCase();
    const isAsset = file.startsWith(ASSETS_DIR);
    const etag = `"${st.size}-${st.mtimeMs}"`;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304); return res.end(); }
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size, ETag: etag,
      'Cache-Control': isAsset ? 'public, max-age=300' : 'no-cache', 'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    if (p === '/api/health') return json(res, 200, { ok: true, online: game.sessions.size });
    if (p === '/api/assets') return json(res, 200, { assets: assets.get() });
    // installable app (PWA)
    if (p === '/manifest.webmanifest') return sendText(res, MIME['.webmanifest'], JSON.stringify(appManifest()));
    if (p === '/sw.js') return sendText(res, MIME['.js'], serviceWorkerSource(), { 'Service-Worker-Allowed': '/' });
    if (p === '/api/register' && req.method === 'POST') {
      if (!authLimiter.allow(clientIp(req))) return json(res, 429, { error: 'Too many attempts, try again in a minute' });
      if (!settings.get('registrationOpen')) return json(res, 403, { error: 'Registration is currently closed on this server' });
      const body = await readBody(req);
      try {
        const acc = createAccount(store, body.username, body.password);
        store.flush();
        log('New account', acc.username);
        return json(res, 200, { token: issueToken(store, acc), username: acc.username });
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (p === '/api/login' && req.method === 'POST') {
      if (!authLimiter.allow(clientIp(req))) return json(res, 429, { error: 'Too many attempts, try again in a minute' });
      const body = await readBody(req);
      try {
        const acc = verifyLogin(store, body.username, body.password);
        if (isBanned(acc)) return json(res, 403, { error: `This account is banned${acc.banned.until ? ` until ${new Date(acc.banned.until).toUTCString()}` : ''}: ${acc.banned.reason}` });
        const token = issueToken(store, acc);
        store.flush();
        return json(res, 200, { token, username: acc.username });
      } catch (e) { return json(res, 401, { error: e.message }); }
    }
    if (p === '/api/logout' && req.method === 'POST') {
      const body = await readBody(req);
      revokeToken(store, body.token);
      return json(res, 200, { ok: true });
    }
    if (p.startsWith('/api/')) return json(res, 404, { error: 'Not found' });
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    if (p.startsWith('/shared/')) return serveStatic(req, res, SHARED_DIR, p.slice('/shared/'.length));
    return serveStatic(req, res, PUBLIC_DIR, p === '/' ? 'index.html' : p.slice(1));
  } catch (e) {
    log('HTTP error', e);
    if (!res.headersSent) json(res, 500, { error: 'Server error' });
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/ws') return socket.destroy();
  const account = accountFromToken(store, url.searchParams.get('token'));
  if (!account || isBanned(account)) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
  wss.handleUpgrade(req, socket, head, ws => {
    const session = game.connect(ws, account);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', data => game.handleMessage(session, ws, data.toString()));
    ws.on('close', () => game.disconnect(ws, account.id));
    ws.on('error', () => {});
  });
});

// drop dead connections
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);

game.start();
bots.start();
if (bots.bots.size) log(`${bots.bots.size} bot player(s) loaded${bots.enabled ? '' : ' (paused)'} — type "bots" to list them.`);
// automatic daily database backup (data/backups, newest 7 kept)
const BACKUP_HOURS = Number(process.env.BACKUP_HOURS ?? 24);
if (BACKUP_HOURS > 0) setInterval(() => { try { log(`Automatic backup: ${path.basename(store.backup())}`); } catch (e) { log('Automatic backup failed:', e.message); } }, BACKUP_HOURS * 3600_000).unref();
server.listen(PORT, HOST, () => {
  const st = store.stats();
  log(`Ashenvale Idle server listening on http://${HOST}:${PORT} (database: ${store.file}, ${st.accounts} accounts, ${st.sizeMb} MB, ${st.driver}; build ${game.buildId})`);
  log('Type "help" for console commands (e.g. "update" to pull a new version).');
});

let stopping = false;
function shutdown(sig) {
  if (stopping) return;
  stopping = true;
  log(`${sig} received, saving and shutting down...`);
  try { game.broadcast({ t: 'server_restart' }); } catch { /* ignore */ }
  try { bots.stop(); bots.persist(); } catch (e) { log('Error while stopping bots', e); }
  try { game.stop(); } catch (e) { log('Error while saving', e); }
  try { store.close(); } catch (e) { log('Error while closing the database', e); }
  for (const ws of wss.clients) ws.close(1012, 'Server restarting');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
// ------------------------------------------------------------------ console commands (Pterodactyl console / terminal)
const git = args => new Promise((resolve, reject) => execFile('git', args, { cwd: ROOT, timeout: 120_000 }, (err, out, errOut) => (err ? reject(new Error((errOut || err.message).trim())) : resolve(out.trim()))));
let updating = false;

async function runUpdate() {
  if (updating) return log('Update already running');
  updating = true;
  try {
    const before = await git(['rev-parse', 'HEAD']);
    log('Pulling latest version from git...');
    await git(['pull', '--ff-only']);
    const after = await git(['rev-parse', 'HEAD']);
    if (before === after) return log('Already up to date.');
    const changed = (await git(['diff', '--name-only', before, after])).split('\n').filter(Boolean);
    const serverSide = changed.filter(f => /^(server|shared)\//.test(f) || /^package(-lock)?\.json$/.test(f));
    log(`Updated ${before.slice(0, 7)} -> ${after.slice(0, 7)} (${changed.length} file(s) changed)`);
    if (serverSide.length) {
      log(`Server-side files changed (${serverSide.slice(0, 5).join(', ')}${serverSide.length > 5 ? ', ...' : ''}).`);
      log('>>> A RESTART is required to apply them. Players reconnect automatically after the restart.');
      game.broadcast({ t: 'toast', kind: 'info', text: 'A game update is ready — the server will restart briefly soon. You will reconnect automatically.' });
    } else {
      game.buildId = computeBuildId(ROOT);
      game.broadcast({ t: 'client_update', buildId: game.buildId });
      log('Client-only update applied live — no restart needed. Open game pages refresh themselves.');
    }
  } catch (e) {
    log('Update failed:', e.message);
  } finally {
    updating = false;
  }
}

const COMMANDS = {
  help: () => log('Commands: update | reload-clients | players | say <message> | admin add|remove|list <name> | bots [add <n> [type] | remove <name|all> | on | off] | backup | db | stop'),
  bots: args => {
    const [sub, a, b] = args.split(/\s+/).filter(Boolean);
    if (sub === 'add') { const made = bots.add(Number(a) || 1, b); return log(`Added ${made.length} bot(s): ${made.map(x => `${x.name} (${x.archetype})`).join(', ')}. Types: ${Object.keys(ARCHETYPES).join(', ')}`); }
    if (sub === 'remove') return log(a ? `Removed ${bots.remove(a)} bot(s).` : 'Usage: bots remove <name|all>');
    if (sub === 'on' || sub === 'off') { bots.setEnabled(sub === 'on'); return log(`Bots ${sub === 'on' ? 'running' : 'paused'}.`); }
    const list = bots.list();
    log(`${list.length} bot(s), ${list.filter(x => x.online).length} online${bots.enabled ? '' : ' — PAUSED (bots on)'}. Add: bots add <n> [${Object.keys(ARCHETYPES).join('|')}]`);
    for (const x of list) log(`  ${x.online ? '●' : '○'} ${x.name.padEnd(16)} ${String(x.label).padEnd(8)} ${x.hero ? `Lv ${String(x.hero.level).padStart(2)} ${x.hero.classId.padEnd(7)}` : 'no hero    '} ${x.doing}`);
  },
  backup: () => { try { log(`Backup written: ${store.backup()}`); } catch (e) { log('Backup failed:', e.message); } },
  db: () => { const st = store.stats(); log(`Database ${store.file}: ${st.accounts} accounts, ${st.players} players, ${st.sizeMb} MB (driver: ${st.driver})`); },
  admin: args => {
    const [sub, name] = args.split(/\s+/);
    if (sub === 'list') return log('Admins:', admins.list().join(', ') || '(none)');
    if (!name || !['add', 'remove'].includes(sub)) return log('Usage: admin add <username> | admin remove <username> | admin list');
    if (!store.getAccount(name)) return log(`No account named "${name}"`);
    if (sub === 'add') { admins.add(name); log(`${name} is now an admin (they may need to refresh the page).`); }
    else log(admins.remove(name) ? `${name} is no longer an admin.` : `${name} is set via ADMIN_USERS — remove them there.`);
  },
  stop: () => shutdown('stop'),
  update: () => runUpdate(),
  'reload-clients': () => { game.buildId = computeBuildId(ROOT); game.broadcast({ t: 'client_update', buildId: game.buildId, force: true }); log('Told all open pages to refresh.'); },
  players: () => log(`${game.sessions.size} online: ${[...game.sessions.values()].map(s => s.player.name).join(', ') || '-'}`),
  say: text => { if (text) { game.announce(text, 'Server', 24); log('Announcement sent (stays visible for 24h for players who are offline).'); } },
};
let stdinBuf = '';
process.stdin.on('data', d => {
  stdinBuf += d.toString();
  let i;
  while ((i = stdinBuf.indexOf('\n')) >= 0) {
    const line = stdinBuf.slice(0, i).trim();
    stdinBuf = stdinBuf.slice(i + 1);
    if (!line) continue;
    const [cmd, ...rest] = line.split(' ');
    const fn = COMMANDS[cmd.toLowerCase()];
    if (fn) fn(rest.join(' ').trim()); else log(`Unknown command "${cmd}". Type "help".`);
  }
});
process.stdin.on('error', () => {});
