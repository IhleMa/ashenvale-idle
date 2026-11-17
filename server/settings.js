// Runtime server settings (editable on the admin page, persisted in data/settings.json).
import fs from 'node:fs';
import path from 'node:path';

export const SETTING_DEFS = {
  xpRate:            { label: 'XP rate', type: 'number', min: 0.1, max: 10, step: 0.1, default: 1 },
  goldRate:          { label: 'Gold rate', type: 'number', min: 0.1, max: 10, step: 0.1, default: 1 },
  lootRate:          { label: 'Loot drop rate', type: 'number', min: 0.1, max: 10, step: 0.1, default: 1 },
  offlineMaxHours:   { label: 'Offline progress cap (hours)', type: 'number', min: 0, max: 48, step: 1, default: 8 },
  auctionFeePct:     { label: 'Auction listing fee (%)', type: 'number', min: 0, max: 50, step: 0.5, default: 2 },
  auctionTaxPct:     { label: 'Auction sales tax (%)', type: 'number', min: 0, max: 50, step: 0.5, default: 5 },
  auctionMaxListings:{ label: 'Max auction listings per player', type: 'number', min: 1, max: 100, step: 1, default: 20 },
  registrationOpen:  { label: 'Allow new registrations', type: 'boolean', default: true },
  motd:              { label: 'Message of the day (shown on login)', type: 'text', default: '' },
};

export class Settings {
  constructor(dataDir, envDefaults = {}) {
    this.file = path.join(dataDir, 'settings.json');
    this.values = Object.fromEntries(Object.entries(SETTING_DEFS).map(([k, d]) => [k, d.default]));
    Object.assign(this.values, envDefaults);
    try { Object.assign(this.values, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { /* first start */ }
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
  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.values, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
