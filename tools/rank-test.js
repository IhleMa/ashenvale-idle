// Rank effects of Warrior, Mage, Ranger, Warlock, Summoner and Chronomancer abilities: each one only at its rank,
// and doing what it says.
import assert from 'node:assert/strict';
const { createCharacter } = await import('../shared/character.js');
const C = await import('../shared/combat.js');
const { ABILITIES } = await import('../shared/data/abilities.js');

let n = 0;
const ok = m => { n++; console.log(`  ✔ ${m}`); };
// a level-40 character of a class with one ability at a rank, against 3 big trolls that don't act
function setup(classId, ability, rank, { foes = 3 } = {}) {
  const ch = createCharacter({ id: 'c', name: 'C', classId, level: 40, isMain: true, autoTree: false });
  ch.abilities = { ...ch.abilities, [ability]: rank };
  const b = C.createBattle({ seed: 4, allies: [C.makeCharacterUnit(ch, { ownerId: 'p', ownerName: 'P', position: 0 })], waves: [Array.from({ length: foes }, () => ({ enemyId: 'swamp_troll', level: 40 }))] });
  const me = b.units[0], enemies = b.units.filter(u => u.side === 'B');
  for (const e of enemies) { e.hp = e.maxHp = 1e7; e.actionTimer = 1e9; }
  me.actionTimer = 1e9; me.undying = true; b.rng = () => 0.5;
  const def = () => me.abilityDefs[ability] || ABILITIES[ability];
  const cast = (tgt = enemies[0]) => {
    me.cooldowns[ability] = 0;
    for (const eff of def().effects) C.__test.applyEffect(b, me, tgt, eff, ability);
  };
  return { b, me, enemies, def, cast };
}
const has = (u, id) => u.statuses.some(s => s.id === id);
const steps = (b, k) => { for (let i = 0; i < k; i++) C.stepBattle(b); };

{ // Heroic Strike 3
  const hit = (rank, frac) => { const x = setup('warrior', 'heroic_strike', rank); x.enemies[0].hp = 1e7 * frac; const before = x.enemies[0].hp; x.cast(); return before - x.enemies[0].hp; };
  assert.ok(Math.abs(hit(3, 0.4) / hit(3, 0.9) - 1.5) < 0.02 && Math.abs(hit(2, 0.4) / hit(2, 0.9) - 1) < 0.02);
  ok('Heroic Strike 3: second hit for 50% below 50% health');
}
{ // Battle Cry 2: +10 rage per buffed member (cast through act on the whole party: here one member)
  const x = setup('warrior', 'battle_cry', 2); x.me.resource = 0; x.cast(x.me);
  const y = setup('warrior', 'battle_cry', 1); y.me.resource = 0; y.cast(y.me);
  assert.equal(x.me.resource, 10); assert.equal(y.me.resource, 0);
  ok('Battle Cry 2: +10 Rage per buffed member');
}
{ // Shield Wall 3
  const x = setup('warrior', 'shield_wall', 3); x.cast(x.me);
  for (let i = 0; i < 5; i++) C.__test.applyEffect(x.b, x.enemies[0], x.me, { kind: 'damage', stat: 'physPower', power: 1, school: 'physical' }, null);
  steps(x.b, 90);
  const sh = x.me.statuses.find(s => s.id === 'barrier');
  assert.ok(!has(x.me, 'shield_wall') && sh?.value > 0, 'shield after the wall');
  const y = setup('warrior', 'shield_wall', 2); y.cast(y.me); C.__test.applyEffect(y.b, y.enemies[0], y.me, { kind: 'damage', stat: 'physPower', power: 1, school: 'physical' }, null); steps(y.b, 90);
  assert.ok(!has(y.me, 'barrier'));
  ok(`Shield Wall 3: shield of ${Math.round(sh.value)} from the prevented damage when it ends`);
}
{ // Frost Bolt 2
  const x = setup('mage', 'frost_bolt', 2);
  x.cast(); x.cast(); assert.ok(!has(x.enemies[0], 'stun')); x.cast(); assert.ok(has(x.enemies[0], 'stun'));
  const y = setup('mage', 'frost_bolt', 1); y.cast(); y.cast(); y.cast(); assert.ok(!has(y.enemies[0], 'stun'));
  ok('Frost Bolt 2: every third bolt on the same target freezes it');
}
{ // Flame Wave 3
  const x = setup('mage', 'flame_wave', 3); for (const e of x.enemies) x.cast(e);
  assert.ok(x.enemies.every(e => has(e, 'burn')));
  const y = setup('mage', 'flame_wave', 2); for (const e of y.enemies) y.cast(e); assert.ok(!y.enemies.some(e => has(e, 'burn')));
  ok('Flame Wave 3: burning ground on every enemy hit');
}
{ // Meteor 3
  const x = setup('mage', 'meteor', 3); x.enemies[0].hp = 1; x.me.cooldowns.meteor = 30; x.me.refunded = false;
  for (const eff of x.def().effects) C.__test.applyEffect(x.b, x.me, x.enemies[0], eff, 'meteor');
  assert.equal(x.me.cooldowns.meteor, 15);
  ok('Meteor 3: a kill gives back half the cooldown');
}
{ // Aimed Shot 3
  const crit = rank => { const x = setup('ranger', 'aimed_shot', rank); x.b.rng = () => 0.9; C.__test.applyEffect(x.b, x.me, x.enemies[0], { kind: 'status', status: 'marked', duration: 15 }, 'hunters_mark'); C.drainEvents(x.b); x.cast(); return C.drainEvents(x.b).find(e => e.type === 'damage' && e.ability === 'aimed_shot')?.crit; };
  assert.equal(crit(3), true); assert.equal(crit(2), false);
  ok('Aimed Shot 3: always crits on a marked target');
}
{ // Multi-Shot 2
  const x = setup('ranger', 'multi_shot', 2); x.b.rng = () => 0.1; for (const e of x.enemies) x.cast(e);
  assert.ok(x.enemies.every(e => has(e, 'poison')));
  const y = setup('ranger', 'multi_shot', 2); y.b.rng = () => 0.9; for (const e of y.enemies) y.cast(e);
  assert.ok(!y.enemies.some(e => has(e, 'poison')));
  ok('Multi-Shot 2: 25% chance per enemy for Serpent Sting poison');
}
{ // Rapid Fire 3
  const x = setup('ranger', 'rapid_fire', 3); x.cast(x.me); x.me.cooldowns.kill_shot = 10;
  C.__test.applyEffect(x.b, x.me, x.enemies[0], { kind: 'damage', stat: 'physPower', power: 1, school: 'physical' }, 'aimed_shot');
  assert.equal(x.me.cooldowns.kill_shot, 9);
  ok('Rapid Fire 3: hits lower Kill Shot\'s cooldown');
}
{ // Agony 3
  const x = setup('warlock', 'agony', 3); x.b.rng = () => 0.05; x.cast(); steps(x.b, 25);
  const k = x.enemies[0].statuses.filter(s => s.id === 'agony').length;
  const y = setup('warlock', 'agony', 2); y.b.rng = () => 0.05; y.cast(); steps(y.b, 25);
  assert.ok(k > 1 && y.enemies[0].statuses.filter(s => s.id === 'agony').length === 1, `${k} stacks`);
  ok(`Agony 3: ticks add stacks (${k} after 2.5 s with lucky rolls)`);
}
{ // Blight 2
  const x = setup('warlock', 'blight', 2); x.cast(); x.enemies[0].hp = 1;
  C.__test.applyEffect(x.b, x.me, x.enemies[0], { kind: 'damage', stat: 'magPower', power: 1, school: 'magical' }, null);
  assert.ok(!x.enemies[0].alive && x.enemies.slice(1).some(e => has(e, 'blight')));
  ok('Blight 2: spreads to another enemy on death');
}
{ // Dark Pact 3
  const x = setup('warlock', 'pact_of_shadows', 3); const hp0 = x.me.hp; x.cast(x.me); const paid = hp0 - x.me.hp;
  steps(x.b, 70);
  assert.ok(paid > 0 && x.me.hp >= hp0 - 2, `${x.me.hp} vs ${hp0}`);
  ok('Dark Pact 3: the health cost comes back over 6 s');
}
{ // Bone Golem 3, Summon Imps 2
  const x = setup('summoner', 'bone_golem', 3); x.cast(x.me);
  const golem = x.b.units.find(u => u.kind === 'minion');
  C.__test.applyEffect(x.b, x.enemies[0], golem, { kind: 'damage', stat: 'physPower', power: 1e5, school: 'physical' }, null);
  assert.ok(!golem.alive && x.me.statuses.find(s => s.id === 'barrier')?.value > 0);
  const y = setup('summoner', 'summon_imp', 2); y.cast(y.me);
  const imp = y.b.units.find(u => u.kind === 'minion');
  const hp = y.enemies.map(e => e.hp);
  C.__test.applyEffect(y.b, y.enemies[0], imp, { kind: 'damage', stat: 'physPower', power: 1e5, school: 'physical' }, null);
  assert.ok(y.enemies.every((e, i) => e.hp < hp[i]));
  ok('Bone Golem 3: bone shield on death; Summon Imps 2: imps explode on every enemy');
}
{ // Soul Link 3
  const x = setup('summoner', 'soul_link', 3); x.cast(x.me); x.me.hp = x.me.maxHp / 2; const h = x.me.hp;
  C.__test.applyEffect(x.b, x.enemies[0], x.me, { kind: 'damage', stat: 'physPower', power: 1, school: 'physical' }, null);
  const lost = h - x.me.hp;
  const y = setup('summoner', 'soul_link', 2); y.cast(y.me); y.me.hp = y.me.maxHp / 2; const h2 = y.me.hp;
  C.__test.applyEffect(y.b, y.enemies[0], y.me, { kind: 'damage', stat: 'physPower', power: 1, school: 'physical' }, null);
  assert.ok(lost < h2 - y.me.hp, 'heals back part of it');
  ok('Soul Link 3: heals for part of the damage linked allies take');
}
{ // Haste 3, Rewind 2, Time Dilation 3
  const x = setup('chronomancer', 'haste', 3); x.cast(x.me);
  assert.ok(x.me.statuses.some(s => s.freeCooldown));
  const r = setup('chronomancer', 'rewind', 2); C.__test.applyEffect(r.b, r.enemies[0], r.me, { kind: 'status', status: 'frostbite', duration: 6 }, null); C.__test.applyEffect(r.b, r.enemies[0], r.me, { kind: 'status', status: 'stun', duration: 3 }, null);
  r.cast(r.me); assert.ok(!r.me.statuses.some(s => ['frostbite', 'stun'].includes(s.id)));
  const t = setup('chronomancer', 'time_dilation', 3); t.cast(t.me); assert.ok(t.enemies.every(e => has(e, 'dilated')));
  ok('Haste 3: next ability free; Rewind 2: removes all debuffs; Time Dilation 3: enemies deal 10% less');
}
// Haste through the real cast loop: the hasted unit's next ability gets no cooldown
{
  const x = setup('chronomancer', 'haste', 3); x.cast(x.me);
  x.me.actionTimer = 0; x.me.resource = 999;
  for (let i = 0; i < 3 && !Object.entries(x.me.cooldowns).some(([a, v]) => a !== 'haste' && v === 0 && x.me.stat.casts[a]); i++) C.stepBattle(x.b);
  const used = Object.keys(x.me.stat.casts || {}).find(a => a !== 'haste');
  assert.ok(used && x.me.cooldowns[used] <= 0.2 && !x.me.statuses.some(s => s.freeCooldown), `${used} ${x.me.cooldowns[used]}`);
  ok(`Haste 3 in a fight: ${used} was cast without a cooldown`);
}
{ // Evasion 2
  const dodge = rank => { const x = setup('rogue', 'evasion', rank); x.cast(x.me); x.me.resource = 0; x.b.rng = () => 0.01;
    for (let i = 0; i < 3; i++) C.__test.applyEffect(x.b, x.enemies[0], x.me, { kind: 'damage', stat: 'physPower', power: 1, school: 'physical' }, null);
    return x.me.resource; };
  assert.equal(dodge(2), 15); assert.equal(dodge(1), 0);
  ok('Evasion 2: every dodged hit restores 5 Energy');
}
console.log(`rank-test: ${n} checks passed`);
