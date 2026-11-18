// Deterministic combat simulation. No DOM, no timers: call stepBattle() once per tick.
// The server runs this authoritatively; the same code is used for offline progression.
import { CONFIG } from './config.js';
import { CLASSES } from './data/classes.js';
import { ABILITIES } from './data/abilities.js';
import { STATUSES } from './data/statuses.js';
import { ENEMIES, enemyStatsAt } from './data/enemies.js';
import { MINIONS } from './data/minions.js';
import { computeStats } from './stats.js';
import { equipmentEffects } from './data/legendaries.js';
import { createRng } from './rng.js';
import { resolveRule, hpPct, hasStatus, enemiesOf, alliesOf, ownMinions } from './rules.js';

const C = CONFIG.combat;
const DT = C.tickMs / 1000;

// ---------------------------------------------------------------- unit factories
export function makeCharacterUnit(ch, { ownerId, ownerName, position, bonuses = {}, vsEnemy = null }) {
  const cls = CLASSES[ch.classId];
  const s = computeStats(ch);
  const role = CONFIG.roles[ch.role] || {};
  const fx = equipmentEffects(ch); // uniques & set bonuses
  return {
    procs: fx.procs.map(p => ({ ...p, lastAt: -1e9, used: false })), passives: fx.passives,
    uid: 0, side: 'A', kind: 'character', name: ch.name, defId: ch.classId, classId: ch.classId,
    charId: ch.id, ownerId, ownerName, isMain: !!ch.isMain, portrait: ch.portrait || null,
    level: ch.level, role: ch.role, tags: ['hero'], position,
    stats: s, maxHp: s.maxHp, hp: s.maxHp,
    resource: cls.resource.start, resourceMax: cls.resource.max, resourceDef: cls.resource,
    cooldowns: {}, statuses: [], alive: true,
    loadout: [...ch.loadout], ranks: { ...ch.abilities }, rules: JSON.parse(JSON.stringify(ch.rules)),
    basicAttack: cls.basicAttack,
    threatMult: (cls.threatMult || 1) * (role.threatMult || 1),
    bonuses: {
      damagePct: (role.damagePct || 0) + (bonuses.damagePct || 0) + s.damagePct,
      healingPct: (role.healingPct || 0) + (bonuses.healingPct || 0) + s.healingPct,
      damageTakenPct: (role.damageTakenPct || 0) + (bonuses.damageTakenPct || 0) + s.damageTakenPct,
      buffDurationPct: role.buffDurationPct || 0,
      allStatsPct: bonuses.allStatsPct || 0,
    },
    actionTimer: 0.3 + position * 0.25,
    danger: 0,
    vsEnemy, // bestiary mastery: { enemyId: damage bonus }
    minionBonus: { damagePct: s.minionDamagePct || 0, hpPct: s.minionHpPct || 0, durationPct: s.minionDurationPct || 0, extraMax: s.minionMax || 0 },
  };
}

// A player's summoned minion: stats come from its summoner (content/minions/)
export function makeMinionUnit(minionId, owner, battleTime) {
  const def = MINIONS[minionId];
  if (!def) throw new Error('Unknown minion ' + minionId);
  const mb = owner.minionBonus || {};
  const power = Math.max(owner.stats.magPower || 0, owner.stats.physPower || 0);
  const maxHp = Math.max(1, Math.round(owner.maxHp * def.hp * (1 + (mb.hpPct || 0))));
  const stats = {
    maxHp, physPower: Math.round(power * def.power), magPower: Math.round(power * def.power), healPower: Math.round(power * def.power),
    defense: Math.round((owner.stats.defense || 0) * (def.defense ?? 0.5)),
    critChance: (owner.stats.critChance || 0.05) * 0.5, critDamage: 1.5, attackSpeed: def.attackSpeed || 1, dodge: 0,
  };
  const rules = {}, ranks = {};
  for (const a of def.abilities || []) { rules[a] = JSON.parse(JSON.stringify(ABILITIES[a].defaultRule)); ranks[a] = 1; }
  const duration = (def.duration || 0) * (1 + (mb.durationPct || 0));
  return {
    uid: 0, side: owner.side, kind: 'minion', name: def.name, defId: minionId, level: owner.level, tags: ['minion', ...(def.tags || [])],
    ownerUid: owner.uid, ownerId: owner.ownerId, ownerName: owner.ownerName, charId: owner.charId, summonerName: owner.name,
    role: def.role || 'damage', position: 10 + (def.role === 'tank' ? -20 : 0),
    stats, maxHp, hp: maxHp, resource: 0, resourceMax: 0, resourceDef: null,
    cooldowns: Object.fromEntries((def.abilities || []).map(a => [a, ABILITIES[a].cooldown * 0.3])),
    statuses: [], alive: true,
    loadout: [...(def.abilities || [])], ranks, rules,
    basicAttack: { name: def.attack?.name || 'Attack', stat: def.attack?.school === 'magical' ? 'magPower' : 'physPower', power: def.attack?.power ?? 1, school: def.attack?.school || 'physical' },
    threatMult: def.role === 'tank' ? 2 : 1,
    bonuses: { damagePct: (mb.damagePct || 0) + (owner.bonuses?.damagePct || 0) * 0.5, healingPct: owner.bonuses?.healingPct || 0, damageTakenPct: 0, buffDurationPct: 0, allStatsPct: 0 },
    actionTimer: 0.4,
    danger: 0,
    expiresAt: duration > 0 ? battleTime + duration : null,
    duration,
  };
}

export function makeEnemyUnit(enemyId, level, { position = 0, scale = { hp: 1, damage: 1 }, summoned = false } = {}) {
  const def = ENEMIES[enemyId];
  if (!def) throw new Error('Unknown enemy ' + enemyId);
  const s = enemyStatsAt(def, level, scale);
  const rules = {}, ranks = {};
  for (const a of def.abilities) { rules[a] = JSON.parse(JSON.stringify(ABILITIES[a].defaultRule)); ranks[a] = 1; }
  return {
    uid: 0, side: 'B', kind: 'enemy', name: def.name, defId: enemyId, level, tags: def.tags, position,
    boss: !!def.boss, summoned,
    stats: s, maxHp: s.maxHp, hp: s.maxHp, resource: 0, resourceMax: 0, resourceDef: null,
    cooldowns: Object.fromEntries(def.abilities.map(a => [a, ABILITIES[a].cooldown * 0.5])),
    statuses: [], alive: true,
    loadout: [...def.abilities], ranks, rules,
    basicAttack: { name: 'Attack', stat: def.basicSchool === 'magical' ? 'magPower' : 'physPower', power: 1, school: def.basicSchool },
    threatMult: 1, threatTable: {},
    bonuses: { damagePct: 0, healingPct: 0, damageTakenPct: 0, buffDurationPct: 0, allStatsPct: 0 },
    actionTimer: 0.8 + position * 0.3,
    danger: (s.physPower + s.magPower) * (def.boss ? 4 : def.tags.includes('elite') ? 2 : def.tags.includes('caster') ? 1.3 : 1),
    phasesDone: [], enrageAfter: def.enrageAfter || 0, phases: def.phases || [],
  };
}

// ---------------------------------------------------------------- battle
// waves: array of arrays of { enemyId, level } ; scale: { hp, damage } multiplier for enemies
// hooks (optional, e.g. rift affixes): { spawn(b, unit, api), kill(b, src, tgt, api), damaged(b, src, tgt, info, api),
//   tick(b, api), damageMult(src, tgt, school) -> number }
export function createBattle({ seed, allies, waves, scale = { hp: 1, damage: 1 }, meta = {}, hooks = null }) {
  const b = {
    seed, rng: createRng(seed), time: 0, ticks: 0, nextUid: 1,
    units: [], waves, waveIndex: -1, scale, meta, hooks,
    state: 'running', events: [], kills: [], phaseTime: 0,
  };
  for (const u of allies) addUnit(b, u);
  // initial threat by position: enemies prefer front-liners before any damage happens
  nextWave(b);
  return b;
}

function addUnit(b, u) {
  u.uid = b.nextUid++;
  b.units.push(u);
  return u;
}

function nextWave(b) {
  b.waveIndex++;
  b.units = b.units.filter(u => u.side === 'A' || u.alive); // drop dead enemies
  const wave = b.waves[b.waveIndex];
  wave.forEach((spec, i) => {
    const u = addUnit(b, makeEnemyUnit(spec.enemyId, spec.level, { position: i, scale: b.scale }));
    seedThreat(b, u);
    b.hooks?.spawn?.(b, u, HOOK_API);
  });
  b.phaseTime = 0;
  emit(b, { type: 'wave', wave: b.waveIndex + 1, total: b.waves.length, units: b.units.filter(u => u.side === 'B').map(publicUnit) });
}

function seedThreat(b, enemy) {
  for (const a of b.units.filter(x => x.side === 'A')) {
    enemy.threatTable[a.uid] = (C.positionThreat[a.position] ?? 0) * (a.role === 'tank' ? 2 : 1);
  }
}

function emit(b, ev) { ev.t = Math.round(b.time * 10) / 10; b.events.push(ev); }

export function drainEvents(b) { const e = b.events; b.events = []; return e; }

// ---------------------------------------------------------------- stats with statuses
function mod(u, key) {
  let v = 0;
  for (const s of u.statuses) {
    const m = STATUSES[s.id]?.mods?.[key];
    if (m) v += m * (STATUSES[s.id].maxStacks ? s.stacks : 1);
  }
  return v;
}
const effAttackSpeed = u => Math.max(0.2, u.stats.attackSpeed * (1 + mod(u, 'attackSpeedPct')));
const effDefense = u => Math.max(0, u.stats.defense * (1 + mod(u, 'defensePct') + u.bonuses.allStatsPct));
const effPower = (u, stat) => (u.stats[stat] || 0) * (1 + u.bonuses.allStatsPct);
const rankMult = (u, abilityId) => 1 + CONFIG.abilityRankBonus * ((u.ranks?.[abilityId] || 1) - 1);

// ---------------------------------------------------------------- main step
export function stepBattle(b) {
  if (b.state !== 'running') return;
  b.time += DT; b.ticks++; b.phaseTime += DT;
  // minions: fade when their time is up or their summoner falls; dead ones leave the field
  if (b.units.some(u => u.kind === 'minion')) {
    for (const u of b.units) {
      if (u.kind !== 'minion' || !u.alive) continue;
      const owner = b.units.find(x => x.uid === u.ownerUid);
      if ((u.expiresAt != null && b.time >= u.expiresAt) || !owner?.alive) expireMinion(b, u);
    }
    b.units = b.units.filter(u => u.alive || u.kind !== 'minion');
  }
  const living = b.units.filter(u => u.alive);

  for (const u of living) {
    // resource regen
    if (u.resourceDef) u.resource = Math.min(u.resourceMax, u.resource + u.resourceDef.regen * DT);
    for (const k in u.cooldowns) if (u.cooldowns[k] > 0) u.cooldowns[k] = Math.max(0, u.cooldowns[k] - DT);
    tickStatuses(b, u);
    if (u.boss && u.enrageAfter && b.phaseTime >= u.enrageAfter && !u.enraged) {
      u.enraged = true;
      applyStatus(b, u, u, 'enrage', 999, 0, 1);
      emit(b, { type: 'phase', src: u.uid, message: `${u.name} becomes enraged!` });
    }
  }
  if (b.hooks?.tick) { b.hooks.tick(b, HOOK_API); if (checkEnd(b)) return; }
  for (const u of b.units) {
    if (!u.alive) continue;
    u.actionTimer -= DT;
    if (u.actionTimer > 0) continue;
    if (hasStatus(u, 'stun')) { u.actionTimer = 0.1; continue; }
    act(b, u);
    if (checkEnd(b)) return;
  }
  checkEnd(b);
}

function checkEnd(b) {
  if (b.state !== 'running') return true;
  const alliesAlive = b.units.some(u => u.side === 'A' && u.alive && u.kind !== 'minion'); // minions alone can't win
  const enemiesAlive = b.units.some(u => u.side === 'B' && u.alive);
  if (!alliesAlive) { finish(b, 'defeat'); return true; }
  if (!enemiesAlive) {
    if (b.waveIndex + 1 < b.waves.length) nextWave(b);
    else { finish(b, 'victory'); return true; }
  }
  if (b.time > C.maxBattleSeconds * b.waves.length) { finish(b, 'defeat'); return true; }
  return false;
}

function finish(b, state) {
  b.state = state;
  emit(b, { type: 'end', result: state });
}

// ---------------------------------------------------------------- actions
function act(b, u) {
  const gcd = C.globalCooldown / effAttackSpeed(u);
  // Resource pooling: if a higher-priority ability is ready and its conditions are met but it can't be
  // afforded yet, lower-priority abilities may only spend resource they can spare without delaying it.
  let reserved = 0;
  for (const abilityId of u.loadout) {
    const ab = ABILITIES[abilityId];
    if (!ab || (u.cooldowns[abilityId] || 0) > 0) continue;
    const rule = u.rules[abilityId];
    const cost = Math.ceil(ab.cost * Math.max(0, 1 + (u.passives?.costPct || 0)));
    if (u.resourceDef) {
      if (u.resource < cost) {
        if (rule?.reserve !== false && cost > reserved && resolveRule(rule, ab, b, u)) reserved = cost;
        continue;
      }
      if (reserved && u.resource - cost < reserved) continue;
    }
    const targets = resolveRule(rule, ab, b, u);
    if (!targets) continue;
    if (u.resourceDef) u.resource -= cost;
    u.cooldowns[abilityId] = ab.cooldown;
    emit(b, { type: 'ability', src: u.uid, ability: abilityId, tgts: targets.map(t => t.uid) });
    for (const t of targets) for (const eff of ab.effects) applyEffect(b, u, t, eff, abilityId);
    fireProcs(b, u, 'cast', { ability: abilityId, area: !!ab.area, target: targets[0] });
    u.actionTimer = gcd;
    return;
  }
  // basic attack
  const target = basicTarget(b, u);
  u.actionTimer = C.baseAttackInterval / effAttackSpeed(u);
  if (!target) return;
  const ba = u.basicAttack;
  dealDamage(b, u, target, effPower(u, ba.stat) * ba.power, { school: ba.school, ability: null });
  if (u.resourceDef?.onHit) u.resource = Math.min(u.resourceMax, u.resource + u.resourceDef.onHit);
}

function basicTarget(b, u) {
  const foes = enemiesOf(b, u);
  if (!foes.length) return null;
  const taunter = foes.find(f => hasStatus(f, 'taunting'));
  if (taunter && u.threatTable) return taunter;
  if (u.threatTable) {
    let best = null, bestT = -1;
    for (const f of foes) { const t = u.threatTable[f.uid] || 0; if (t > bestT) { bestT = t; best = f; } }
    return best;
  }
  return foes.reduce((a, f) => (f.position < a.position ? f : a), foes[0]);
}

function applyEffect(b, src, tgt, eff, abilityId) {
  const rm = rankMult(src, abilityId);
  switch (eff.kind) {
    case 'damage': {
      if (!tgt.alive) return;
      const hits = eff.hits || 1;
      for (let i = 0; i < hits && tgt.alive; i++) {
        let amount = effPower(src, eff.stat) * eff.power * rm;
        if (eff.executeBelow && hpPct(tgt) < eff.executeBelow * 100) amount *= eff.executeMult || 2;
        dealDamage(b, src, tgt, amount, { school: eff.school, ability: abilityId, bonusCrit: eff.bonusCrit, proc: eff.proc });
      }
      break;
    }
    case 'heal': {
      if (!tgt.alive) return;
      healUnit(b, src, tgt, effPower(src, eff.stat) * eff.power * rm, abilityId, null, eff.proc);
      break;
    }
    case 'status': {
      const target = eff.self ? src : tgt;
      if (!target.alive) return;
      if (eff.chance && b.rng() > eff.chance) return;
      const value = eff.stat ? effPower(src, eff.stat) * (eff.power || 0) * rm : 0;
      let dur = eff.duration;
      if (STATUSES[eff.status]?.type === 'buff') dur *= 1 + (src.bonuses.buffDurationPct || 0);
      applyStatus(b, src, target, eff.status, dur, value, eff.stacks || 1);
      break;
    }
    case 'shield': {
      if (!tgt.alive) return;
      const value = effPower(src, eff.stat) * eff.power * rm * (1 + src.bonuses.healingPct);
      applyStatus(b, src, tgt, 'barrier', eff.duration, value, 1);
      break;
    }
    case 'taunt': {
      applyStatus(b, src, src, 'taunting', eff.duration, 0, 1);
      for (const e of enemiesOf(b, src)) {
        if (!e.threatTable) continue;
        const top = Math.max(0, ...Object.values(e.threatTable));
        e.threatTable[src.uid] = top * 1.1 + 50;
      }
      break;
    }
    case 'cleanse': {
      let n = eff.count || 1;
      tgt.statuses = tgt.statuses.filter(s => {
        if (n > 0 && STATUSES[s.id]?.type === 'debuff') { n--; emit(b, { type: 'cleanse', src: src.uid, tgt: tgt.uid, status: s.id }); return false; }
        return true;
      });
      break;
    }
    case 'resource': {
      if (tgt.resourceDef) tgt.resource = Math.min(tgt.resourceMax, tgt.resource + eff.amount);
      break;
    }
    case 'sacrifice': sacrificeMinions(b, src, eff, abilityId); break;
    case 'extend': {
      if (tgt.alive && tgt.expiresAt != null) tgt.expiresAt = Math.min(tgt.expiresAt + (eff.seconds || 0), b.time + tgt.duration * 2);
      break;
    }
    case 'summon': {
      if (eff.minion) { summonMinions(b, src, eff); break; }
      const current = b.units.filter(u => u.side === src.side && u.alive).length;
      const n = Math.min(eff.count || 1, Math.max(0, (eff.max || 4) - current + 1));
      for (let i = 0; i < n; i++) {
        const pos = b.units.filter(u => u.side === src.side).length;
        const nu = addUnit(b, makeEnemyUnit(eff.enemyId, src.level, { position: pos, scale: b.scale, summoned: true }));
        nu.side = src.side;
        seedThreat(b, nu);
        b.hooks?.spawn?.(b, nu, HOOK_API);
        emit(b, { type: 'spawn', src: src.uid, unit: publicUnit(nu) });
      }
      break;
    }
  }
}

// ---------------------------------------------------------------- minions
function summonMinions(b, src, eff) {
  if (!MINIONS[eff.minion]) return;
  const max = (eff.max || 1) + (src.minionBonus?.extraMax || 0);
  for (let i = 0; i < (eff.count || 1); i++) {
    const mine = ownMinions(b, src, eff.minion);
    if (mine.length >= max) {
      // at the limit: renew the one closest to fading instead
      const oldest = mine.filter(m => m.expiresAt != null).sort((a, c) => a.expiresAt - c.expiresAt)[0];
      if (oldest) { oldest.expiresAt = b.time + oldest.duration; oldest.hp = oldest.maxHp; emit(b, { type: 'renew', src: src.uid, tgt: oldest.uid }); }
      continue;
    }
    const nu = addUnit(b, makeMinionUnit(eff.minion, src, b.time));
    // enemies notice the newcomer (tanky minions loudly)
    for (const e of enemiesOf(b, nu)) if (e.threatTable) e.threatTable[nu.uid] = MINIONS[eff.minion].threat ?? 10;
    emit(b, { type: 'spawn', src: src.uid, unit: publicUnit(nu) });
  }
}

function expireMinion(b, u, reason = 'expire') {
  u.alive = false;
  u.hp = 0;
  u.statuses = [];
  emit(b, { type: 'expire', src: u.ownerUid, tgt: u.uid, reason });
}

function sacrificeMinions(b, src, eff, abilityId) {
  // the minions closest to fading go first
  const victims = ownMinions(b, src).sort((a, c) => (a.expiresAt ?? 1e9) - (c.expiresAt ?? 1e9)).slice(0, eff.count || 1);
  for (const m of victims) {
    const amount = m.maxHp * (eff.power || 1) * rankMult(src, abilityId);
    expireMinion(b, m, 'sacrifice');
    for (const e of enemiesOf(b, src)) dealDamage(b, src, e, amount, { school: eff.school || 'magical', ability: abilityId });
  }
}

function applyStatus(b, src, tgt, id, duration, value, stacks) {
  const def = STATUSES[id];
  if (!def) return;
  const existing = tgt.statuses.find(s => s.id === id);
  if (existing) {
    existing.remaining = Math.max(existing.remaining, duration);
    existing.duration = Math.max(existing.duration, duration);
    if (def.maxStacks) existing.stacks = Math.min(def.maxStacks, existing.stacks + stacks);
    if (def.absorb) existing.value = Math.max(existing.value, value); else existing.value = Math.max(existing.value, value);
    existing.src = src.uid;
  } else {
    tgt.statuses.push({ id, remaining: duration, duration, value, stacks: def.maxStacks ? Math.min(def.maxStacks, stacks) : 1, src: src.uid, tickTimer: C.statusTickInterval });
  }
  emit(b, { type: 'status', src: src.uid, tgt: tgt.uid, status: id });
}

function tickStatuses(b, u) {
  for (const s of u.statuses) {
    s.remaining -= DT;
    const def = STATUSES[s.id];
    if (def.tick) {
      s.tickTimer -= DT;
      if (s.tickTimer <= 0) {
        s.tickTimer += C.statusTickInterval;
        const src = b.units.find(x => x.uid === s.src) || u;
        const amount = s.value * (def.maxStacks ? s.stacks : 1);
        if (def.tick === 'damage') dealDamage(b, src, u, amount, { school: def.school, ability: null, dot: s.id, ignoreArmor: def.ignoreArmor, noCrit: true });
        else if (def.tick === 'heal') healUnit(b, src, u, amount, null, s.id);
        if (!u.alive) return;
      }
    }
  }
  const before = u.statuses.length;
  u.statuses = u.statuses.filter(s => s.remaining > 0 && !(STATUSES[s.id].absorb && s.value <= 0));
  if (u.statuses.length !== before) emit(b, { type: 'status_end', tgt: u.uid });
}

function dealDamage(b, src, tgt, raw, { school, ability, bonusCrit = 0, dot = null, ignoreArmor = false, noCrit = false, proc = null }) {
  if (!tgt.alive) return 0;
  if (!dot && school === 'physical' && mod(tgt, 'dodge') > 0 && b.rng() < mod(tgt, 'dodge')) {
    emit(b, { type: 'miss', src: src.uid, tgt: tgt.uid, ability });
    return 0;
  }
  let amount = raw * (1 + src.bonuses.damagePct + mod(src, 'damagePct'));
  if (src.passives) {
    if (src.passives.damageVsBossPct && tgt.boss) amount *= 1 + src.passives.damageVsBossPct;
    if (src.passives.damageVsHighHpPct && hpPct(tgt) > 80) amount *= 1 + src.passives.damageVsHighHpPct;
  }
  if (src.vsEnemy && tgt.defId in src.vsEnemy) amount *= 1 + src.vsEnemy[tgt.defId];
  if (b.hooks?.damageMult) amount *= b.hooks.damageMult(src, tgt, school);
  let crit = false;
  if (!noCrit && b.rng() < Math.min(C.critCap, src.stats.critChance + bonusCrit)) { crit = true; amount *= src.stats.critDamage; }
  if (!ignoreArmor) {
    const def = effDefense(tgt) * (school === 'magical' ? C.magicArmorFactor : 1);
    const red = Math.min(C.armorCap, def / (def + C.armorK + 12 * src.level));
    amount *= 1 - red;
  }
  amount *= Math.max(0.1, 1 + mod(tgt, 'damageTakenPct') + tgt.bonuses.damageTakenPct);
  amount *= 0.92 + b.rng() * 0.16;
  amount = Math.max(1, Math.round(amount));

  // barrier absorbs
  let absorbed = 0;
  const barrier = tgt.statuses.find(s => STATUSES[s.id].absorb && s.value > 0);
  if (barrier) {
    absorbed = Math.min(barrier.value, amount);
    barrier.value -= absorbed;
    amount -= absorbed;
  }
  tgt.hp = Math.max(0, tgt.hp - amount);
  emit(b, { type: 'damage', src: src.uid, tgt: tgt.uid, amount, absorbed, crit, ability, dot, school, ...(proc ? { proc } : {}) });

  if (tgt.threatTable && src.side !== tgt.side) tgt.threatTable[src.uid] = (tgt.threatTable[src.uid] || 0) + (amount + absorbed) * src.threatMult;
  if (tgt.resourceDef?.onDamaged) tgt.resource = Math.min(tgt.resourceMax, tgt.resource + tgt.resourceDef.onDamaged);

  if (tgt.hp <= 0) kill(b, src, tgt);
  else {
    if (tgt.phases?.length) checkPhases(b, tgt);
    b.hooks?.damaged?.(b, src, tgt, { amount, school, ability, dot }, HOOK_API);
  }
  if (!dot && !proc) {
    fireProcs(b, src, 'hit', { target: tgt, amount, school, ability });
    if (crit) fireProcs(b, src, 'crit', { target: tgt, amount, school, ability });
    if (tgt.alive) fireProcs(b, tgt, 'struck', { source: src, amount: amount + absorbed, school });
  }
  if (tgt.alive && tgt.procs?.length && hpPct(tgt) < 30) fireProcs(b, tgt, 'lowHp', {});
  return amount;
}

// ---------------------------------------------------------------- procs (uniques & set bonuses)
function procTargets(b, u, p, ctx) {
  switch (p.target) {
    case 'self': return [u];
    case 'target': return ctx.target?.alive ? [ctx.target] : [];
    case 'source': return ctx.source?.alive ? [ctx.source] : [];
    case 'randomEnemy': { const f = enemiesOf(b, u); return f.length ? [f[Math.floor(b.rng() * f.length)]] : []; }
    case 'lowestAlly': { const a = alliesOf(b, u); return a.length ? [a.reduce((m, x) => (hpPct(x) < hpPct(m) ? x : m), a[0])] : []; }
    case 'allAllies': return alliesOf(b, u);
    default: return [];
  }
}

function fireProcs(b, u, trigger, ctx) {
  if (!u.procs?.length || !u.alive || b.procDepth > 0) return;
  b.procDepth = (b.procDepth || 0) + 1;
  try {
    for (const p of u.procs) {
      if (p.trigger !== trigger) continue;
      if (p.once && p.used) continue;
      if (p.icd && b.time - p.lastAt < p.icd) continue;
      const f = p.filter;
      if (f?.ability && ctx.ability !== f.ability) continue;
      if (f?.area && !ctx.area) continue;
      if (f?.school && ctx.school !== f.school) continue;
      if (p.chance < 1 && b.rng() >= p.chance) continue;
      const targets = procTargets(b, u, p, ctx);
      if (!targets.length) continue;
      p.lastAt = b.time;
      p.used = true;
      emit(b, { type: 'proc', src: u.uid, name: p.name, tgt: targets[0].uid });
      for (const t of targets) applyProcEffect(b, u, t, p, ctx);
    }
  } finally {
    b.procDepth--;
  }
}

function applyProcEffect(b, u, t, p, ctx) {
  const e = p.effect;
  switch (e.kind) {
    case 'reflect': if (t.alive && ctx.amount) dealDamage(b, u, t, ctx.amount * e.pct, { school: 'physical', ignoreArmor: true, noCrit: true, proc: p.name }); break;
    case 'healPct': healUnit(b, u, t, t.maxHp * e.pct, null, null, p.name); break;
    case 'shieldPct': applyStatus(b, u, t, 'barrier', e.duration, t.maxHp * e.pct, 1); break;
    case 'cooldowns': for (const k in t.cooldowns) t.cooldowns[k] = Math.max(0, t.cooldowns[k] - e.seconds); break;
    default: applyEffect(b, u, t, { ...e, proc: p.name }, null);
  }
}

function healUnit(b, src, tgt, raw, ability, hot = null, proc = null) {
  if (!tgt.alive) return 0;
  let amount = raw * (1 + src.bonuses.healingPct) * Math.max(0, 1 + mod(tgt, 'healingTakenPct'));
  let crit = false;
  if (!hot && b.rng() < src.stats.critChance * 0.5) { crit = true; amount *= 1.5; }
  amount = Math.round(amount);
  const effective = Math.min(amount, tgt.maxHp - tgt.hp);
  tgt.hp += effective;
  emit(b, { type: 'heal', src: src.uid, tgt: tgt.uid, amount: effective, overheal: amount - effective, crit, ability, hot, ...(proc ? { proc } : {}) });
  if (ability && !hot && !proc) fireProcs(b, src, 'heal', { target: tgt, ability });
  // healing generates a little threat on all enemies
  if (effective > 0 && src.side === 'A') {
    for (const e of enemiesOf(b, src)) if (e.threatTable) e.threatTable[src.uid] = (e.threatTable[src.uid] || 0) + effective * 0.4;
  }
  return effective;
}

function kill(b, src, tgt) {
  tgt.alive = false;
  tgt.hp = 0;
  tgt.statuses = [];
  emit(b, { type: 'death', src: src.uid, tgt: tgt.uid });
  if (tgt.side === 'B') b.kills.push({ enemyId: tgt.defId, level: tgt.level, boss: !!tgt.boss, elite: !!tgt.tags?.includes('elite'), summoned: !!tgt.summoned });
  if (src !== tgt) fireProcs(b, src, 'kill', { target: tgt });
  b.hooks?.kill?.(b, src, tgt, HOOK_API);
}

function checkPhases(b, u) {
  const pct = hpPct(u);
  u.phases.forEach((p, i) => {
    if (u.phasesDone.includes(i) || pct >= p.hpBelow) return;
    u.phasesDone.push(i);
    emit(b, { type: 'phase', src: u.uid, message: `${u.name} ${p.message}` });
    for (const eff of p.effects) applyEffect(b, u, u, eff, null);
  });
}

// What battle hooks may do (kept small on purpose)
const HOOK_API = {
  applyStatus: (b, src, tgt, id, duration, value = 0, stacks = 1) => applyStatus(b, src, tgt, id, duration, value, stacks),
  heal: (b, src, tgt, amount) => healUnit(b, src, tgt, amount, null, null, 'affix'),
  damage: (b, src, tgt, amount, school = 'magical') => dealDamage(b, src, tgt, amount, { school, ability: null, ignoreArmor: true, noCrit: true, proc: 'affix' }),
  message: (b, src, message) => emit(b, { type: 'phase', src: src?.uid ?? 0, message }),
};

// ---------------------------------------------------------------- serialization for clients
export function publicUnit(u) {
  return {
    uid: u.uid, side: u.side, kind: u.kind, name: u.name, defId: u.defId, classId: u.classId || null,
    level: u.level, isMain: !!u.isMain, ownerName: u.ownerName || null, ownerId: u.ownerId || null, portrait: u.portrait || null,
    role: u.role || null, tags: u.tags, boss: !!u.boss, position: u.position,
    ...(u.kind === 'minion' ? { ownerUid: u.ownerUid, charId: u.charId, summonerName: u.summonerName, duration: u.duration } : {}),
    maxHp: u.maxHp, resourceMax: u.resourceMax, resourceColor: u.resourceDef?.color || null, resourceName: u.resourceDef?.name || null,
    loadout: u.loadout,
    ...dynamicUnit(u),
  };
}

export function dynamicUnit(u) {
  const cds = {};
  for (const k of u.loadout) cds[k] = Math.round((u.cooldowns[k] || 0) * 10) / 10;
  return {
    uid: u.uid, hp: Math.round(u.hp), maxHp: u.maxHp, alive: u.alive,
    resource: Math.round(u.resource || 0),
    cd: cds,
    st: u.statuses.map(s => [s.id, Math.round(s.remaining * 10) / 10, s.stacks]),
    ...(u.expiresAt != null ? { exp: Math.round(u.expiresAt * 10) / 10 } : {}), // battle time when a minion fades
  };
}

export function battleSnapshot(b) {
  return {
    time: Math.round(b.time * 10) / 10, state: b.state, wave: b.waveIndex + 1, waves: b.waves.length,
    units: b.units.map(publicUnit), meta: b.meta,
  };
}

// Run a battle to completion (used for offline progression & tests)
export function runToEnd(b, maxTicks = 100000) {
  let n = 0;
  while (b.state === 'running' && n++ < maxTicks) { stepBattle(b); b.events.length = 0; }
  return b;
}

export { DT as TICK_SECONDS };
// internals for tests
export const __test = { applyEffect };
export { alliesOf, enemiesOf };
