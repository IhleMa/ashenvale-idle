// Checks the game content (content/*.json + overrides in data/content/) without starting the server.
// Usage: npm run content:check
const { CONTENT } = await import('../shared/content.js').catch(e => { console.error(`✘ ${e.message}`); process.exit(1); });
const { validateContent } = await import('../server/content-check.js');
const { errors, warnings } = validateContent(CONTENT);
for (const w of warnings) console.log(`! ${w}`);
for (const e of errors) console.log(`✘ ${e}`);
const counts = Object.entries({ classes: CONTENT.classes.classes, abilities: CONTENT.abilities.abilities, 'item bases': CONTENT.items.bases, enemies: CONTENT.enemies.enemies, zones: CONTENT.zones.zones, uniques: CONTENT.legendaries.uniques, sets: CONTENT.legendaries.sets })
  .map(([k, v]) => `${Object.keys(v).length} ${k}`).join(', ');
if (CONTENT._meta.overrides.length) console.log(`Overrides: ${CONTENT._meta.overrides.join(', ')} (${CONTENT._meta.overrideDir})`);
console.log(errors.length ? `\n${errors.length} error(s) — the server will not start until they are fixed.` : `\nContent OK: ${counts}.`);
process.exit(errors.length ? 1 : 0);
