// Tests the admin content editor backend: minimal overrides, create/remove/reset, validation + rollback,
// and that the running game sees changes immediately (live reload).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ashen-content-'));
process.env.DATA_DIR = dataDir;
const odir = path.join(dataDir, 'content');

const { CONTENT, replaceContent } = await import('../shared/content.js');
const { ContentManager, makeOverride } = await import('../server/content-admin.js');
const { ENEMIES } = await import('../shared/data/enemies.js');
const { ABILITIES } = await import('../shared/data/abilities.js');
const { ITEM_BASES } = await import('../shared/data/items.js');
const { CLASS_IDS } = await import('../shared/data/classes.js');
const { ZONES } = await import('../shared/data/zones.js');

let applied = 0;
const cm = new ContentManager({ apply: fresh => { applied++; replaceContent(fresh); }, usage: id => (id === 'heroic_strike' ? 3 : 0) });
const read = rel => JSON.parse(fs.readFileSync(path.join(odir, rel), 'utf8'));
const exists = rel => fs.existsSync(path.join(odir, rel));
let n = 0;
const ok = msg => console.log(`  ✔ ${msg}`, ++n && '');

// ---- makeOverride
assert.deepEqual(makeOverride({ a: 1, b: { c: 2, d: 3 } }, { a: 1, b: { c: 5, d: 3 } }), { b: { c: 5 } });
assert.deepEqual(makeOverride({ a: 1, b: 2 }, { a: 1 }), { b: null });
assert.deepEqual(makeOverride({ a: [1, 2] }, { a: [1, 3] }), { a: [1, 3] });
assert.deepEqual(makeOverride({ a: 1, n: null }, { a: 2, n: null }), { a: 2 });
assert.deepEqual(makeOverride({ a: 1, n: ['x'] }, { a: 1, n: null }), { $replace: true, a: 1, n: null });
assert.equal(typeof makeOverride({ a: 1 }, { a: 1 }), 'symbol');
ok('minimal overrides');

// ---- index / list / get
const idx = cm.index();
assert.ok(idx.types.find(t => t.id === 'enemies').count > 10);
assert.ok(cm.list('abilities').entries.find(e => e.id === 'heroic_strike' && e.group === 'warrior' && e.status === 'original'));
const firstEnemy = Object.keys(ENEMIES).find(id => ENEMIES[id].stats?.hp);
const g = cm.get('enemies', firstEnemy);
assert.equal(g.status, 'original');
assert.equal(g.data.stats.hp, ENEMIES[firstEnemy].stats.hp);
ok('index, list and get');

// ---- edit an original entry: only the difference is stored, the game sees it right away
const hp0 = g.data.stats.hp;
const edited = structuredClone(g.data);
edited.stats.hp = hp0 + 1234;
delete edited.enrageAfter;
const r1 = cm.save('enemies', firstEnemy, edited);
assert.equal(r1.entry.status, 'modified');
assert.deepEqual(read(`enemies/${firstEnemy}.json`), { stats: { hp: hp0 + 1234 }, ...(g.data.enrageAfter !== undefined ? { enrageAfter: null } : {}) });
assert.equal(ENEMIES[firstEnemy].stats.hp, hp0 + 1234, 'live reload updates the running data');
assert.equal(ENEMIES[firstEnemy].id, firstEnemy, 'ids survive the reload');
assert.ok(ENEMIES[firstEnemy].growth, 'derived defaults survive the reload');
assert.equal(applied, 1);
ok('edit original → minimal override, applied live');

// saving the original values again removes the override
cm.save('enemies', firstEnemy, g.data);
assert.ok(!exists(`enemies/${firstEnemy}.json`));
assert.equal(ENEMIES[firstEnemy].stats.hp, hp0);
assert.equal(cm.get('enemies', firstEnemy).status, 'original');
ok('saving the original again removes the override');

// ---- invalid changes are rejected and rolled back
const zoneId = Object.keys(ZONES)[0];
const z = cm.get('zones', zoneId).data;
assert.throws(() => cm.save('zones', zoneId, { ...z, enemies: ['no_such_enemy'] }), e => e.errors?.some(m => m.includes('no_such_enemy')));
assert.ok(!exists(`zones/${zoneId}.json`), 'rolled back');
assert.deepEqual(ZONES[zoneId].enemies, z.enemies);
// also when an override already existed
cm.save('zones', zoneId, { ...z, description: 'Changed' });
assert.throws(() => cm.save('zones', zoneId, { ...z, description: 'Changed', boss: 'nope' }));
assert.deepEqual(read(`zones/${zoneId}.json`), { description: 'Changed' });
assert.equal(ZONES[zoneId].description, 'Changed');
cm.reset('zones', zoneId);
assert.equal(ZONES[zoneId].description, z.description);
ok('invalid change rejected with errors and rolled back; reset');

// ---- create (copy), lives in the same subfolder as the original
const c1 = cm.create('abilities', 'mighty_strike', { from: 'heroic_strike' });
assert.equal(c1.entry.status, 'custom');
assert.ok(exists('abilities/warrior/mighty_strike.json'));
assert.ok(ABILITIES.mighty_strike && ABILITIES.mighty_strike.id === 'mighty_strike');
assert.match(ABILITIES.mighty_strike.name, /copy/);
assert.throws(() => cm.create('abilities', 'mighty_strike', { from: 'heroic_strike' }), /already exists/);
assert.throws(() => cm.create('abilities', 'Bad Id!'), /Ids may only/);
// edit the new entry: stored in full
cm.save('abilities', 'mighty_strike', { ...c1.entry.data, name: 'Mighty Strike' });
assert.equal(read('abilities/warrior/mighty_strike.json').name, 'Mighty Strike');
assert.equal(ABILITIES.mighty_strike.name, 'Mighty Strike');
// delete it: the file is gone
cm.delete('abilities', 'mighty_strike');
assert.ok(!exists('abilities/warrior/mighty_strike.json'));
assert.ok(!ABILITIES.mighty_strike);
ok('create from copy, edit, delete custom entry');

// ---- remove an original: needs confirmation when players use it; null file; restore
const d1 = cm.delete('abilities', 'heroic_strike');
assert.equal(d1.needsConfirm, true);
assert.equal(d1.usage, 3);
// the warrior class lists it, so removing it would break the content → rejected
assert.throws(() => cm.delete('abilities', 'heroic_strike', { force: true }), e => e.errors?.length > 0);
assert.ok(ABILITIES.heroic_strike);
const unusedBase = Object.keys(ITEM_BASES).find(id => !JSON.stringify(CONTENT.legendaries).includes(`"${id}"`) && !JSON.stringify(CONTENT.lootfilter).includes(`"${id}"`) && !JSON.stringify(CONTENT.bots).includes(`"${id}"`));
cm.delete('items', unusedBase);
assert.equal(JSON.parse(fs.readFileSync(cm.overrideFile(cm.type('items'), unusedBase), 'utf8')), null);
assert.ok(!ITEM_BASES[unusedBase]);
assert.equal(cm.get('items', unusedBase).status, 'removed');
cm.reset('items', unusedBase);
assert.ok(ITEM_BASES[unusedBase]);
ok('remove original (with usage check), restore');

// ---- null values: "classes": null can be set and unset
const ring = cm.get('items', 'ring').data;
assert.equal(ring.classes, null);
cm.save('items', 'ring', { ...ring, classes: ['warrior'] });
assert.deepEqual(ITEM_BASES.ring.classes, ['warrior']);
cm.save('items', 'ring', { ...ring, classes: null });
assert.equal(ITEM_BASES.ring.classes, null);
assert.ok(!exists('items/ring/ring.json'));
const herb = cm.get('town/professions', 'herbalism').data;
cm.save('town/professions', 'herbalism', { ...herb, name: 'Herbs' });
assert.equal(CONTENT.town.professions.herbalism.building, null);
assert.equal(CONTENT.town.professions.herbalism.name, 'Herbs');
cm.reset('town/professions', 'herbalism');
ok('null values');

// ---- settings
const cfg = cm.get('settings', 'config').data;
assert.ok(!('classes' in cm.get('settings', 'items').data) && !('bases' in cm.get('settings', 'items').data), 'collections are not part of settings');
const cost0 = CONTENT.config.treeResetCostPerLevel;
cm.save('settings', 'config', { ...cfg, treeResetCostPerLevel: cost0 + 5 });
assert.deepEqual(read('config.json'), { treeResetCostPerLevel: cost0 + 5 });
assert.equal(CONTENT.config.treeResetCostPerLevel, cost0 + 5);
cm.reset('settings', 'config');
assert.equal(CONTENT.config.treeResetCostPerLevel, cost0);
const itemsSettings = cm.get('settings', 'items').data;
cm.save('settings', 'items', { ...itemsSettings, pctStats: [...itemsSettings.pctStats] });
assert.ok(!exists('items/_settings.json'));
assert.ok(Object.keys(CONTENT.items.bases).length > 10, 'saving settings keeps the collections');
ok('settings');

// ---- XP curve (Admin → 📈 XP curve saves config.xp.curve)
{
  const { xpToNext } = await import('../shared/config.js');
  const f10 = xpToNext(10);
  const conf = cm.get('settings', 'config').data;
  cm.save('settings', 'config', { ...conf, xp: { ...conf.xp, curve: [[1, 100], [10, 1000], [59, 200000]] } });
  assert.equal(xpToNext(1), 100); assert.equal(xpToNext(10), 1000); assert.equal(xpToNext(59), 200000);
  assert.ok(xpToNext(5) > 100 && xpToNext(5) < 1000 && xpToNext(30) > 1000 && xpToNext(30) < 200000, 'smooth between the points');
  for (let L = 2; L < 59; L++) assert.ok(xpToNext(L) >= xpToNext(L - 1), `never drops (level ${L})`);
  assert.throws(() => cm.save('settings', 'config', { ...conf, xp: { ...conf.xp, curve: [[1, 100], [1, 50]] } }), e => e.errors?.some(m => m.includes('levels must increase')));
  assert.equal(xpToNext(10), 1000, 'invalid curve rejected, the old one stays');
  cm.reset('settings', 'config');
  assert.equal(xpToNext(10), f10, 'back to the formula');
  ok('XP curve: saved live, smooth and rising, invalid curves rejected, reset to the formula');
}

// ---- a class needs abilities and a skill tree: an empty one is rejected with a clear message …
assert.throws(() => cm.create('classes', 'paladin', { data: { name: 'Paladin' } }), e => e.errors?.some(m => m.includes('paladin.json')));
assert.ok(!exists('classes/paladin.json'));
// … and copying a class copies its abilities and skill tree along
const pal = cm.create('classes', 'paladin', { from: 'warrior' });
assert.ok(pal.created.includes('abilities/paladin_heroic_strike') && pal.created.includes('skilltree/paladin'));
assert.ok(CLASS_IDS.includes('paladin'));
assert.equal(ABILITIES.paladin_cleave.classId, 'paladin');
assert.equal(CONTENT.skilltree.specs.paladin.start, 'paladin_heroic_strike');
const { getTree } = await import('../shared/data/skilltree.js');
assert.ok(JSON.stringify(getTree('paladin')).includes('paladin_taunt'));
const { createCharacter } = await import('../shared/character.js');
assert.ok(createCharacter({ id: 'x', name: 'x', classId: 'paladin', level: 20, isMain: true }));
// removing the class removes its abilities and tree too
const del = cm.delete('classes', 'paladin');
assert.ok(del.also.length >= 5);
assert.ok(!CLASS_IDS.includes('paladin') && !ABILITIES.paladin_cleave && !CONTENT.skilltree.specs.paladin);
assert.ok(!exists('abilities/paladin'), 'empty folders are tidied up');
// a new status shows up in the derived id list
const { STATUS_IDS } = await import('../shared/data/statuses.js');
const st0 = Object.keys(CONTENT.statuses.statuses)[0];
cm.create('statuses', 'test_status', { from: st0 });
assert.ok(STATUS_IDS.includes('test_status'));
cm.delete('statuses', 'test_status');
assert.ok(!STATUS_IDS.includes('test_status'));
ok('new classes: kit copied along, removed along; derived lists follow');

fs.rmSync(dataDir, { recursive: true, force: true });
console.log(`Content editor: all ${n} checks passed.`);
