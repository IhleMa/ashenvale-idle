// Look at a player's real characters from an admin export (⬇ Export data in the admin panel):
//   node tools/inspect-export.js ashenvale-<name>-<date>.json
// Prints every character's crit chance and attack speed with where they come from.
import fs from 'node:fs';
import { computeStats, collectBonuses, equipmentStats } from '../shared/stats.js';
import { CLASSES } from '../shared/data/classes.js';
import { migratePlayer } from '../server/playerLogic.js';

const file = process.argv[2];
if (!file) { console.error('usage: node tools/inspect-export.js <export.json>'); process.exit(1); }
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const p = data.player || data;
try { migratePlayer(p); } catch (e) { console.warn('migrate:', e.message); }
const pc = v => `${(v * 100).toFixed(1)}%`;
for (const ch of Object.values(p.characters || {})) {
  const s = computeStats(ch), cls = CLASSES[ch.classId];
  const gear = equipmentStats(ch), bonus = collectBonuses(ch);
  const fromAttr = k => Object.entries(cls.scaling[k] || {}).map(([a, c]) => `${a} ${s.attributes[a]} × ${c} = ${pc(s.attributes[a] * c)}`).join(', ');
  console.log(`\n${ch.isMain ? '★ ' : ''}${ch.name} — ${ch.classId}${ch.subclass ? '/' + ch.subclass : ''} level ${ch.level}, weapon ${ch.equipment?.weapon?.baseId || 'none'}`);
  console.log(`  crit ${pc(s.critChance)} (uncapped ${pc(s.uncapped.critChance)}) = base ${pc(s.weaponCrit)} × (1 + ${pc(s.critInc)})`);
  console.log(`    increased: class level bonus ${pc(s.levelCrit || 0)} · gear ${pc(gear.critChance || 0)} · tree & other ${pc(bonus.critChance || 0)}${fromAttr('critChance') ? ' · attributes ' + fromAttr('critChance') : ''}`);
  console.log(`  attack speed ${pc(s.attackSpeed)} (uncapped ${pc(s.uncapped.attackSpeed)}) = base ${pc(s.weaponSpeed)} × (1 + ${pc(s.speedInc)}) × ${pc(s.speedMore)}`);
  console.log(`    increased: class level bonus ${pc(s.levelSpeed || 0)} · gear ${pc(gear.attackSpeed || 0)} · tree & other ${pc(bonus.attackSpeed || 0)}${fromAttr('attackSpeed') ? ' · attributes ' + fromAttr('attackSpeed') : ''}`);
  for (const [slot, it] of Object.entries(ch.equipment || {})) if (it) {
    const g = equipmentStats({ ...ch, equipment: { [slot]: it } });
    if (g.critChance || g.attackSpeed) console.log(`    ${slot}: ${it.name} (lvl ${it.level}) crit +${pc(g.critChance || 0)} speed +${pc(g.attackSpeed || 0)}`);
  }
}
