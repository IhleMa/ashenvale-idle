// Auction house: player-to-player trading of items and materials for gold (server-authoritative).
import crypto from 'node:crypto';
import { CONFIG, rarityIndex } from '../shared/config.js';
import { MATERIALS } from '../shared/data/town.js';
import { SLOTS, canEquip, isSoulbound } from '../shared/data/items.js';
import { UNIQUES, SETS, migrateLegacyItem } from '../shared/data/legendaries.js';
import { parseGemKey } from '../shared/gems.js';
import { GameError, sendMail } from './playerLogic.js';

const fail = m => { throw new GameError(m); };
const DURATIONS = [12, 24, 48];
const MAX_PRICE = 100_000_000;

export function priceKey(l) {
  if (l.kind === 'material') return `mat:${l.material}`;
  const it = l.item;
  if (it.unique) return `unique:${it.unique}`;
  if (it.set) return `set:${it.set}:${it.baseId}`;
  return `${it.baseId}:${it.rarity}`;
}

export class AuctionHouse {
  constructor(game) {
    this.game = game;
    this.data = { listings: [], history: [], ...game.store.getDoc('auction', {}) };
    this.dirty = false;
    for (const l of this.data.listings) if (l.item && migrateLegacyItem(l.item)) this.dirty = true; // tiered affixes
    for (const l of this.data.listings) if (l.item?.sockets?.some(g => g && !parseGemKey(g))) { l.item.sockets = l.item.sockets.map(g => (g && parseGemKey(g) ? g : null)); this.dirty = true; } // old stat gems
  }

  // queues the auction house for the next database flush (written together with the players involved)
  save() {
    if (!this.dirty) return;
    this.game.store.putDoc('auction', this.data);
    this.dirty = false;
  }

  player(id) { return this.game.sessions.get(id)?.player || this.game.store.loadPlayer(id); }
  touch(p) {
    this.game.store.savePlayerSoon(p);
    const s = this.game.sessions.get(p.id);
    if (s) s.stateDirty = true;
  }

  avgPrice(key) {
    const recent = this.data.history.filter(h => h.key === key).slice(-20);
    if (!recent.length) return null;
    return Math.round(recent.reduce((a, h) => a + h.unit, 0) / recent.length);
  }

  publicListing(l, me) {
    return { ...l, mine: l.sellerId === me, avg: this.avgPrice(priceKey(l)), unitPrice: l.kind === 'material' ? Math.round(l.price / l.qty) : l.price };
  }

  // ---------------------------------------------------------------- browse
  search(p, q = {}) {
    const now = Date.now();
    let list = this.data.listings.filter(l => l.expiresAt > now);
    const kind = q.kind === 'materials' ? 'material' : q.kind === 'items' ? 'item' : null;
    if (kind) list = list.filter(l => l.kind === kind);
    const text = String(q.query || '').trim().toLowerCase().slice(0, 40);
    if (text) list = list.filter(l => (l.kind === 'material' ? MATERIALS[l.material]?.name : l.item.name).toLowerCase().includes(text) || l.sellerName.toLowerCase().includes(text));
    if (q.slot && SLOTS[q.slot]) list = list.filter(l => l.kind === 'item' && l.item.slot === q.slot);
    if (q.rarity === 'special') list = list.filter(l => l.kind === 'item' && (l.item.unique || l.item.set));
    else if (q.rarity) list = list.filter(l => l.kind === 'item' && rarityIndex(l.item.rarity) >= rarityIndex(q.rarity));
    if (q.usableBy && p.characters[q.usableBy]) { const ch = p.characters[q.usableBy]; list = list.filter(l => l.kind === 'item' && canEquip(l.item, ch)); }
    const minL = Number(q.minLevel) || 0, maxL = Number(q.maxLevel) || 999;
    if (minL || maxL < 999) list = list.filter(l => l.kind !== 'item' || (l.item.level >= minL && l.item.level <= maxL));
    if (q.material && MATERIALS[q.material]) list = list.filter(l => l.material === q.material);
    const unit = l => (l.kind === 'material' ? l.price / l.qty : l.price);
    const sorts = {
      price: (a, b) => unit(a) - unit(b), priceDesc: (a, b) => unit(b) - unit(a),
      level: (a, b) => (b.item?.level || 0) - (a.item?.level || 0), ending: (a, b) => a.expiresAt - b.expiresAt, newest: (a, b) => b.createdAt - a.createdAt,
    };
    list.sort(sorts[q.sort] || sorts.newest);
    const pageSize = 30;
    const page = Math.max(0, Math.floor(Number(q.page) || 0));
    return { total: list.length, page, pageSize, rows: list.slice(page * pageSize, page * pageSize + pageSize).map(l => this.publicListing(l, p.id)) };
  }

  mine(p) {
    return this.data.listings.filter(l => l.sellerId === p.id).sort((a, b) => a.expiresAt - b.expiresAt).map(l => this.publicListing(l, p.id));
  }

  // ---------------------------------------------------------------- sell
  list(p, { itemUid, material, qty, price, hours }) {
    const s = this.game.settings;
    price = Math.floor(Number(price));
    hours = Number(hours);
    if (!(price >= 1 && price <= MAX_PRICE)) fail('Enter a price between 1 and 100,000,000 gold');
    if (!DURATIONS.includes(hours)) fail('Invalid duration');
    if (this.data.listings.filter(l => l.sellerId === p.id).length >= s.get('auctionMaxListings')) fail(`You can have at most ${s.get('auctionMaxListings')} auctions at once`);
    const fee = Math.max(1, Math.round(price * s.get('auctionFeePct') / 100));
    if (p.gold < fee) fail(`The listing fee is ${fee} gold`);
    const now = Date.now();
    const l = { id: crypto.randomBytes(6).toString('hex'), sellerId: p.id, sellerName: p.name, price, createdAt: now, expiresAt: now + hours * 3600000 };
    if (itemUid) {
      const idx = p.inventory.findIndex(i => i.uid === itemUid);
      if (idx < 0) fail('Item not found in your inventory (unequip it first)');
      if (p.inventory[idx].locked) fail('Unlock the item first');
      if (isSoulbound(p.inventory[idx])) fail('Soulbound: this item was scaled down by ascension. Reforge it back to its original item level to trade it again.');
      l.kind = 'item';
      l.item = p.inventory.splice(idx, 1)[0];
    } else {
      if (!MATERIALS[material]) fail('Unknown material');
      qty = Math.floor(Number(qty));
      const have = Math.floor(p.town?.materials?.[material] || 0);
      if (!(qty >= 1 && qty <= have)) fail(`You have ${have} ${MATERIALS[material].name}`);
      p.town.materials[material] -= qty;
      l.kind = 'material';
      l.material = material;
      l.qty = qty;
    }
    p.gold -= fee;
    this.data.listings.push(l);
    this.dirty = true;
    return { listing: l, fee };
  }

  cancel(p, { id }) {
    const idx = this.data.listings.findIndex(l => l.id === id);
    if (idx < 0) fail('Auction not found');
    const l = this.data.listings[idx];
    if (l.sellerId !== p.id) fail('That is not your auction');
    this.data.listings.splice(idx, 1);
    this.dirty = true;
    this.returnToSeller(p, l, 'Auction cancelled');
  }

  returnToSeller(p, l, note) {
    if (l.kind === 'item') {
      if (p.inventory.length < CONFIG.inventory.limit) p.inventory.push(l.item);
      else sendMail(p, { item: l.item, from: 'Auction House', note });
    } else {
      p.town.materials[l.material] = (p.town.materials[l.material] || 0) + l.qty;
    }
  }

  // ---------------------------------------------------------------- buy
  buy(p, { id }) {
    const idx = this.data.listings.findIndex(l => l.id === id);
    if (idx < 0) fail('This auction is no longer available');
    const l = this.data.listings[idx];
    if (l.expiresAt <= Date.now()) fail('This auction has expired');
    if (l.sellerId === p.id) fail("You can't buy your own auction");
    if (p.gold < l.price) fail(`You need ${l.price} gold`);
    if (l.kind === 'item' && p.inventory.length >= CONFIG.inventory.limit) fail('Your inventory is full');
    const seller = this.player(l.sellerId);
    this.data.listings.splice(idx, 1);
    p.gold -= l.price;
    if (l.kind === 'item') p.inventory.push(l.item);
    else { p.town.materials[l.material] = (p.town.materials[l.material] || 0) + l.qty; }
    const tax = Math.floor(l.price * this.game.settings.get('auctionTaxPct') / 100);
    const what = l.kind === 'item' ? l.item.name : `${l.qty}× ${MATERIALS[l.material].name}`;
    if (seller) {
      sendMail(seller, { gold: l.price - tax, from: 'Auction House', note: `Sold ${what} to ${p.name} for ${l.price} gold${tax ? ` (−${tax} tax)` : ''}.` });
      seller.stats.auctionSales = (seller.stats.auctionSales || 0) + 1;
      this.touch(seller);
      this.game.toast(seller.id, `💰 Your ${what} sold for ${l.price} gold — collect it in the Auction House mailbox.`, 'success');
    }
    this.data.history.push({ key: priceKey(l), unit: l.kind === 'material' ? l.price / l.qty : l.price, at: Date.now() });
    if (this.data.history.length > 1000) this.data.history.splice(0, this.data.history.length - 1000);
    this.dirty = true;
    return { what };
  }

  // ---------------------------------------------------------------- maintenance
  sweepExpired() {
    const now = Date.now();
    const expired = this.data.listings.filter(l => l.expiresAt <= now);
    if (!expired.length) return;
    this.data.listings = this.data.listings.filter(l => l.expiresAt > now);
    for (const l of expired) {
      const seller = this.player(l.sellerId);
      if (!seller) continue;
      if (l.kind === 'item') sendMail(seller, { item: l.item, from: 'Auction House', note: `Your auction for ${l.item.name} expired.` });
      else sendMail(seller, { materials: { [l.material]: l.qty }, from: 'Auction House', note: `Your auction for ${l.qty}× ${MATERIALS[l.material].name} expired.` });
      this.touch(seller);
    }
    this.dirty = true;
  }

  removeSeller(playerId) {
    const before = this.data.listings.length;
    this.data.listings = this.data.listings.filter(l => l.sellerId !== playerId);
    if (this.data.listings.length !== before) this.dirty = true;
  }

  stats() {
    return { listings: this.data.listings.length, sales24h: this.data.history.filter(h => h.at > Date.now() - 86400000).length };
  }
}

export { UNIQUES, SETS };
