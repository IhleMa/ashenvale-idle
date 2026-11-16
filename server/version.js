// Build id of the browser-facing code (public/ + shared/, excluding art).
// Clients compare it on (re)connect and reload themselves when it changes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function computeBuildId(root) {
  const h = crypto.createHash('sha1');
  const walk = dir => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (full !== path.join(root, 'public', 'assets')) walk(full); continue; }
      const st = fs.statSync(full);
      h.update(`${path.relative(root, full)}:${st.size}:${Math.floor(st.mtimeMs)}\n`);
    }
  };
  walk(path.join(root, 'public'));
  walk(path.join(root, 'shared'));
  return h.digest('hex').slice(0, 12);
}
