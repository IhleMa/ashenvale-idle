// Networking: REST auth + WebSocket game channel with automatic reconnect.
import { bus } from './state.js';

const TOKEN_KEY = 'ashenvale.token';
let ws = null;
let nextId = 1;
const pending = new Map();
let reconnectDelay = 1000;
let manualClose = false;
let restartingUntil = 0; // during a server restart, retry quickly instead of backing off

export function getToken() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }
export function setToken(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } }

export async function apiPost(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

export function connect() {
  const token = getToken();
  if (!token) return;
  manualClose = false;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);
  bus.emit('connection', 'connecting');
  let opened = false;
  ws.onopen = () => { opened = true; reconnectDelay = 1000; bus.emit('connection', 'online'); };
  ws.onmessage = ev => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.t === 'server_restart') { restartingUntil = Date.now() + 180_000; reconnectDelay = 1000; }
    if (msg.t === 'result') {
      const p = pending.get(msg.id);
      if (p) { pending.delete(msg.id); msg.ok ? p.resolve(msg.result) : p.reject(Object.assign(new Error(msg.error), { details: msg.details || null })); }
      return;
    }
    bus.emit('msg:' + msg.t, msg);
  };
  ws.onclose = ev => {
    if (ev.code === 4001) { // removed by an admin: don't reconnect automatically
      for (const p of pending.values()) p.reject(new Error('Disconnected'));
      pending.clear();
      bus.emit('connection', 'offline');
      bus.emit('kicked', ev.reason);
      return;
    }
    for (const p of pending.values()) p.reject(new Error('Connection lost'));
    pending.clear();
    if (manualClose) return;
    bus.emit('connection', Date.now() < restartingUntil ? 'restarting' : 'offline');
    const retry = () => {
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Date.now() < restartingUntil ? 1500 : Math.min(reconnectDelay * 2, 15000);
    };
    if (!opened) {
      // Server reachable but socket refused → the session token is invalid: back to login
      fetch('/api/health', { cache: 'no-store' }).then(r => {
        // server is up but refused our session → token invalid (never during a restart window)
        if (r.ok && Date.now() >= restartingUntil) { setToken(null); bus.emit('logout'); } else retry();
      }).catch(retry);
      return;
    }
    retry();
  };
}

export function disconnect() {
  manualClose = true;
  if (ws) ws.close();
}

// Sends an action; resolves with the server result, rejects with the server's error message.
export function act(type, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== 1) return reject(new Error('Not connected'));
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ t: 'action', id, type, payload }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('Request timed out')); } }, 10000);
  });
}
