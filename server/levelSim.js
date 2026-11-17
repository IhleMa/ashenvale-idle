// Levelling simulation (Admin → 📈 XP curve → "Test with bots").
// Runs as its own process (started by LevelSimRunner below) so the real game is never slowed down or touched:
// a throw-away database, the server's current content and settings, one bot per play style, and a
// fast-forwarded clock. Reports, as JSON lines on stdout, when each bot's hero reached each level.
//
//   input (stdin, JSON): { hours, curve: [[level, xp], …] | null, schedule: "online" | "natural", settings: {…} }
//   output: { t: "progress", simHours, bots: [...] } … { t: "done", … } | { t: "error", message }
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);

// ---------------------------------------------------------------- the child process
async function runSimulation(input) {
  const hours = Math.max(0.5, Math.min(24 * 14, Number(input.hours) || 24));
  let fake = Date.now();
  const startedAt = fake;
  Date.now = () => fake;

  const { CONTENT } = await import('../shared/content.js');
  // the curve to test (null = the formula base × level^exponent)
  if (Array.isArray(input.curve) && input.curve.length >= 2) CONTENT.config.xp.curve = input.curve;
  else delete CONTENT.config.xp.curve;
  const { Store } = await import('./store.js');
  const { Settings } = await import('./settings.js');
  const { AdminManager } = await import('./admin.js');
  const { Game } = await import('./game.js');
  const { BotManager, ARCHETYPES } = await import('./bots.js');
  const L = await import('./playerLogic.js');

  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ashen-levelsim-'));
  const out = msg => process.stdout.write(JSON.stringify(msg) + '\n');
  try {
    const store = new Store(DATA, { log: () => {} });
    const game = new Game({ store, assets: { get: () => ({}) }, log: () => {}, settings: new Settings(store, input.settings || {}), admins: new AdminManager(store), buildId: 'sim' });
    const bots = new BotManager(game, { log: () => {} });
    game.bots = bots;
    // one bot per play style, ordered from relaxed to hardcore
    const types = Object.entries(ARCHETYPES).sort((a, b) => (a[1].skill ?? 0) - (b[1].skill ?? 0)).map(([id]) => id);
    for (const t of types) bots.add(1, t);
    const always = input.schedule !== 'natural';
    for (const b of bots.bots.values()) b.nextSwitch = fake;

    const track = new Map(); // accountId → { levels: { level: hours } }
    for (const b of bots.bots.values()) track.set(b.accountId, { name: b.name, archetype: b.archetype, label: ARCHETYPES[b.archetype]?.label || b.archetype, skill: ARCHETYPES[b.archetype]?.skill ?? 0, levels: {}, level: 0, online: 0, seen: 0 });
    const cap = CONTENT.config.levelCap;
    const snapshot = () => [...track.values()].map(x => ({ name: x.name, archetype: x.archetype, label: x.label, skill: x.skill, level: x.level, levels: x.levels, onlineShare: x.seen ? x.online / x.seen : 1 }));
    const record = () => {
      const h = (fake - startedAt) / 3600_000;
      for (const [id, x] of track) {
        const b = bots.bots.get(id);
        x.seen++; if (b?.online) x.online++;
        const p = store.loadPlayer(id);
        const lvl = (p && L.hero(p)?.level) || 0;
        for (let l = x.level + 1; l <= lvl; l++) if (l > 1) x.levels[l] = +h.toFixed(3);
        x.level = Math.max(x.level, lvl);
      }
    };

    const TICK = 100;
    const ticksPerHour = 3600_000 / TICK;
    let lastReport = 0;
    for (let i = 0; i < hours * ticksPerHour; i++) {
      fake += TICK;
      game.tick();
      if (i % 10 === 0) {
        if (always) for (const b of bots.bots.values()) if (b.online && b.nextSwitch < fake + 3600_000) b.nextSwitch = fake + 2 * 3600_000;
        bots.tick();
      }
      if (i % 600 === 0) record();              // every simulated minute
      if (i % 3000 === 0) game.auction.sweep?.();
      if (i % 50_000 === 0) game.save();
      if (i - lastReport >= ticksPerHour / 2) { // every simulated half hour
        lastReport = i;
        out({ t: 'progress', simHours: +((fake - startedAt) / 3600_000).toFixed(2), hours, bots: snapshot() });
        await new Promise(r => setImmediate(r));
        if ([...track.values()].every(x => x.level >= cap)) break;
      }
    }
    record();
    out({ t: 'done', simHours: +((fake - startedAt) / 3600_000).toFixed(2), hours, bots: snapshot() });
  } finally {
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* temp */ }
  }
}

if (process.argv[1] === SELF && process.argv[2] === '--child') {
  let raw = '';
  process.stdin.on('data', d => { raw += d; });
  process.stdin.on('end', () => {
    runSimulation(JSON.parse(raw || '{}'))
      .then(() => process.exit(0))
      .catch(e => { process.stdout.write(JSON.stringify({ t: 'error', message: e.message }) + '\n'); process.exit(1); });
  });
}

// ---------------------------------------------------------------- the runner in the game server
export class LevelSimRunner {
  constructor({ dataDir, settings, log = console.log }) {
    this.dataDir = dataDir; this.settings = settings; this.log = log;
    this.current = null;  // running or last finished run
    this.history = [];    // finished runs, newest first (for comparing curves)
    this.child = null;
    this.seq = 0;
  }
  start({ curve = null, hours = 24, schedule = 'online', label = '' } = {}, by = '') {
    if (this.child) throw new Error('A simulation is already running — wait for it or cancel it');
    const run = { id: ++this.seq, label: label || (curve ? 'edited curve' : 'saved curve'), curve, hours, schedule, by, startedAt: Date.now(), simHours: 0, bots: [], status: 'running', error: null };
    const child = spawn(process.execPath, [SELF, '--child'], { env: { ...process.env, DATA_DIR: this.dataDir }, stdio: ['pipe', 'pipe', 'pipe'] });
    try { os.setPriority(child.pid, 19); } catch { /* not allowed here — fine */ }
    this.child = child; this.current = run;
    let buf = '', errText = '';
    child.stdout.on('data', d => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.t === 'progress' || m.t === 'done') { run.simHours = m.simHours; run.bots = m.bots; }
        if (m.t === 'done') run.status = 'done';
        if (m.t === 'error') { run.status = 'error'; run.error = m.message; }
      }
    });
    child.stderr.on('data', d => { errText = (errText + d).slice(-2000); });
    child.on('exit', code => {
      this.child = null;
      if (run.status === 'running') { run.status = run.cancelled ? 'cancelled' : 'error'; if (!run.cancelled) run.error = errText.trim().split('\n').pop() || `exit code ${code}`; }
      run.finishedAt = Date.now();
      if (run.bots.length) { this.history.unshift(run); this.history = this.history.slice(0, 4); }
      this.log(`XP curve simulation #${run.id} ${run.status} after ${run.simHours} simulated hours (${Math.round((run.finishedAt - run.startedAt) / 1000)}s).`);
    });
    child.stdin.end(JSON.stringify({ hours, curve, schedule, settings: this.settings?.values || {} }));
    return this.status();
  }
  cancel() {
    if (!this.child) return this.status();
    this.current.cancelled = true;
    this.child.kill('SIGTERM');
    return this.status();
  }
  stop() { this.child?.kill('SIGKILL'); }
  status() {
    const brief = r => r && { id: r.id, label: r.label, curve: r.curve, hours: r.hours, schedule: r.schedule, by: r.by, startedAt: r.startedAt, finishedAt: r.finishedAt || null, simHours: r.simHours, status: r.status, error: r.error, bots: r.bots };
    return { running: !!this.child, current: brief(this.current), history: this.history.map(brief) };
  }
}
