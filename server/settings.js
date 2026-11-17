// Runtime server settings (editable on the admin page, stored in the database).

export const SETTING_DEFS = {
  xpRate:            { label: 'XP rate', type: 'number', min: 0.1, max: 10, step: 0.1, default: 1 },
  goldRate:          { label: 'Gold rate', type: 'number', min: 0.1, max: 10, step: 0.1, default: 1 },
  lootRate:          { label: 'Loot drop rate', type: 'number', min: 0.1, max: 10, step: 0.1, default: 1 },
  offlineMaxHours:   { label: 'Offline progress cap (hours)', type: 'number', min: 0, max: 48, step: 1, default: 8 },
  auctionFeePct:     { label: 'Auction listing fee (%)', type: 'number', min: 0, max: 50, step: 0.5, default: 2 },
  auctionTaxPct:     { label: 'Auction sales tax (%)', type: 'number', min: 0, max: 50, step: 0.5, default: 5 },
  auctionMaxListings:{ label: 'Max auction listings per player', type: 'number', min: 1, max: 100, step: 1, default: 20 },
  premiumMinutesPerCrystal: { label: 'Minutes skipped per Ashen Crystal 💠', type: 'number', min: 1, max: 240, step: 1, default: 10 },
  registrationOpen:  { label: 'Allow new registrations', type: 'boolean', default: true },
  motd:              { label: 'Message of the day (shown on login)', type: 'text', default: '' },
};

export class Settings {
  constructor(store, envDefaults = {}) {
    this.store = store;
    this.values = Object.fromEntries(Object.entries(SETTING_DEFS).map(([k, d]) => [k, d.default]));
    Object.assign(this.values, envDefaults);
    Object.assign(this.values, store.getDoc('settings', {}));
  }
  get(k) { return this.values[k]; }
  set(changes) {
    for (const [k, v] of Object.entries(changes || {})) {
      const d = SETTING_DEFS[k];
      if (!d) continue;
      if (d.type === 'number') { const n = Number(v); if (Number.isFinite(n)) this.values[k] = Math.min(d.max, Math.max(d.min, n)); }
      else if (d.type === 'boolean') this.values[k] = !!v;
      else this.values[k] = String(v ?? '').slice(0, 500);
    }
    this.save();
  }
  save() { this.store.putDoc('settings', this.values); this.store.flush(); }
}
