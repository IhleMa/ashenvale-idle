// Generates ASSETS.md: every image file name the game looks for, and whether it already exists.
// Usage: npm run assets
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLASSES } from '../shared/data/classes.js';
import { ABILITIES } from '../shared/data/abilities.js';
import { STATUSES } from '../shared/data/statuses.js';
import { ENEMIES } from '../shared/data/enemies.js';
import { ITEM_BASES, SLOTS } from '../shared/data/items.js';
import { ZONES, COOP_ENCOUNTERS } from '../shared/data/zones.js';
import { ACHIEVEMENTS } from '../shared/data/achievements.js';
import { CONFIG } from '../shared/config.js';
import { AssetIndex } from '../server/assets.js';
import { BUILDINGS, MATERIALS, PROFESSIONS, ELIXIRS } from '../shared/data/town.js';
import { EXPEDITIONS } from '../shared/data/expeditions.js';
import { UNIQUES, SETS } from '../shared/data/legendaries.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = new AssetIndex(path.join(ROOT, 'public', 'assets')).get();
let total = 0, found = 0;

const section = (title, folder, entries, note = '') => {
  const rows = entries.map(([id, name]) => {
    total++;
    const ok = !!index[`${folder}/${id}`];
    if (ok) found++;
    return `| ${ok ? '✅' : '⬜'} | \`${folder}/${id}.png\` | ${name} |`;
  });
  return `\n## ${title}\n${note ? note + '\n' : ''}\n| | File | Used for |\n|---|---|---|\n${rows.join('\n')}\n`;
};

let md = '';
md += section('Class icons', 'classes', Object.entries(CLASSES).map(([id, c]) => [id, `${c.name} class icon (also the fallback portrait)`]),
  'Square images. Shown on class selection, badges and as the default portrait for that class.');
md += section('Default portraits', 'portraits', Object.entries(CLASSES).map(([id, c]) => [id, `Default ${c.name} portrait`]),
  `Optional. Add **extra appearance options** by naming files \`portraits/<class>_<anything>.png\`, e.g. \`portraits/warrior_1.png\`, \`portraits/mage_female.png\`.
They automatically appear as appearance choices during hero creation and are randomly assigned to recruits of that class.`);
md += section('Abilities', 'abilities', Object.values(ABILITIES).filter(a => a.classId !== 'enemy').map(a => [a.id, `${a.name} (${CLASSES[a.classId].name})`]),
  'Square icons (64–128 px recommended).');
md += section('Enemy abilities (optional)', 'abilities', Object.values(ABILITIES).filter(a => a.classId === 'enemy').map(a => [a.id, a.name]));
md += section('Item bases', 'items', Object.entries(ITEM_BASES).map(([id, b]) => [id, `${b.name} (${SLOTS[b.slot].label})`]),
  `Square icons. You can also add a rarity-specific version: \`items/<base>_<rarity>.png\` (rarities: ${CONFIG.rarities.map(r => r.id).join(', ')}), e.g. \`items/sword_legendary.png\`.`);
md += section('Unique items', 'items', Object.values(UNIQUES).map(u => [`unique_${u.id}`, `${u.name} (falls back to items/${u.baseId})`]), 'Optional special art for each unique item.');
md += section('Set pieces', 'items', Object.values(SETS).flatMap(st => Object.entries(st.pieces).map(([b, nm]) => [`set_${st.id}_${b}`, `${nm} — ${st.name}`])), 'Optional art per set piece. Fallback order: items/set_<set>_<base> → items/set_<set> → items/<base>.');
md += section('Empty equipment slots (optional)', 'items', Object.entries(SLOTS).map(([id, s]) => [`slot_${id}`, `${s.label} slot placeholder / generic fallback`]));
md += section('Enemies & bosses', 'enemies', Object.values(ENEMIES).map(e => [e.id, `${e.name}${e.boss ? ' (boss)' : ''}`]),
  'Square or portrait images; shown in circles in combat.');
md += section('Status effects', 'statuses', Object.entries(STATUSES).map(([id, s]) => [id, `${s.name} (${s.type})`]), 'Small icons (32–64 px).');
md += section('Zone backgrounds', 'zones', [...Object.values(ZONES).map(z => [z.id, `${z.name} combat background`]), ['coop', 'Fallback background for co-op fights']],
  'Wide images (e.g. 1920×1080). Darkened automatically so units stay readable.');
md += section('Co-op encounter art', 'encounters', Object.values(COOP_ENCOUNTERS).map(e => [e.id, e.name]), 'Wide images used as encounter card and combat background.');
md += section('Achievements', 'achievements', Object.values(ACHIEVEMENTS).map(a => [a.id, a.name]));
md += section('Skill tree nodes (optional)', 'skilltree', [['keystone', 'Keystone node icon'], ['notable', 'Notable node icon'], ['rank', 'Ability-rank node icon (falls back to the ability icon)']],
  'Ability nodes use the ability icons above. Small attribute nodes are drawn as plain dots.');
md += section('Town buildings', 'buildings', Object.entries(BUILDINGS).map(([id, b]) => [id, b.name]), 'Square or slightly wide images shown on the Town page.');
md += section('Materials', 'materials', Object.entries(MATERIALS).map(([id, m]) => [id, m.name]), 'Small square icons (64 px).');
md += section('Professions', 'professions', Object.entries(PROFESSIONS).map(([id, p]) => [id, p.name]), 'Small square icons.');
md += section('Elixirs', 'elixirs', Object.entries(ELIXIRS).map(([id, e]) => [id, e.name]), 'Small square icons.');
md += section('Expedition destinations', 'expeditions', Object.entries(EXPEDITIONS).map(([id, e]) => [id, e.name]), 'Wide or square images; also used as the background of the expedition planner.');
md += section('Interface', 'ui', [['logo', 'Game logo (top bar & login screen)'], ['background', 'Full-page background image']]);

const header = `# Asset checklist

Generated by \`npm run assets\` — **${found} of ${total}** images provided.

Drop image files into \`public/assets/<folder>/\` using the names below. Supported formats: **.png, .webp, .jpg, .jpeg, .gif, .svg, .avif**
(the \`.png\` in the table is just an example — any supported extension works). Names are case-insensitive.
Anything missing simply shows a generated placeholder, so you can add art gradually. After adding files, refresh the browser
(or use *Progression → Reload artwork*); no server restart is needed.

Want to use a different file name or folder? Map it in \`public/assets/manifest.json\`, e.g. \`{ "enemies/wolf": "packs/forest/wolf_final.webp" }\`.
`;
fs.writeFileSync(path.join(ROOT, 'ASSETS.md'), header + md);
console.log(`ASSETS.md written: ${found}/${total} images present.`);
