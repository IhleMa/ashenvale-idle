// Account registration & login with scrypt password hashing and opaque session tokens.
import crypto from 'node:crypto';

const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

export function validateUsername(name) {
  if (typeof name !== 'string') return 'Username required';
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return 'Username must be 3-16 characters: letters, numbers, underscore';
  return null;
}
export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 6 || pw.length > 128) return 'Password must be 6-128 characters';
  return null;
}

function hashPassword(pw, salt) {
  return crypto.scryptSync(pw, salt, 64).toString('hex');
}

export function createAccount(store, username, password) {
  const err = validateUsername(username) || validatePassword(password);
  if (err) throw new Error(err);
  if (store.getAccount(username)) throw new Error('Username already taken');
  const salt = crypto.randomBytes(16).toString('hex');
  const acc = {
    id: crypto.randomBytes(8).toString('hex'),
    username, salt, hash: hashPassword(password, salt), createdAt: Date.now(), tokens: [],
  };
  store.setAccount(acc);
  return acc;
}

export function verifyLogin(store, username, password) {
  const acc = typeof username === 'string' ? store.getAccount(username) : null;
  if (!acc || typeof password !== 'string') throw new Error('Invalid username or password');
  const h = hashPassword(password, acc.salt);
  if (!crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(acc.hash, 'hex'))) throw new Error('Invalid username or password');
  return acc;
}

export function issueToken(store, acc) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  acc.tokens = (acc.tokens || []).filter(t => t.exp > now).slice(-9);
  acc.tokens.push({ h: sha(token), exp: now + TOKEN_TTL_MS });
  store.setAccount(acc);
  return `${acc.id}.${token}`;
}

export function accountFromToken(store, raw) {
  if (typeof raw !== 'string' || !raw.includes('.')) return null;
  const [id, token] = raw.split('.');
  const acc = store.findAccountById(id);
  if (!acc) return null;
  const h = sha(token);
  const now = Date.now();
  return acc.tokens?.some(t => t.h === h && t.exp > now) ? acc : null;
}

export function revokeToken(store, raw) {
  const acc = accountFromToken(store, raw);
  if (!acc) return;
  const h = sha(raw.split('.')[1]);
  acc.tokens = acc.tokens.filter(t => t.h !== h);
  store.setAccount(acc);
}

// Tiny fixed-window rate limiter
export class RateLimiter {
  constructor(limit, windowMs) { this.limit = limit; this.windowMs = windowMs; this.hits = new Map(); }
  allow(key) {
    const now = Date.now();
    const e = this.hits.get(key);
    if (!e || now - e.start > this.windowMs) { this.hits.set(key, { start: now, n: 1 }); return true; }
    e.n++;
    return e.n <= this.limit;
  }
}

export function setPassword(store, acc, password) {
  const err = validatePassword(password);
  if (err) throw new Error(err);
  acc.salt = crypto.randomBytes(16).toString('hex');
  acc.hash = hashPassword(password, acc.salt);
  acc.tokens = [];
  store.setAccount(acc);
}
