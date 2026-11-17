// Content validation: checks content/*.json (after overrides) for mistakes that would break the game —
// missing references (an ability that doesn't exist, an enemy in a zone that isn't defined, a status
// typo …), wrong value types and impossible settings. The server refuses to start with errors and
// prints exactly where the problem is. Run "npm run content:check" or type "content" in the console.
import { CONDITIONS, TARGET_CONDITIONS, SELECTORS } from '../shared/rules.js';
import { VIEW_IDS as TUTORIAL_VIEWS, METRIC_NAMES as TUTORIAL_METRICS } from '../shared/tutorialDefs.js';

const EFFECT_KINDS = ['damage', 'heal', 'status', 'shield', 'taunt', 'cleanse', 'resource', 'summon'];
const PROC_EFFECT_KINDS = [...EFFECT_KINDS, 'reflect', 'healPct', 'shieldPct', 'cooldowns'];
const PROC_TRIGGERS = ['hit', 'crit', 'struck', 'heal', 'kill', 'cast', 'lowHp'];
const PROC_TARGETS = ['self', 'target', 'source', 'randomEnemy', 'lowestAlly', 'allAllies'];
const POWER_STATS = ['physPower', 'magPower', 'healPower', 'defense', 'maxHp'];
const ATTRS = ['str', 'int', 'dex', 'vit'];
const AFFIX_MECHANICS = ['enemyStats', 'enemyDamageTaken', 'onEnemyDeath', 'enemyLowHealth', 'onEnemyHit', 'periodic'];
const TIP_CONDITIONS = ['anyOf', 'healsAllies', 'hasAbility', 'phaseStatus', 'appliesStatus', 'appliesStatuses', 'areaDamage', 'minHitPower', 'targetsSelectors', 'basicSchool', 'phaseSummons', 'enrages', 'hasTag'];
const QUEST_REQUIRES = ['rift', 'expedition', 'town', 'workers'];
const PASSIVES = ['damageVsBossPct', 'damageVsHighHpPct', 'costPct'];

export function validateContent(C) {
  const errors = [];
  const warnings = [];
  const err = (where, msg) => errors.push(`${where}: ${msg}`);
  const warn = (where, msg) => warnings.push(`${where}: ${msg}`);
  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  const num = (where, v, { min = -Infinity, max = Infinity, optional = false } = {}) => {
    if (v === undefined && optional) return;
    if (!isNum(v)) err(where, `must be a number (got ${JSON.stringify(v)})`);
    else if (v < min || v > max) err(where, `must be between ${min} and ${max} (got ${v})`);
  };
  const str = (where, v, optional = false) => { if (v === undefined && optional) return; if (typeof v !== 'string' || !v) err(where, 'must be a non-empty text'); };
  const ref = (where, id, coll, what) => { if (!coll || !(id in coll)) err(where, `unknown ${what} "${id}"`); };
  const obj = (where, v) => { if (!v || typeof v !== 'object' || Array.isArray(v)) { err(where, 'must be an object { … }'); return false; } return true; };

  const cfg = C.config, classes = C.classes?.classes || {}, abilities = C.abilities?.abilities || {}, statuses = C.statuses?.statuses || {};
  const items = C.items || {}, enemies = C.enemies?.enemies || {}, zones = C.zones?.zones || {}, town = C.town || {};
  const materials = { ...(town.materials || {}) };
  for (const s of town.shardStats || []) materials[`shard_${s.stat}`] = true;
  const rarities = new Set((cfg?.rarities || []).map(r => r.id));
  const affixStats = items.affixes || {};

  // ---- config
  if (obj('config', cfg)) {
    num('config.levelCap', cfg.levelCap, { min: 1, max: 1000 });
    num('config.xp.base', cfg.xp?.base, { min: 1 });
    num('config.xp.exponent', cfg.xp?.exponent, { min: 0, max: 10 });
    if (cfg.xp?.curve !== undefined) {
      const c = cfg.xp.curve;
      if (!Array.isArray(c) || c.length < 2) err('config.xp.curve', 'must be a list of at least 2 points [level, xp]');
      else {
        let last = 0, lastXp = 0;
        c.forEach((pt, i) => {
          if (!Array.isArray(pt) || pt.length !== 2 || !Number.isInteger(pt[0]) || !isNum(pt[1])) return err(`config.xp.curve[${i}]`, `must be [level, xp] with a whole level (got ${JSON.stringify(pt)})`);
          if (pt[0] < 1) err(`config.xp.curve[${i}]`, 'level must be at least 1');
          if (pt[0] <= last) err(`config.xp.curve[${i}]`, `levels must increase (level ${pt[0]} comes after ${last})`);
          if (pt[1] < 1) err(`config.xp.curve[${i}]`, 'xp must be at least 1');
          else if (pt[1] < lastXp) warn(`config.xp.curve[${i}]`, `level ${pt[0]} needs less XP than level ${last} — players level up faster there`);
          last = pt[0]; lastXp = Math.max(lastXp, pt[1]);
        });
      }
    }
    if (!Array.isArray(cfg.rarities) || !cfg.rarities.length) err('config.rarities', 'needs at least one rarity');
    (cfg.rarities || []).forEach((r, i) => { str(`config.rarities[${i}].id`, r.id); num(`config.rarities[${i}].weight`, r.weight, { min: 0 }); num(`config.rarities[${i}].mult`, r.mult, { min: 0 }); num(`config.rarities[${i}].affixes`, r.affixes, { min: 0 }); });
    for (const k of ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic']) if (!rarities.has(k)) err('config.rarities', `the game relies on the rarity "${k}"`);
    num('config.party.size', cfg.party?.size, { min: 1, max: 8 });
    num('config.combat.tickMs', cfg.combat?.tickMs, { min: 20, max: 1000 });
  }

  // ---- statuses
  for (const [id, s] of Object.entries(statuses)) {
    const w = `statuses.statuses.${id}`;
    str(`${w}.name`, s.name);
    if (!['buff', 'debuff'].includes(s.type)) err(`${w}.type`, 'must be "buff" or "debuff"');
    if (s.tick && !['damage', 'heal'].includes(s.tick)) err(`${w}.tick`, 'must be "damage" or "heal"');
    if (s.tick === 'damage' && !['physical', 'magical'].includes(s.school)) err(`${w}.school`, 'damage-over-time needs "physical" or "magical"');
  }

  // ---- abilities
  const checkEffect = (w, e, kinds = EFFECT_KINDS) => {
    if (!obj(w, e)) return;
    if (!kinds.includes(e.kind)) { err(`${w}.kind`, `unknown effect kind "${e.kind}" (use ${kinds.join(', ')})`); return; }
    if (['damage', 'heal', 'shield'].includes(e.kind)) { num(`${w}.power`, e.power, { min: 0 }); if (e.stat && !POWER_STATS.includes(e.stat)) err(`${w}.stat`, `must be one of ${POWER_STATS.join(', ')}`); }
    if (e.kind === 'damage' && e.school && !['physical', 'magical'].includes(e.school)) err(`${w}.school`, 'must be "physical" or "magical"');
    if (e.kind === 'status') { ref(`${w}.status`, e.status, statuses, 'status'); num(`${w}.duration`, e.duration, { min: 0 }); }
    if (e.kind === 'summon') ref(`${w}.enemyId`, e.enemyId, enemies, 'enemy');
  };
  const checkRule = (w, r) => {
    if (!r) return;
    for (const [i, c] of (r.conditions || []).entries()) if (!(c.type in CONDITIONS)) err(`${w}.conditions[${i}]`, `unknown condition "${c.type}"`);
    for (const [i, c] of (r.targetConditions || []).entries()) if (!(c.type in TARGET_CONDITIONS)) err(`${w}.targetConditions[${i}]`, `unknown target condition "${c.type}"`);
    if (r.target?.selector && !(r.target.selector in SELECTORS)) err(`${w}.target.selector`, `unknown target "${r.target.selector}"`);
  };
  for (const [id, a] of Object.entries(abilities)) {
    const w = `abilities.abilities.${id}`;
    str(`${w}.name`, a.name);
    if (a.classId !== 'enemy') ref(`${w}.classId`, a.classId, classes, 'class');
    if (!['enemy', 'ally', 'self'].includes(a.target)) err(`${w}.target`, 'must be "enemy", "ally" or "self"');
    num(`${w}.cooldown`, a.cooldown, { min: 0 });
    num(`${w}.cost`, a.cost, { min: 0, optional: true });
    num(`${w}.priority`, a.priority, { optional: true });
    if (a.classId !== 'enemy') num(`${w}.unlockLevel`, a.unlockLevel, { min: 1 });
    if (!Array.isArray(a.effects) || !a.effects.length) err(`${w}.effects`, 'needs at least one effect');
    (a.effects || []).forEach((e, i) => checkEffect(`${w}.effects[${i}]`, e));
    checkRule(`${w}.defaultRule`, a.defaultRule);
  }

  // ---- classes
  const roles = cfg?.roles || {};
  for (const [id, c] of Object.entries(classes)) {
    const w = `classes.classes.${id}`;
    str(`${w}.name`, c.name);
    ref(`${w}.role`, c.role, roles, 'role (config.roles)');
    for (const a of ATTRS) { num(`${w}.baseAttributes.${a}`, c.baseAttributes?.[a], { min: 0 }); num(`${w}.growth.${a}`, c.growth?.[a], { min: 0 }); }
    if (!obj(`${w}.scaling`, c.scaling)) continue;
    if (!c.resource?.id) err(`${w}.resource`, 'needs { id, name, max, start, regen }');
    if (!c.basicAttack?.stat) err(`${w}.basicAttack`, 'needs { name, stat, power, school }');
    if (!Object.values(abilities).some(a => a.classId === id)) err(w, `has no abilities (add abilities with "classId": "${id}" in content/abilities/)`);
    if (!C.skilltree?.specs?.[id]) err(w, `has no skill tree (add content/skilltree/${id}.json)`);
  }
  for (const [id, t] of Object.entries(C.classes?.traits || {})) { str(`classes.traits.${id}.name`, t.name); obj(`classes.traits.${id}.bonus`, t.bonus); }

  // ---- items
  const slots = items.slots || {};
  if (!Object.keys(slots).length) err('items.slots', 'no equipment slots defined');
  for (const [id, b] of Object.entries(items.bases || {})) {
    const w = `items.bases.${id}`;
    str(`${w}.name`, b.name);
    ref(`${w}.slot`, b.slot, slots, 'slot');
    for (const [k, v] of Object.entries(b.stats || {})) {
      if (!(k in affixStats)) err(`${w}.stats.${k}`, `unknown stat (use ${Object.keys(affixStats).join(', ')})`);
      if (!Array.isArray(v) || v.length !== 2 || !v.every(isNum)) err(`${w}.stats.${k}`, 'must be [base, perLevel]');
    }
    for (const c of b.classes || []) ref(`${w}.classes`, c, classes, 'class');
    if (b.material && !(b.material in (town.materialOfType || {}))) err(`${w}.material`, `must be one of ${Object.keys(town.materialOfType || {}).join(', ')}`);
  }
  for (const [k, a] of Object.entries(affixStats)) { str(`items.affixes.${k}.label`, a.label); num(`items.affixes.${k}.base`, a.base); num(`items.affixes.${k}.perLevel`, a.perLevel); }
  for (const s of items.pctStats || []) if (!(s in affixStats)) err('items.pctStats', `unknown stat "${s}"`);
  if (items.naming && !rarities.has(items.naming.suffixFromRarity)) err('items.naming.suffixFromRarity', 'unknown rarity');
  if (items.sockets && !rarities.has(items.sockets.guaranteedFromRarity)) err('items.sockets.guaranteedFromRarity', 'unknown rarity');

  // ---- enemies
  for (const [id, e] of Object.entries(enemies)) {
    const w = `enemies.enemies.${id}`;
    str(`${w}.name`, e.name);
    for (const k of ['hp', 'physPower', 'magPower', 'defense']) num(`${w}.stats.${k}`, e.stats?.[k], { min: 0 });
    if (!Array.isArray(e.tags)) err(`${w}.tags`, 'must be a list, e.g. ["beast"]');
    for (const a of e.abilities || []) { ref(`${w}.abilities`, a, abilities, 'ability'); if (abilities[a] && abilities[a].classId !== 'enemy') warn(`${w}.abilities`, `"${a}" is a player ability (classId ${abilities[a].classId})`); }
    (e.phases || []).forEach((ph, i) => { num(`${w}.phases[${i}].hpBelow`, ph.hpBelow, { min: 1, max: 99 }); (ph.effects || []).forEach((ef, j) => checkEffect(`${w}.phases[${i}].effects[${j}]`, ef)); });
  }

  // ---- zones & co-op
  for (const [id, z] of Object.entries(zones)) {
    const w = `zones.zones.${id}`;
    str(`${w}.name`, z.name);
    if (!Array.isArray(z.levelRange) || z.levelRange.length !== 2) err(`${w}.levelRange`, 'must be [min, max]');
    for (const e of z.enemies || []) ref(`${w}.enemies`, e, enemies, 'enemy');
    if (!z.enemies?.length) err(`${w}.enemies`, 'needs at least one enemy');
    if (z.boss) { ref(`${w}.boss`, z.boss, enemies, 'enemy'); if (enemies[z.boss] && !enemies[z.boss].boss) warn(`${w}.boss`, `"${z.boss}" is not marked "boss": true`); }
    if (z.unlock) ref(`${w}.unlock`, z.unlock, zones, 'zone');
  }
  if (!Object.values(zones).some(z => !z.unlock)) err('zones', 'at least one zone must be open from the start (no "unlock")');
  for (const [id, e] of Object.entries(C.zones?.coopEncounters || {})) {
    (e.waves || []).forEach((wave, i) => wave.forEach(en => ref(`zones.coopEncounters.${id}.waves[${i}]`, en, enemies, 'enemy')));
    num(`zones.coopEncounters.${id}.minLevel`, e.minLevel, { min: 1 });
  }

  // ---- uniques & sets
  const checkProc = (w, p) => {
    if (!PROC_TRIGGERS.includes(p.trigger)) err(`${w}.trigger`, `must be one of ${PROC_TRIGGERS.join(', ')}`);
    if (!PROC_TARGETS.includes(p.target)) err(`${w}.target`, `must be one of ${PROC_TARGETS.join(', ')}`);
    checkEffect(`${w}.effect`, p.effect, PROC_EFFECT_KINDS);
  };
  for (const [id, u] of Object.entries(C.legendaries?.uniques || {})) {
    const w = `legendaries.uniques.${id}`;
    ref(`${w}.baseId`, u.baseId, items.bases, 'item base');
    for (const k of Object.keys(u.stats || {})) if (!(k in affixStats)) err(`${w}.stats.${k}`, 'unknown stat');
    (u.procs || []).forEach((p, i) => checkProc(`${w}.procs[${i}]`, p));
    for (const k of Object.keys(u.passive || {})) if (!PASSIVES.includes(k)) err(`${w}.passive.${k}`, `unknown passive (use ${PASSIVES.join(', ')})`);
  }
  for (const [id, s] of Object.entries(C.legendaries?.sets || {})) {
    for (const b of Object.keys(s.pieces || {})) ref(`legendaries.sets.${id}.pieces`, b, items.bases, 'item base');
    for (const [n, bonus] of Object.entries(s.bonuses || {})) (bonus.procs || []).forEach((p, i) => checkProc(`legendaries.sets.${id}.bonuses.${n}.procs[${i}]`, p));
  }

  // ---- skill trees
  const treeStats = C.skilltree?.statLabels || {};
  for (const [cls, spec] of Object.entries(C.skilltree?.specs || {})) {
    const w = `skilltree.specs.${cls}`;
    ref(w, cls, classes, 'class');
    ref(`${w}.start`, spec.start, abilities, 'ability');
    if ((spec.branches || []).length !== 4) err(`${w}.branches`, 'needs exactly 4 branches');
    (spec.branches || []).forEach((br, i) => {
      for (const a of br.attrs || []) if (!ATTRS.includes(a)) err(`${w}.branches[${i}].attrs`, `"${a}" is not an attribute`);
      for (const a of Object.values(br.abilities || {})) { ref(`${w}.branches[${i}].abilities`, a, abilities, 'ability'); if (abilities[a] && abilities[a].classId !== cls) err(`${w}.branches[${i}].abilities`, `"${a}" belongs to ${abilities[a].classId}`); }
      for (const [r, n] of Object.entries(br.notables || {})) for (const k of Object.keys(n.stats || {})) {
        if (k === 'rank') { for (const a of Object.keys(n.stats.rank)) ref(`${w}.branches[${i}].notables.${r}.stats.rank`, a, abilities, 'ability'); }
        else if (!(k in treeStats)) err(`${w}.branches[${i}].notables.${r}.stats.${k}`, `unknown tree stat (see skilltree.json → statLabels)`);
      }
    });
  }

  // ---- town
  for (const [id, b] of Object.entries(town.buildings || {})) {
    const w = `town.buildings.${id}`;
    for (const k of Object.keys(b.cost || {})) if (k !== 'gold') ref(`${w}.cost`, k, materials, 'material');
    for (const k of Object.keys(b.costFrom || {})) ref(`${w}.costFrom`, k, materials, 'material');
    if (b.profession) ref(`${w}.profession`, b.profession, town.professions, 'profession');
    num(`${w}.maxLevel`, b.maxLevel, { min: 1 });
    if ((town.innRoster || []).length <= b.maxLevel && id === 'inn') err('town.innRoster', 'needs a value for every Inn level');
  }
  for (const req of ['town_hall', 'inn', 'salvage_yard', 'expedition_camp', 'jeweler']) if (!town.buildings?.[req]) err('town.buildings', `the game needs the building "${req}"`);
  for (const [id, e] of Object.entries(town.elixirs || {})) obj(`town.elixirs.${id}.bonus`, e.bonus);
  for (const [id, q] of Object.entries(town.qualities || {})) if (!rarities.has(q.minRarity)) err(`town.qualities.${id}.minRarity`, 'unknown rarity');
  for (const s of town.shardStats || []) if (!(s.stat in affixStats)) err('town.shardStats', `unknown stat "${s.stat}"`);
  for (const [t, m] of Object.entries(town.materialOfType || {})) ref(`town.materialOfType.${t}`, m, materials, 'material');

  // ---- expeditions
  for (const [id, x] of Object.entries(C.expeditions?.expeditions || {})) {
    for (const k of Object.keys(x.yields || {})) ref(`expeditions.expeditions.${id}.yields`, k, materials, 'material');
    for (const k of Object.keys(x.rare || {})) ref(`expeditions.expeditions.${id}.rare`, k, materials, 'material');
    if (x.bonus) ref(`expeditions.expeditions.${id}.bonus`, x.bonus, town.professions, 'profession');
  }

  // ---- achievements
  for (const [id, a] of Object.entries(C.achievements?.achievements || {})) { str(`achievements.achievements.${id}.stat`, a.stat); num(`achievements.achievements.${id}.goal`, a.goal, { min: 1 }); }

  // ---- quests
  const qc = C.quests?.config || {};
  for (const [id, t] of Object.entries(C.quests?.types || {})) {
    const w = `quests.types.${id}`;
    str(`${w}.title`, t.title);
    if (!t.title?.includes('{n}')) warn(`${w}.title`, 'has no {n} placeholder for the target');
    if (t.daily && t.target == null) err(`${w}.target`, 'daily quests need a target');
    if (t.weekly && t.weeklyTarget == null) err(`${w}.weeklyTarget`, 'weekly quests need a weeklyTarget');
    if (t.requires && !QUEST_REQUIRES.includes(t.requires)) err(`${w}.requires`, `must be one of ${QUEST_REQUIRES.join(', ')}`);
  }
  for (const [kind, r] of Object.entries(C.quests?.rewards || {})) {
    if (typeof r.crystals === 'string' && !(r.crystals in qc)) err(`quests.rewards.${kind}.crystals`, `"${r.crystals}" is not in quests.config`);
    for (const m of r.materials || []) for (const id of m.pool || [m.id]) ref(`quests.rewards.${kind}.materials`, id, materials, 'material');
    if (r.item && !rarities.has(r.item)) err(`quests.rewards.${kind}.item`, 'unknown rarity');
  }

  // ---- rifts
  const affixes = C.rifts?.affixes || {};
  for (const [id, a] of Object.entries(affixes)) {
    (a.mechanics || []).forEach((m, i) => {
      const w = `rifts.affixes.${id}.mechanics[${i}]`;
      if (!AFFIX_MECHANICS.includes(m.type)) err(`${w}.type`, `unknown mechanic (use ${AFFIX_MECHANICS.join(', ')})`);
      if (m.status) ref(`${w}.status`, m.status, statuses, 'status');
      if (m.type === 'periodic') num(`${w}.every`, m.every, { min: 0.5 });
    });
  }
  if (Object.keys(affixes).length < 3) err('rifts.affixes', 'needs at least 3 affixes (one per affix slot)');
  for (const a of C.rifts?.rotation?.firstAffix || []) ref('rifts.rotation.firstAffix', a, affixes, 'affix');
  for (const pair of C.rifts?.rotation?.mutuallyExclusive || []) for (const a of pair) ref('rifts.rotation.mutuallyExclusive', a, affixes, 'affix');
  for (const [, r] of C.rifts?.rewards?.chest?.rarityByTier || []) if (!rarities.has(r)) err('rifts.rewards.chest.rarityByTier', `unknown rarity "${r}"`);

  // ---- gems
  for (const s of Object.keys(affixStats)) if (!C.gems?.kinds?.[s]) err('gems.kinds', `no gem for the stat "${s}"`);
  (C.gems?.tiers || []).forEach((t, i) => {
    if (i === 0 && !t.cutCost) err('gems.tiers[0]', 'the first tier needs a cutCost');
    if (i > 0 && !t.fuseCost) err(`gems.tiers[${i}]`, 'needs a fuseCost');
    for (const k of Object.keys({ ...(t.cutCost?.mats || {}), ...(t.fuseCost?.mats || {}) })) ref(`gems.tiers[${i}]`, k, materials, 'material');
  });

  // ---- bestiary
  const checkTip = (w, cond) => {
    for (const [k, v] of Object.entries(cond || {})) {
      if (!TIP_CONDITIONS.includes(k)) err(w, `unknown tip condition "${k}"`);
      if (k === 'anyOf') v.forEach((c, i) => checkTip(`${w}.anyOf[${i}]`, c));
      if (k === 'hasAbility') ref(w, v, abilities, 'ability');
      if (k === 'appliesStatus' || k === 'phaseStatus') ref(w, v, statuses, 'status');
    }
  };
  (C.bestiary?.tips || []).forEach((t, i) => { checkTip(`bestiary.tips[${i}].if`, t.if); str(`bestiary.tips[${i}].text`, t.text); });

  // ---- loot filter & bots
  for (const [id, p] of Object.entries(C.lootfilter?.presets || {})) {
    if (!['keep', 'salvage', 'sell'].includes(p.rule?.action)) err(`lootfilter.presets.${id}.rule.action`, 'must be keep, salvage or sell');
    for (const r of p.rule?.rarities || []) if (!rarities.has(r)) err(`lootfilter.presets.${id}.rule.rarities`, `unknown rarity "${r}"`);
  }
  for (const [id, a] of Object.entries(C.bots?.archetypes || {})) for (const k of ['skill', 'activity', 'trader', 'crafter', 'rifter', 'social']) num(`bots.archetypes.${id}.${k}`, a[k], { min: 0, max: 1 });
  if (!(C.bots?.names || []).length) err('bots.names', 'needs at least one name');

  // ---- tutorial
  if (C.tutorial) {
    const T = C.tutorial, ids = new Set();
    const views = new Set([...TUTORIAL_VIEWS, '*']);
    for (const v of T.alwaysVisible || []) if (!views.has(v)) err('tutorial.alwaysVisible', `unknown page "${v}" (pages: ${TUTORIAL_VIEWS.join(', ')})`);
    if (!Array.isArray(T.steps)) err('tutorial.steps', 'must be a list');
    (T.steps || []).forEach((s, i) => {
      const w = `tutorial.steps[${i}]${s?.id ? ` (${s.id})` : ''}`;
      if (!s?.id || ids.has(s.id)) err(w, s?.id ? `id "${s.id}" is used twice` : 'needs an id');
      ids.add(s?.id);
      str(`${w}.title`, s?.title); str(`${w}.text`, s?.text);
      if (s?.view && !views.has(s.view)) err(`${w}.view`, `unknown page "${s.view}"`);
      (s?.highlight || []).forEach((h, j) => { if (!(typeof h === 'string' && h) && !(h && typeof h === 'object' && typeof h.el === 'string' && h.el && (h.done === undefined || typeof h.done === 'string'))) err(`${w}.highlight[${j}]`, 'must be a CSS selector or { "el": selector, "done": selector }'); });
      for (const v of s?.unlocks || []) if (!views.has(v)) err(`${w}.unlocks`, `unknown page "${v}" (pages: ${TUTORIAL_VIEWS.join(', ')})`);
      const g = s?.goal;
      const cond = (c, cw) => {
        if (!TUTORIAL_METRICS.includes(c?.metric)) err(`${cw}.metric`, `unknown metric "${c?.metric}" (metrics: ${TUTORIAL_METRICS.join(', ')})`);
        num(`${cw}.count`, c?.count, { min: 1 });
      };
      if (!g || typeof g !== 'object') err(`${w}.goal`, 'needs a goal');
      else if (g.type === 'ack') { /* Continue button */ }
      else if (g.any) { if (!Array.isArray(g.any) || !g.any.length) err(`${w}.goal.any`, 'must be a non-empty list'); else g.any.forEach((c, j) => cond(c, `${w}.goal.any[${j}]`)); }
      else cond(g, `${w}.goal`);
      const r = s?.reward;
      if (r) {
        for (const k of ['gold', 'premium', 'xp']) num(`${w}.reward.${k}`, r[k], { min: 0, optional: true });
        for (const [m, n] of Object.entries(r.materials || {})) { ref(`${w}.reward.materials`, m, materials, 'material'); num(`${w}.reward.materials.${m}`, n, { min: 0 }); }
        if (r.coverUpgrade !== undefined) ref(`${w}.reward.coverUpgrade`, r.coverUpgrade, town.buildings, 'building');
      }
    });
    if (T.enabled && (T.steps || []).length && !(T.steps || []).some(s => (s.unlocks || []).includes('*'))) warn('tutorial.steps', 'no step unlocks "*" — pages hidden during the tutorial only appear once it is finished or skipped');
  }

  // point messages at the file that contains the problem, e.g. "content/abilities/cleric/heal.json → effects[0].power: …"
  const files = C._meta?.files || {};
  const keys = Object.keys(files).sort((x, y) => y.length - x.length);
  const locate = msg => {
    const k = keys.find(key => msg.startsWith(`${key}.`) || msg.startsWith(`${key}:`) || msg.startsWith(`${key}[`));
    if (!k) return msg;
    const rest = msg.slice(k.length).replace(/^\./, '');
    return `${files[k]} → ${rest.startsWith(':') ? rest.slice(1).trim() : rest}`;
  };
  return { errors: errors.map(locate), warnings: warnings.map(locate) };
}
