// Enemies and bosses — defined in content/enemies.json (stats are level-1 values, "growth" scales them).
import { CONTENT, withIds, onContentReload } from '../content.js';

const E = CONTENT.enemies;
export const ENEMY_TUNING = E.tuning;
export const ENEMIES = withIds(E.enemies);
function applyDefaults() {
  withIds(ENEMIES);
  for (const e of Object.values(ENEMIES)) {
    e.growth = e.growth || E.defaults.growth;
    e.basicSchool = e.basicSchool || E.defaults.basicSchool;
  }
}
applyDefaults();
onContentReload(applyDefaults);

export function enemyStatsAt(def, level, scale = { hp: 1, damage: 1 }) {
  const g = def.growth;
  const L = level - 1;
  const s = def.stats;
  const hpT = def.boss ? ENEMY_TUNING.bossHp : ENEMY_TUNING.hp;
  const dmgT = def.boss ? ENEMY_TUNING.bossDamage : ENEMY_TUNING.damage;
  return {
    maxHp: Math.round(s.hp * hpT * (1 + g.hp * L) * scale.hp),
    physPower: s.physPower * dmgT * (1 + g.power * L) * scale.damage,
    magPower: s.magPower * dmgT * (1 + g.power * L) * scale.damage,
    healPower: s.magPower * dmgT * (1 + g.power * L),
    defense: s.defense * (1 + g.defense * L),
    critChance: s.critChance ?? 0.05,
    critDamage: 1.5,
    attackSpeed: s.attackSpeed ?? 1,
    dodge: 0,
  };
}
