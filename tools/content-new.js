// Creates a new content entry by copying an existing one.
//   npm run content:new -- <type> <newId> <copyFromId>
// Examples:
//   npm run content:new -- ability shadow_strike backstab
//   npm run content:new -- item war_scythe axe
//   npm run content:new -- enemy cave_bat wolf
// Types: class, trait, ability, status, item, enemy, zone, coop, unique, set, skilltree, material, profession,
//        building, quality, elixir, expedition, achievement, quest, affix, gem, lootpreset, bot
import fs from 'node:fs';
import path from 'node:path';
import { CONTENT } from '../shared/content.js';
import { pretty } from './jsonfmt.js';
import { ROOT } from '../server/content-loader.js';

const TYPES = {
  class: 'classes.classes', trait: 'classes.traits', ability: 'abilities.abilities', status: 'statuses.statuses', item: 'items.bases',
  enemy: 'enemies.enemies', zone: 'zones.zones', coop: 'zones.coopEncounters', unique: 'legendaries.uniques', set: 'legendaries.sets',
  skilltree: 'skilltree.specs', material: 'town.materials', profession: 'town.professions', building: 'town.buildings', quality: 'town.qualities',
  elixir: 'town.elixirs', expedition: 'expeditions.expeditions', achievement: 'achievements.achievements', quest: 'quests.types',
  affix: 'rifts.affixes', gem: 'gems.kinds', lootpreset: 'lootfilter.presets', bot: 'bots.archetypes',
};
const [type, newId, fromId] = process.argv.slice(2);
const coll = TYPES[type];
if (!coll || !newId || !fromId) {
  console.log('Usage: npm run content:new -- <type> <newId> <copyFromId>\nTypes: ' + Object.keys(TYPES).join(', '));
  process.exit(1);
}
if (!/^[a-z0-9_]+$/.test(newId)) { console.log('The id may only contain lowercase letters, digits and _'); process.exit(1); }
const [system, key] = coll.split('.');
const files = CONTENT._meta.files;
const src = files[`${coll}.${fromId}`];
if (!src) { console.log(`No ${type} "${fromId}". Existing: ${Object.keys(CONTENT[system][key]).join(', ')}`); process.exit(1); }
if (CONTENT[system][key][newId]) { console.log(`"${newId}" already exists (${files[`${coll}.${newId}`]})`); process.exit(1); }
const srcPath = path.isAbsolute(src) ? src : path.join(ROOT, src);
const target = path.join(path.dirname(srcPath), `${newId}.json`);
const data = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
if (typeof data.name === 'string') data.name = `${data.name} (copy)`;
delete data.order; // new entries go to the end of lists unless you give them an "order"
fs.writeFileSync(target, pretty(data) + '\n');
console.log(`Created ${path.relative(ROOT, target)} (copy of ${fromId}). Edit it, then run: npm run content:check`);
