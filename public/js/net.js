// Networking: REST auth + WebSocket game channel with automatic reconnect.
import { bus } from './state.js';

const TOKEN_KEY = 'ashenvale.token';
let ws = null;
let nextId = 1;
const pending = new Map();
let reconnectDelay = 1000;
let manualClose = false;

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
    if (msg.t === 'result') {
      const p = pending.get(msg.id);
      if (p) { pending.delete(msg.id); msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error)); }
      return;
    }
    bus.emit('msg:' + msg.t, msg);
  };
  ws.onclose = () => {
    for (const p of pending.values()) p.reject(new Error('Connection lost'));
    pending.clear();
    if (manualClose) return;
    bus.emit('connection', 'offline');
    const retry = () => { setTimeout(connect, reconnectDelay); reconnectDelay = Math.min(reconnectDelay * 2, 15000); };
    if (!opened) {
      // Server reachable but socket refused → the session token is invalid: back to login
      fetch('/api/health').then(r => {
        if (r.ok) { setToken(null); bus.emit('logout'); } else retry();
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
