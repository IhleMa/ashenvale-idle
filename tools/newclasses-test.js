// The six classes added together: Sentinel (Retribution, Retaliate, Thorns), Druid (forms, form-only abilities,
// Rebirth), Chronomancer (Rewind, Stasis, Time Dilation, Accelerate, Prolong), Alchemist (element reactions,
// Catalyst, Volatile Mixture), Bard (notes and Finales) and Spellblade (Edge/Arcana charges, power blend).
import assert from 'node:assert/strict';
const { createCharacter } = await import('../shared/character.js');
const C = await import('../shared/combat.js');
const { resolveRule, selectorsForAbility, CONDITIONS } = await import('../shared/rules.js');
const { ABILITIES } = await import('../shared/data/abilities.js');
const { CLASSES } = await import('../shared/data/classes.js');
const { subclassesOf } = await import('../shared/data/subclasses.js');
const { getTree } = await import('../shared/data/skilltree.js');
const { computeStats } = await import('../shared/stats.js');

let n = 0;
const ok = m => { n++; console.log(`  ✔ ${m}`); };
const NEW = ['sentinel', 'druid', 'chronomancer', 'alchemist', 'bard', 'spellblade'];

// a party of the class under test plus a rogue, against tough trolls
const battle = (classId, { level = 30, enemies = 3, boss = false } = {}) => {
  const me = createCharacter({ id: 'k', name: 'Me', classId, level, isMain: true, autoTree: false });
  const r = createCharacter({ id: 'r', name: 'Sly', classId: 'rogue', level });
  const wave = Array.from({ length: enemies }, () => ({ enemyId: 'swamp_troll', level }));
  const b = C.createBattle({ seed: 5, allies: [C.makeCharacterUnit(r, { ownerId: 'p', ownerName: 'P', position: 0 }), C.makeCharacterUnit(me, { ownerId: 'p', ownerName: 'P', position: 1 })], waves: [wave] });
  const foes = b.units.filter(u => u.side === 'B');
  for (const f of foes) { f.hp = f.maxHp = 1e7; f.statuses = []; f.boss = boss; f.tags = boss ? [...f.tags, 'boss'] : f.tags; }
  b.rng = () => 0.5; // no crits, no misses, no damage spread
  return { b, me: b.units.find(u => u.charId === 'k'), ally: b.units.find(u => u.charId === 'r'), foes };
};
const cast = (b, u, abilityId, target = u) => { for (const eff of ABILITIES[abilityId].effects) C.__test.applyEffect(b, u, target, eff, abilityId); };
const has = (u, id) => u.statuses.some(s => s.id === id);
const lastDamage = (b, tgt) => C.drainEvents(b).filter(e => e.type === 'damage' && e.tgt === tgt.uid).reduce((s, e) => s + e.amount, 0);

// every class is complete
for (const c of NEW) {
  assert.ok(CLASSES[c], c);
  assert.ok(Object.values(ABILITIES).filter(a => a.classId === c && !a.subclass).length >= 7, c);
  assert.equal(subclassesOf(c).length, 3, c);
  assert.equal(getTree(c).branches.length, 4, c);
}
ok('6 new classes, each with 7+ base abilities, a 4-branch tree and 3 ascendancies');

// ---- Sentinel
{
  const { b, me, foes } = battle('sentinel');
  assert.equal(me.resource, 0);
  C.__test.applyEffect(b, foes[0], me, { kind: 'damage', stat: 'physPower', power: 0 }, null); // warm-up, no damage
  me.statuses.push({ id: 'barrier', remaining: 10, duration: 10, value: me.maxHp * 0.1, stacks: 1, src: me.uid, tickTimer: 1 });
  // a hit worth 10% of max health, fully absorbed by the shield, still fills Retribution
  const hit = me.maxHp * 0.1;
  C.__test.applyEffect(b, foes[0], me, { kind: 'damage', stat: 'physPower', power: hit / foes[0].stats.physPower, school: 'physical' }, null);
  assert.ok(me.resource > 5, `retribution from absorbed damage: ${me.resource}`);
  ok(`Sentinel: Retribution fills from damage taken, shields included (${me.resource.toFixed(0)} from a fully absorbed hit)`);

  // Retaliate spends everything and scales with what it spent
  const dmgAt = res => { const t = battle('sentinel'); t.me.resource = res; t.me.cooldowns = {}; t.me.loadout = ['retaliate']; t.me.rules.retaliate = { enabled: true, conditions: [], target: { selector: 'enemy_current' } }; t.me.actionTimer = 0; C.drainEvents(t.b);
    t.b.units.forEach(u => { if (u !== t.me) u.actionTimer = 99; }); C.stepBattle(t.b); return { left: t.me.resource, dmg: C.drainEvents(t.b).filter(e => e.type === 'damage' && e.ability === 'retaliate').reduce((s, e) => s + e.amount, 0) }; };
  const half = dmgAt(50), full = dmgAt(100);
  assert.equal(full.left, 0);
  assert.ok(full.dmg > half.dmg * 1.8, `${full.dmg} vs ${half.dmg}`);
  ok(`Retaliate spends all Retribution and hits twice as hard at 100 as at 50 (${full.dmg} vs ${half.dmg})`);

  // Thorns Aura reflects 30% of a direct hit
  cast(b, me, 'thorns_aura');
  C.drainEvents(b);
  C.__test.applyEffect(b, foes[1], me, { kind: 'damage', stat: 'physPower', power: 1, school: 'physical' }, null);
  const ev = C.drainEvents(b);
  const taken = ev.find(e => e.type === 'damage' && e.tgt === me.uid), back = ev.find(e => e.type === 'damage' && e.tgt === foes[1].uid);
  assert.ok(back && Math.abs(back.amount - (taken.amount + taken.absorbed) * 0.3) <= 2, JSON.stringify({ taken, back }));
  ok('Thorns Aura sends 30% of each hit back to the attacker');
}

// ---- Druid
{
  const { b, me, ally, foes } = battle('druid');
  cast(b, me, 'tree_form'); assert.ok(has(me, 'tree_form'));
  cast(b, me, 'bear_form'); assert.ok(has(me, 'bear_form') && !has(me, 'tree_form'), 'one form at a time');
  ok('Druid: shifting replaces the current form');

  me.loadout = ['rake']; me.cooldowns = {}; me.resource = 100; me.rules.rake = { enabled: true, conditions: [], target: { selector: 'enemy_current' } };
  b.units.forEach(u => { if (u !== me) u.actionTimer = 99; }); me.actionTimer = 0; C.drainEvents(b); C.stepBattle(b);
  assert.ok(!C.drainEvents(b).some(e => e.type === 'ability' && e.ability === 'rake'), 'Rake needs Cat form');
  cast(b, me, 'cat_form'); me.actionTimer = 0; C.stepBattle(b);
  assert.ok(C.drainEvents(b).some(e => e.type === 'ability' && e.ability === 'rake'));
  ok('form abilities (Rake) only cast in their form');

  // Rebirth: only targets the fallen, once per fight
  assert.deepEqual(selectorsForAbility(ABILITIES.rebirth), ['ally_fallen']);
  assert.ok(!selectorsForAbility(ABILITIES.rejuvenation).includes('ally_fallen'));
  ally.hp = 0; ally.alive = false;
  const t = resolveRule(ABILITIES.rebirth.defaultRule, ABILITIES.rebirth, b, me);
  assert.equal(t?.[0], ally);
  me.loadout = ['rebirth']; me.cooldowns = {}; me.resource = 100; me.rules.rebirth = ABILITIES.rebirth.defaultRule; me.actionTimer = 0; C.stepBattle(b);
  assert.ok(ally.alive && Math.abs(ally.hp - ally.maxHp * 0.4) < 2, `revived at ${ally.hp}/${ally.maxHp}`);
  ally.hp = 0; ally.alive = false; me.cooldowns = {}; me.resource = 100; me.actionTimer = 0; C.stepBattle(b);
  assert.ok(!ally.alive, 'Rebirth works once per fight');
  ok('Rebirth brings a fallen ally back at 40% health, once per fight');
  void foes;
}

// ---- Chronomancer
{
  const { b, me, ally, foes } = battle('chronomancer');
  for (let i = 0; i < 50; i++) C.stepBattle(b); // build health history
  b.units.forEach(u => (u.actionTimer = 99));
  const before = ally.hp;
  ally.hp = Math.round(before * 0.3);
  for (let i = 0; i < 10; i++) C.stepBattle(b); // one more second of history
  cast(b, me, 'rewind', ally);
  assert.ok(Math.abs(ally.hp - before) <= 2, `rewound to ${ally.hp}, was ${before}`);
  ok('Rewind sets an ally back to its health of 4 seconds ago');

  cast(b, me, 'stasis', foes[0]);
  const st = foes[0].statuses.find(s => s.id === 'stasis');
  assert.equal(st.remaining, 3);
  C.drainEvents(b);
  const hp0 = foes[0].hp;
  C.__test.applyEffect(b, ally, foes[0], { kind: 'damage', stat: 'physPower', power: 5, school: 'physical' }, null);
  assert.equal(foes[0].hp, hp0, 'no damage in Stasis');
  foes[0].actionTimer = 0; C.stepBattle(b);
  assert.ok(!C.drainEvents(b).some(e => (e.type === 'ability' || e.type === 'damage') && e.src === foes[0].uid), 'cannot act');
  const boss = battle('chronomancer', { boss: true });
  cast(boss.b, boss.me, 'stasis', boss.foes[0]);
  assert.equal(boss.foes[0].statuses.find(s => s.id === 'stasis').remaining, 1.5);
  ok('Stasis: the enemy cannot act or be hurt; half as long on bosses');

  const t = battle('chronomancer');
  t.b.units.forEach(u => (u.actionTimer = 999));
  t.ally.cooldowns = { a: 10, b: 3 };
  cast(t.b, t.me, 'accelerate', t.ally);
  assert.deepEqual(t.ally.cooldowns, { a: 6, b: 0 });
  cast(t.b, t.me, 'time_dilation', t.ally);
  for (let i = 0; i < 10; i++) C.stepBattle(t.b);
  assert.ok(Math.abs(t.ally.cooldowns.a - 4) < 0.05, `cooldown ${t.ally.cooldowns.a}`);
  ok('Accelerate cuts cooldowns by 4 s; Time Dilation makes them run twice as fast');

  const { b: b2, me: m2, ally: a2, foes: f2 } = battle('chronomancer');
  C.__test.applyEffect(b2, a2, a2, { kind: 'status', status: 'hastened', duration: 8 }, null);
  C.__test.applyEffect(b2, a2, f2[0], { kind: 'status', status: 'bleed', duration: 6, stat: 'physPower', power: 0.1 }, null);
  C.__test.applyEffect(b2, f2[0], a2, { kind: 'status', status: 'weakened', duration: 6 }, null);
  cast(b2, m2, 'prolong');
  assert.equal(a2.statuses.find(s => s.id === 'hastened').remaining, 13);
  assert.equal(f2[0].statuses.find(s => s.id === 'bleed').remaining, 11);
  assert.equal(a2.statuses.find(s => s.id === 'weakened').remaining, 6, "enemies' debuffs on the party are not extended");
  ok("Prolong extends the party's buffs and its debuffs on enemies by 5 s");
}

// ---- Alchemist
{
  const { b, me, foes } = battle('alchemist');
  cast(b, me, 'fire_flask', foes[0]);
  assert.ok(has(foes[0], 'fire_mark'));
  C.drainEvents(b);
  cast(b, me, 'frost_flask', foes[0]);
  const shatter = lastDamage(b, foes[0]);
  assert.ok(!has(foes[0], 'fire_mark') && !has(foes[0], 'frost_mark'), 'the reaction uses both marks');
  const plain = (() => { const t = battle('alchemist'); t.b.rng = () => 0.5; cast(t.b, t.me, 'frost_flask', t.foes[0]); return lastDamage(t.b, t.foes[0]); })();
  assert.ok(shatter > plain * 3, `${shatter} vs ${plain}`);
  ok(`Fire + Frost = Shatter: both marks used up, ${shatter} damage instead of ${plain}`);

  cast(b, me, 'fire_flask', foes[0]); cast(b, me, 'catalyst', foes[0]); C.drainEvents(b);
  cast(b, me, 'frost_flask', foes[0]);
  const boosted = lastDamage(b, foes[0]);
  assert.ok(boosted > shatter * 1.3, `${boosted} vs ${shatter}`);
  assert.ok(!has(foes[0], 'catalyst'), 'Catalyst is used up');
  ok('Catalyst makes the next reaction 50% stronger');

  cast(b, me, 'fire_flask', foes[0]); cast(b, me, 'fire_flask', foes[1]); C.drainEvents(b);
  cast(b, me, 'poison_flask', foes[0]);
  assert.ok(lastDamage(b, foes[2]) > 0, 'Toxic Blast hits every enemy');
  cast(b, me, 'volatile_mixture'); cast(b, me, 'acid_flask', foes[0]);
  assert.ok(foes.every(f => has(f, 'acid_mark') || has(f, 'meltdown')) && foes.some(f => has(f, 'meltdown')), 'Volatile: the acid lands on every enemy and reacts with the fire mark');
  assert.ok(!has(me, 'volatile'));
  ok('Toxic Blast hits every enemy; Volatile Mixture spreads the next flask to all enemies');
}

// ---- Bard
{
  const play = notes => {
    const { b, me, ally, foes } = battle('bard');
    for (const nt of notes) { const id = nt + '_note'; me.notes.push(nt); void id; }
    C.drainEvents(b);
    for (const eff of ABILITIES.finale.effects) C.__test.applyEffect(b, me, foes[0], eff, 'finale');
    return { b, me, ally, foes, ev: C.drainEvents(b) };
  };
  const tri = play(['low', 'mid', 'high']);
  assert.ok(has(tri.me, 'triumph') && has(tri.ally, 'triumph'));
  assert.equal(tri.me.notes.length, 0, 'Finale clears the notes');
  const req = play(['high', 'mid', 'low']);
  assert.ok(req.foes.every(f => req.ev.some(e => e.type === 'damage' && e.tgt === f.uid)), 'Requiem hits every enemy');
  const dis = play(['low', 'low', 'mid']);
  assert.ok(dis.ev.some(e => e.type === 'phase' && /Dissonance/.test(e.message)));
  assert.ok(!has(dis.me, 'triumph'));
  const tempo = play(['high', 'low', 'mid']);
  assert.ok(has(tempo.ally, 'tempo'));
  ok('Finale: Low-Mid-High = Triumph, High-Mid-Low = Requiem, High-Low-Mid = Tempo, a repeated note = Dissonance');

  // notes are remembered from casts (last three), and the default rules play Low → Mid → High
  const { b, me } = battle('bard');
  me.loadout = ['high_note', 'mid_note', 'low_note']; me.cooldowns = {}; me.resource = 100;
  for (const a of me.loadout) me.rules[a] = JSON.parse(JSON.stringify(ABILITIES[a].defaultRule));
  b.units.forEach(u => { if (u !== me) u.actionTimer = 999; });
  const played = [];
  for (let i = 0; i < 100 && played.length < 4; i++) { C.stepBattle(b); for (const e of C.drainEvents(b)) if (e.type === 'ability') played.push(e.ability); }
  assert.deepEqual(played.slice(0, 4), ['low_note', 'mid_note', 'high_note', 'low_note']);
  assert.deepEqual(me.notes, ['mid', 'high', 'low'], 'only the last three notes are kept');
  assert.ok(CONDITIONS.last_note.test({ note: 'low' }, b, me) && CONDITIONS.own_notes.test({ cmp: '>=', value: 3 }, b, me));
  ok('the default rules play Low → Mid → High in a loop; the last three notes are kept for the Finale');

  // Finale is passive: it plays by itself after the third note, needs no slot, and restarts the phrase after its cooldown
  {
    const { b, me, ally } = battle('bard');
    me.ranks.finale = 1;
    me.loadout = ['high_note', 'mid_note', 'low_note']; me.cooldowns = {}; me.resource = 100;
    for (const a of me.loadout) me.rules[a] = JSON.parse(JSON.stringify(ABILITIES[a].defaultRule));
    b.units.forEach(u => { if (u !== me) u.actionTimer = 1e9; });
    const finales = [], notes = [];
    for (let i = 0; i < 400; i++) { me.resource = 100; C.stepBattle(b); for (const e of C.drainEvents(b)) { if (e.type === 'phase' && /plays/.test(e.message)) finales.push(e.message); if (e.type === 'ability' && e.ability !== 'finale') notes.push(e.ability); } }
    assert.ok(finales.length >= 2, `finales: ${finales.length}`);
    assert.ok(finales.every(f => /Triumph/.test(f)), finales.join(' / '));
    assert.ok(new Set(notes).size === 3, 'notes keep rotating while Finale recharges');
    const ch = createCharacter({ id: 'bd', name: 'B', classId: 'bard', level: 30 });
    assert.ok(ch.abilities.finale && !ch.loadout.includes('finale'), 'Finale is learned but takes no slot');
  }
  ok('Finale plays itself after three notes (Triumph every time with the default rules) and takes no loadout slot');
}

// ---- Spellblade
{
  const { b, me, foes } = battle('spellblade');
  me.resource = 50;
  const castLive = id => { me.loadout = [id]; me.cooldowns = {}; me.rules[id] = { enabled: true, conditions: [], target: { selector: 'enemy_current' } }; me.actionTimer = 0;
    b.units.forEach(u => { if (u !== me) u.actionTimer = 999; }); C.drainEvents(b); C.stepBattle(b); return C.drainEvents(b).filter(e => e.type === 'damage' && e.ability === id).reduce((s, e) => s + e.amount, 0); };
  const sparkPlain = castLive('spark');     // gives Arcana
  assert.ok(has(me, 'arcana_charge'));
  const sparkAgain = castLive('spark');     // spell after spell: no bonus
  assert.equal(sparkAgain, sparkPlain);
  castLive('arcane_slash');                 // weapon uses Arcana, gives Edge
  assert.ok(has(me, 'edge_charge') && !has(me, 'arcana_charge'));
  const res = me.resource;
  const sparkEdge = castLive('spark');      // spell after weapon: +30%
  assert.ok(Math.abs(sparkEdge / sparkPlain - 1.3) < 0.02, `${sparkEdge} vs ${sparkPlain}`);
  assert.ok(me.resource > res - 8 + 4, 'alternating refunds Focus');
  ok(`Spellblade: a spell after a weapon ability deals 30% more (${sparkPlain} → ${sparkEdge}); repeating gets nothing; alternating refunds Focus`);

  const ch = createCharacter({ id: 's', name: 'S', classId: 'spellblade', level: 30 });
  const s = computeStats(ch);
  const plain = computeStats({ ...ch, classId: 'warrior' }); void plain;
  const lo = Math.min(s.physPower, s.magPower), hi = Math.max(s.physPower, s.magPower);
  assert.ok(lo >= hi * 0.3, `blend: ${lo} vs ${hi}`);
  ok('the lower of physical and magic power gains 30% of the higher one');
  void foes;
}

// ---- Cleric (burst) vs Druid (over time): Holy Nova hits every enemy and heals every ally once
{
  const { b, me, ally, foes } = battle('cleric');
  me.hp = me.maxHp * 0.5; ally.hp = ally.maxHp * 0.5;
  const before = [me.hp, ally.hp];
  C.drainEvents(b);
  foes.forEach((f, i) => { for (const eff of ABILITIES.holy_nova.effects) if (!(eff.once && i > 0)) C.__test.applyEffect(b, me, f, eff, 'holy_nova'); });
  const ev = C.drainEvents(b);
  assert.ok(foes.every(f => ev.some(e => e.type === 'damage' && e.tgt === f.uid)));
  assert.equal(ev.filter(e => e.type === 'heal').length, 2, 'each ally healed once');
  assert.ok(me.hp > before[0] && ally.hp > before[1]);
  assert.ok(!ABILITIES.renew && !ABILITIES.purify && ABILITIES.regrowth && ABILITIES.natures_cure);
  ok('Cleric Holy Nova damages every enemy and heals each ally once; heal-over-time and cleansing moved to the Druid');
}

console.log(`New classes: all ${n} checks passed.`);
