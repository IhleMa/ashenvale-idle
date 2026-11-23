// Inventory stat filter groups (Path of Exile trade style): and / not / count / weighted sum, min/max, tiers, off rows.
import assert from 'node:assert/strict';
import { matchStatGroups, cleanGroups, groupsActive } from '../shared/statFilter.js';

let n = 0;
const ok = m => { n++; console.log(`  ✔ ${m}`); };
const item = { affixes: [{ stat: 'critChance', tier: 2 }, { stat: 'dex', tier: 5 }] };
const stats = { critChance: 0.4, dex: 60, physPower: 30 }; // critChance shown as 40 (%)
const m = groups => matchStatGroups(item, groups, stats);
const row = (stat, extra = {}) => ({ stat, min: '', max: '', tier: '', weight: '', off: false, ...extra });

assert.ok(m([]), 'no groups: everything matches');
assert.ok(m([{ type: 'and', rows: [row('critChance', { min: 30 }), row('dex')] }]));
assert.ok(!m([{ type: 'and', rows: [row('critChance', { min: 50 })] }]), 'min is in percent for % stats');
assert.ok(!m([{ type: 'and', rows: [row('dex', { max: 50 })] }]), 'max');
assert.ok(m([{ type: 'and', rows: [row('critChance', { tier: '2' })] }]) && !m([{ type: 'and', rows: [row('dex', { tier: '3' })] }]), 'tier at least');
ok('AND: every stat with min / max / tier');

assert.ok(m([{ type: 'not', rows: [row('int'), row('vit')] }]));
assert.ok(!m([{ type: 'not', rows: [row('int'), row('dex')] }]));
ok('NOT: none of the stats');

const cnt = (min, max) => m([{ type: 'count', min, max, rows: [row('critChance'), row('dex'), row('int'), row('vit')] }]);
assert.ok(cnt('', '') && cnt(2, '') && !cnt(3, '') && cnt(1, 2) && !cnt(1, 1));
ok('COUNT: at least min (default 1), at most max');

const wsum = (min, max) => m([{ type: 'weight', min, max, rows: [row('critChance', { weight: 2 }), row('dex', { weight: 0.5 }), row('int', { weight: 10 })] }]);
// 40 × 2 + 60 × 0.5 + 0 = 110
assert.ok(wsum(110, '') && !wsum(111, '') && wsum('', 110) && !wsum('', 109));
ok('WEIGHTED SUM: value × weight of the stats it has, between min and max');

assert.ok(m([{ type: 'and', rows: [row('int', { off: true })] }]), 'switched-off rows are ignored');
assert.ok(m([{ type: 'and', rows: [row('critChance')] }, { type: 'not', rows: [row('int')] }]) && !m([{ type: 'and', rows: [row('critChance')] }, { type: 'not', rows: [row('dex')] }]), 'all groups must match');
assert.ok(!groupsActive([{ type: 'and', rows: [row('')] }]) && groupsActive([{ type: 'not', rows: [row('dex')] }]));
ok('off rows ignored, every group must match, empty groups do nothing');

const legacy = cleanGroups(undefined, { mode: 'any', rows: [{ stat: 'dex', min: 5, tier: '2' }] });
assert.equal(legacy[0].type, 'count'); assert.equal(legacy[0].rows[0].min, 5);
assert.equal(cleanGroups([{ type: 'evil', rows: [{ stat: 'x'.repeat(99), min: 'abc', tier: '9' }] }])[0].type, 'and');
ok('old saved highlights (all/any rows) convert; junk is cleaned');
console.log(`Stat filter: all ${n} checks passed.`);
