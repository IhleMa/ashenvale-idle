// Generates ASSETS.md (every image name the game looks for, ✅/⬜) and ASSETS_MISSING.md (only the missing ones).
// Usage: npm run assets        (add -- --missing to also print the missing files)
// On a hosted server without a shell, use the console command "assets" or Admin → 🖼 Assets instead.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AssetIndex } from '../server/assets.js';
import { assetReport, checklistMarkdown, missingMarkdown } from '../server/asset-report.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = assetReport(new AssetIndex(path.join(ROOT, 'public', 'assets')).get());
fs.writeFileSync(path.join(ROOT, 'ASSETS.md'), checklistMarkdown(r));
fs.writeFileSync(path.join(ROOT, 'ASSETS_MISSING.md'), missingMarkdown(r));
console.log(`ASSETS.md written: ${r.found}/${r.total} images present.`);
console.log(`ASSETS_MISSING.md written: ${r.missing} missing (${r.missingRecommended} recommended, ${r.missing - r.missingRecommended} optional).`);
if (process.argv.includes('--missing')) for (const s of r.sections) {
  const miss = s.entries.filter(e => !e.ok);
  if (miss.length) console.log(`\n${s.title} (${miss.length}):\n` + miss.map(e => '  ' + e.file).join('\n'));
}
