// Which images the game looks for and which of them exist. Used by "npm run assets" (writes ASSETS.md and
// ASSETS_MISSING.md), the "assets" console command and Admin → 🖼 Assets.
import { GEM_KINDS } from '../shared/gems.js';
import { CLASSES } from '../shared/data/classes.js';
import { ABILITIES } from '../shared/data/abilities.js';
import { STATUSES } from '../shared/data/statuses.js';
import { ENEMIES } from '../shared/data/enemies.js';
import { ITEM_BASES, SLOTS } from '../shared/data/items.js';
import { ZONES, COOP_ENCOUNTERS } from '../shared/data/zones.js';
import { ACHIEVEMENTS } from '../shared/data/achievements.js';
import { CONFIG } from '../shared/config.js';
import { BUILDINGS, MATERIALS, PROFESSIONS, ELIXIRS } from '../shared/data/town.js';
import { EXPEDITIONS } from '../shared/data/expeditions.js';
import { UNIQUES, SETS } from '../shared/data/legendaries.js';
import { MINIONS } from '../shared/data/minions.js';
import { SUBCLASSES } from '../shared/data/subclasses.js';


// Every image the game looks for, in sections: [{ title, folder, note, optional, entries: [{ key, file, name }] }]
export function assetSections() {
  const sections = [];
  const S = (title, folder, list, note = '') => sections.push({ title, folder, note, optional: /optional/i.test(title), entries: list.map(([id, name]) => ({ key: `${folder}/${id}`, file: `${folder}/${id}.png`, name })) });
S('Class icons', 'classes', Object.entries(CLASSES).map(([id, c]) => [id, `${c.name} class icon (also the fallback portrait)`]),
  'Square images. Shown on class selection, badges and as the default portrait for that class.');
S('Default portraits (optional)', 'portraits', Object.entries(CLASSES).map(([id, c]) => [id, `Default ${c.name} portrait`]),
  `Optional. Add **extra appearance options** by naming files \`portraits/<class>_<anything>.png\`, e.g. \`portraits/warrior_1.png\`, \`portraits/mage_female.png\`.
They automatically appear as appearance choices during hero creation and are randomly assigned to recruits of that class.`);
const owner = a => (a.subclass ? `${SUBCLASSES[a.subclass]?.name || a.subclass} — ${CLASSES[a.classId]?.name} subclass` : CLASSES[a.classId]?.name || a.classId);
S('Abilities', 'abilities', Object.values(ABILITIES).filter(a => CLASSES[a.classId]).sort((x, y) => (x.subclass ? 1 : 0) - (y.subclass ? 1 : 0)).map(a => [a.id, `${a.name} (${owner(a)})`]),
  'Square icons (64–128 px recommended). Subclass abilities (ascension) are listed after the class abilities.');
S('Minions (Summoner)', 'minions', Object.entries(MINIONS).map(([id, m]) => [id, `${m.name} (summoned minion)`]), 'Square or portrait images; shown in small circles under their summoner. Without art they show their glyph.');
S('Minion abilities (optional)', 'abilities', Object.values(ABILITIES).filter(a => a.classId === 'minion').map(a => [a.id, a.name]));
S('Enemy abilities (optional)', 'abilities', Object.values(ABILITIES).filter(a => a.classId === 'enemy').map(a => [a.id, a.name]));
S('Item bases', 'items', Object.entries(ITEM_BASES).map(([id, b]) => [id, `${b.name} (${SLOTS[b.slot].label})`]),
  `Square icons. You can also add a rarity-specific version: \`items/<base>_<rarity>.png\` (rarities: ${CONFIG.rarities.map(r => r.id).join(', ')}), e.g. \`items/sword_legendary.png\`.`);
S('Unique items (optional)', 'items', Object.values(UNIQUES).map(u => [`unique_${u.id}`, `${u.name} (falls back to items/${u.baseId})`]), 'Optional special art for each unique item.');
S('Set pieces (optional)', 'items', Object.values(SETS).flatMap(st => Object.entries(st.pieces).map(([b, nm]) => [`set_${st.id}_${b}`, `${nm} — ${st.name}`])), 'Optional art per set piece. Fallback order: items/set_<set>_<base> → items/set_<set> → items/<base>.');
S('Empty equipment slots (optional)', 'items', Object.entries(SLOTS).map(([id, s]) => [`slot_${id}`, `${s.label} slot placeholder / generic fallback`]));
S('Enemies & bosses', 'enemies', Object.values(ENEMIES).map(e => [e.id, `${e.name}${e.boss ? ' (boss)' : ''}`]),
  'Square or portrait images; shown in circles in combat.');
S('Status effects', 'statuses', Object.entries(STATUSES).map(([id, s]) => [id, `${s.name} (${s.type})`]), 'Small icons (32–64 px).');
S('Zone backgrounds', 'zones', [...Object.values(ZONES).map(z => [z.id, `${z.name} combat background`]), ['coop', 'Fallback background for co-op fights']],
  'Wide images (e.g. 1920×1080). Darkened automatically so units stay readable.');
S('Co-op encounter art', 'encounters', Object.values(COOP_ENCOUNTERS).map(e => [e.id, e.name]), 'Wide images used as encounter card and combat background.');
S('Achievements', 'achievements', Object.values(ACHIEVEMENTS).map(a => [a.id, a.name]));
S('Skill tree nodes (optional)', 'skilltree', [['keystone', 'Keystone node icon'], ['notable', 'Notable node icon'], ['mutator', 'Ability-mutator node icon (subclass branches)'], ['rank', 'Ability-rank node icon (falls back to the ability icon)']],
  'Ability nodes use the ability icons above. Small attribute nodes are drawn as plain dots.');
S('Town buildings', 'buildings', Object.entries(BUILDINGS).map(([id, b]) => [id, b.name]), 'Square or slightly wide images shown on the Town page.');
S('Materials', 'materials', Object.entries(MATERIALS).map(([id, m]) => [id, m.name]), 'Small square icons (64 px).');
S('Professions', 'professions', Object.entries(PROFESSIONS).map(([id, p]) => [id, p.name]), 'Small square icons.');
S('Gems', 'gems', Object.entries(GEM_KINDS).map(([id, g]) => [id, `${g.name} (optional per tier: ${id}_1 … ${id}_5)`]), 'Small square icons (64 px). One image per stat is enough; add <stat>_<tier> for tier-specific art.');
S('Elixirs', 'elixirs', Object.entries(ELIXIRS).map(([id, e]) => [id, e.name]), 'Small square icons.');
S('Expedition destinations', 'expeditions', Object.entries(EXPEDITIONS).map(([id, e]) => [id, e.name]), 'Wide or square images; also used as the background of the expedition planner.');
S('Interface', 'ui', [['logo', 'Game logo (top bar & login screen)'], ['background', 'Full-page background image']]);

  return sections;
}

// Compare with an asset index ({ "classes/mage": "/assets/classes/mage.png", … }) → sections with ok flags + totals
export function assetReport(index) {
  const sections = assetSections().map(s => ({ ...s, entries: s.entries.map(e => ({ ...e, ok: !!index[e.key.toLowerCase()] })) }));
  const all = sections.flatMap(s => s.entries.map(e => ({ ...e, optional: s.optional })));
  return {
    sections,
    total: all.length,
    found: all.filter(e => e.ok).length,
    missing: all.filter(e => !e.ok).length,
    missingRecommended: all.filter(e => !e.ok && !e.optional).length,
  };
}

const anchor = t => t.toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/ /g, '-');

export function checklistMarkdown(r) {
  const header = `# Asset checklist

Generated by \`npm run assets\` — **${r.found} of ${r.total}** images provided. Only what's missing: [ASSETS_MISSING.md](ASSETS_MISSING.md).

Drop image files into \`public/assets/<folder>/\` using the names below. Supported formats: **.png, .webp, .jpg, .jpeg, .gif, .svg, .avif**
(the \`.png\` in the table is just an example — any supported extension works). Names are case-insensitive.
Anything missing simply shows a generated placeholder, so you can add art gradually. After adding files, refresh the browser
(or use *Progression → Reload artwork*); no server restart is needed. On a hosted server, Admin → 🖼 Assets or the console command
\`assets\` shows the same list for the files actually on the server.

Want to use a different file name or folder? Map it in \`public/assets/manifest.json\`, e.g. \`{ "enemies/wolf": "packs/forest/wolf_final.webp" }\`.
`;
  return header + r.sections.map(s => `\n## ${s.title}\n${s.note ? s.note + '\n' : ''}\n| | File | Used for |\n|---|---|---|\n${s.entries.map(e => `| ${e.ok ? '✅' : '⬜'} | \`${e.file}\` | ${e.name} |`).join('\n')}\n`).join('');
}

export function missingMarkdown(r) {
  const secs = r.sections.map(s => ({ ...s, entries: s.entries.filter(e => !e.ok) })).filter(s => s.entries.length).sort((a, b) => a.optional - b.optional);
  let md = `# Missing assets

**${r.missing} of ${r.total}** images still missing (${r.missingRecommended} recommended, ${r.missing - r.missingRecommended} optional).
Only the missing files are listed; see [ASSETS.md](ASSETS.md) for everything, sizes and naming rules. Drop files into \`public/assets/<folder>/\`
(any of .png, .webp, .jpg, .jpeg, .gif, .svg, .avif).
`;
  if (!secs.length) return md + '\n🎉 Nothing missing — every image the game looks for is there.\n';
  md += '\n| Section | Missing |\n|---|---|\n' + secs.map(s => `| [${s.title}](#${anchor(s.title)}) | ${s.entries.length} |`).join('\n') + '\n';
  for (const s of secs) md += `\n## ${s.title}\n\n${s.entries.map(e => `- [ ] \`${e.file}\` — ${e.name}`).join('\n')}\n`;
  return md;
}
