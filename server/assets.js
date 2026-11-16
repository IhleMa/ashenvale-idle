// Scans public/assets for images so the client knows which artwork exists.
// Convention: public/assets/<category>/<id>.<png|jpg|jpeg|webp|gif|svg>
// Optional overrides: public/assets/manifest.json  { "items/sword": "my-folder/cool-sword.png" }
import fs from 'node:fs';
import path from 'node:path';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif']);
const EXT_PRIORITY = ['.webp', '.png', '.avif', '.jpg', '.jpeg', '.svg', '.gif'];

export class AssetIndex {
  constructor(assetsDir) {
    this.dir = assetsDir;
    this.cache = null;
    this.cachedAt = 0;
  }

  get() {
    if (this.cache && Date.now() - this.cachedAt < 5000) return this.cache;
    const index = {};
    const walk = (dir, rel) => {
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const full = path.join(dir, e.name);
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(full, r);
        else {
          const ext = path.extname(e.name).toLowerCase();
          if (!IMAGE_EXT.has(ext)) continue;
          const key = r.slice(0, -ext.length).toLowerCase();
          const prev = index[key];
          if (!prev || EXT_PRIORITY.indexOf(ext) < EXT_PRIORITY.indexOf(path.extname(prev))) index[key] = `/assets/${r}`;
        }
      }
    };
    walk(this.dir, '');
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(this.dir, 'manifest.json'), 'utf8'));
      for (const [key, file] of Object.entries(manifest)) {
        if (key.startsWith('_') || typeof file !== 'string') continue;
        if (/^https?:\/\//.test(file)) index[key.toLowerCase()] = file;
        else if (!file.includes('..')) index[key.toLowerCase()] = `/assets/${file.replace(/^\/+/, '')}`;
      }
    } catch { /* manifest is optional */ }
    this.cache = index;
    this.cachedAt = Date.now();
    return index;
  }
}
