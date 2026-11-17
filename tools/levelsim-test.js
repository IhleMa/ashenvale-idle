// XP curve simulation: runs the real bot simulation process for 1 simulated hour with a custom curve.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const { LevelSimRunner } = await import('../server/levelSim.js');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ashen-simtest-'));
const runner = new LevelSimRunner({ dataDir, settings: { values: {} }, log: () => {} });
// a very cheap curve: everyone levels quickly
runner.start({ curve: [[1, 20], [59, 2000]], hours: 1, label: 'cheap' }, 'test');
assert.throws(() => runner.start({ hours: 1 }), /already running/);
const until = Date.now() + 120_000;
while (runner.status().running && Date.now() < until) await new Promise(r => setTimeout(r, 300));
const st = runner.status();
assert.equal(st.current.status, 'done', st.current.error || 'did not finish');
assert.equal(st.current.simHours, 1);
assert.ok(st.current.bots.length >= 4, 'one bot per play style');
assert.ok(st.current.bots.every(b => b.level >= 5 && b.levels[2] != null), `bots levelled: ${st.current.bots.map(b => b.level).join(', ')}`);
assert.equal(st.history[0].id, st.current.id);
console.log(`  ✔ simulated 1h with a custom curve: levels ${st.current.bots.map(b => `${b.label} ${b.level}`).join(', ')}`);
fs.rmSync(dataDir, { recursive: true, force: true });
console.log('Level simulation: all checks passed.');
