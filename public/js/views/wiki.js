// Wiki: game mechanics, classes, abilities, skill trees, ascendancies, statuses, items, town, expeditions and
// zones — built live from the content files, so it always matches the game (including admin overrides).
import { esc } from '../ui.js';
import { classIcon, abilityIcon } from '../assets.js';
import { CONFIG } from '/shared/config.js';
import { CLASSES, CLASS_IDS } from '/shared/data/classes.js';
import { ABILITIES, classAbilities } from '/shared/data/abilities.js';
import { STATUSES } from '/shared/data/statuses.js';
import { SUBCLASSES, subclassesOf } from '/shared/data/subclasses.js';
import { TREE_SPECS, describeNodeStats } from '/shared/data/skilltree.js';
import { MINIONS } from '/shared/data/minions.js';
import { SELECTORS, CONDITIONS, TARGET_CONDITIONS, describeCondition } from '/shared/rules.js';
import { SLOTS, SLOT_IDS, ITEM_BASES, AFFIXES } from '/shared/data/items.js';
import { UNIQUES, SETS } from '/shared/data/legendaries.js';
import { BUILDINGS, MATERIALS, buildingEffects } from '/shared/data/town.js';
import { EXPEDITIONS, EXPEDITION_DURATIONS } from '/shared/data/expeditions.js';
import { ZONES } from '/shared/data/zones.js';
import { ENEMIES } from '/shared/data/enemies.js';
import { ATTRIBUTES } from '/shared/stats.js';
import { FEATURE_LABELS } from '/shared/unlocks.js';

const ui = { page: 'mech:basics', search: '' };

// ---------------------------------------------------------------- small text helpers
const pct = (v, d = 0) => `${(Math.round(v * 100 * 10 ** d) / 10 ** d)}%`;
const signed = v => `${v > 0 ? '+' : ''}${pct(v)}`;
const STAT = { physPower: 'physical power', magPower: 'magic power', healPower: 'healing power', maxHp: 'maximum health', defense: 'defense', hp: 'health', critChance: 'critical chance', attackSpeed: 'attack speed' };
const statName = s => STAT[s] || s || 'power';
const sec = s => `${Math.round(s * 10) / 10} s`;
const link = (page, text, title = '') => `<a href="javascript:void 0" data-wiki="${esc(page)}"${title ? ` title="${esc(title)}"` : ''}>${text}</a>`;
const statusLink = id => (STATUSES[id] ? link(`status:${id}`, esc(STATUSES[id].name), STATUSES[id].description) : esc(id));
const abilityLink = id => (ABILITIES[id] ? link(`ability:${id}`, esc(ABILITIES[id].name)) : esc(id));
const resourceName = classId => CLASSES[classId]?.resource?.name || 'resource';

const MOD_TEXT = {
  damagePct: v => `${signed(v)} damage dealt`, damageTakenPct: v => `${signed(v)} damage taken`, defensePct: v => `${signed(v)} defense`,
  attackSpeedPct: v => `${signed(v)} attack and cast speed`, healingTakenPct: v => `${signed(v)} healing received`, healingDonePct: v => `${signed(v)} healing done`,
  dotTakenPct: v => `${signed(v)} damage taken from damage over time`, dotSpeedPct: v => `own damage over time ticks ${signed(v)} faster`, dodge: v => `${pct(v)} chance to dodge physical hits`,
  thornsPct: v => `attackers take ${pct(v)} of their hit back`, invulnerable: () => 'takes no damage', undying: () => 'cannot drop below 1 health',
  cooldownRatePct: v => `cooldowns run ${signed(v)} faster`, resourceRegenPct: v => `${signed(v)} resource regeneration`, threatPct: v => `${signed(v)} threat`,
  critChance: v => `${signed(v)} critical chance`, reactionPct: v => `next reaction ${signed(v)} stronger`, chainReaction: () => 'reactions repeat on another enemy at half strength',
  costPct: v => `abilities cost ${signed(v)}`,
};
const modsText = mods => Object.entries(mods || {}).map(([k, v]) => (MOD_TEXT[k] ? MOD_TEXT[k](v) : `${k} ${v}`));

function statusFacts(id) {
  const s = STATUSES[id];
  if (!s) return [];
  const f = [];
  if (s.tick === 'damage') f.push(`deals ${s.school || 'physical'} damage every second${s.ignoreArmor ? ', ignores armor' : ''}${s.canCrit ? ', each tick can crit' : ', ticks never crit'}`);
  if (s.tick === 'heal') f.push('heals every second');
  f.push(...modsText(s.mods));
  if (s.maxStacks) f.push(`stacks up to ${s.maxStacks}×`);
  if (s.stacking === 'independent') f.push('no stack limit: every application is a separate stack with its own timer');
  if (s.group) f.push(`only one "${s.group}" per caster at a time`);
  if (s.control === 'stun') f.push(`cannot act${s.bossDurationMult != null && s.bossDurationMult !== 1 ? `; lasts ${pct(s.bossDurationMult)} as long on bosses` : ''}`);
  if (s.element) f.push(`${s.element} element mark`);
  if (s.charge) f.push(s.charge === 'both' ? 'counts as Edge and Arcana for every ability' : `${s.charge === 'edge' ? 'Edge' : 'Arcana'} charge`);
  if (s.freeCast) f.push('the next ability costs nothing');
  if (s.volatile) f.push('the next element flask lands on every enemy');
  if (s.jumpOnDeath) f.push('jumps to another enemy when its target dies');
  if (s.tickOnApply) f.push('first tick right away');
  if (s.recordDamage) f.push(`records all damage taken; deals ${pct(s.explodePct ?? 1)} of it again when it expires`);
  return f;
}

function effText(eff, classId) {
  const pw = (power, stat) => `${pct(power)} of ${statName(stat)}`;
  switch (eff.kind) {
    case 'damage': {
      const hits = eff.hits || 1;
      let t = `deals ${pw(eff.power * hits, eff.stat)}${eff.perSpent ? ` per point of ${resourceName(classId)} spent` : ''} as ${eff.school || 'physical'} damage${hits > 1 ? ` in ${hits} hits` : ''}`;
      if (eff.bonusCrit) t += ` (${signed(eff.bonusCrit)} critical chance)`;
      if (eff.executeBelow) t += `, ×${eff.executeMult || 2} against targets below ${pct(eff.executeBelow)} health`;
      if (eff.splash) t += `, and ${pct(eff.splash)} of that to every other enemy`;
      if (eff.lifesteal || eff.lifestealPerDebuff) t += `, healing the caster for ${pct(eff.lifesteal || 0)}${eff.lifestealPerDebuff ? ` + ${pct(eff.lifestealPerDebuff)} per own debuff on the target` : ''} of the damage`;
      return t;
    }
    case 'heal': return `heals ${eff.allies ? 'every ally ' : eff.self ? 'the caster ' : ''}for ${pw(eff.power, eff.stat)}`;
    case 'status': {
      const s = STATUSES[eff.status];
      const dur = eff.duration >= 900 ? 'until changed' : `for ${sec(eff.duration)}`;
      let t = `${eff.self ? 'gains' : 'applies'} ${statusLink(eff.status)} ${dur}`;
      if (s?.tick && eff.power) t += ` (${pw(eff.power, eff.stat)} ${s.tick === 'heal' ? 'healing' : 'damage'} per second)`;
      if (eff.stacks > 1) t += ` ×${eff.stacks}`;
      return t;
    }
    case 'shield': return `${eff.self ? 'shields the caster' : 'shields'} for ${pw(eff.power, eff.stat)} for ${sec(eff.duration)}`;
    case 'taunt': return `taunts enemies for ${sec(eff.duration || 0)}`;
    case 'cleanse': return `removes up to ${eff.count || 1} harmful effect${(eff.count || 1) > 1 ? 's' : ''}`;
    case 'resource': return `gives ${eff.amount} ${resourceName(classId)}`;
    case 'summon': return eff.minion ? `summons ${eff.count || 1}× ${esc(MINIONS[eff.minion]?.name || eff.minion)}${eff.max ? ` (up to ${eff.max}; at the limit the oldest is renewed)` : ''}` : `summons ${esc(ENEMIES[eff.enemyId]?.name || eff.enemyId)}`;
    case 'sacrifice': return `detonates ${eff.all ? 'every minion' : `${eff.count || 1} minion${(eff.count || 1) > 1 ? 's' : ''} (the one closest to fading first)`}, each dealing ${pct(eff.power)} of its maximum health to every enemy`;
    case 'extend': return `makes the minion last ${sec(eff.seconds)} longer`;
    case 'consume_dots': return `removes ${eff.own ? 'its own' : 'all'} damage over time on the target and deals ${pw(eff.power, eff.stat)} for every second they had left${eff.mark ? `; ×${eff.markMult} on targets with ${statusLink(eff.mark)}${eff.markExecute ? `, which also kills non-bosses below ${pct(eff.markExecute)} health` : ''}` : ''}${eff.splash ? `; ${pct(eff.splash)} of it splashes to other enemies` : ''}${eff.refundPerStack ? `; refunds ${eff.refundPerStack} ${resourceName(classId)} per stack` : ''}`;
    case 'spread_dots': return 'copies its own damage over time effects from the target to every other enemy';
    case 'self_damage': return `costs ${pct(eff.pct)} of current health (never lethal)`;
    case 'revive': return `brings a fallen ally back with ${pct(eff.pct)} health`;
    case 'rewind': return `sets health back to what it was ${sec(eff.seconds)} ago (only if that was more)`;
    case 'echo': return `deals ${pct(eff.power)} of the health the target lost in the last ${sec(eff.seconds)} again`;
    case 'reduce_cooldowns': return `cuts every cooldown of ${eff.self ? 'the caster' : 'the target'} by ${sec(eff.seconds)}`;
    case 'prolong': return `makes the party's buffs and its debuffs on enemies last ${sec(eff.seconds)} longer`;
    case 'finale': return 'plays back the last three notes (see Finales below)';
    default: return eff.kind;
  }
}

function abilityFacts(a) {
  const f = [];
  const target = { enemy: a.area ? 'every enemy' : 'one enemy', ally: a.area ? 'every ally' : 'one ally', self: 'the caster' }[a.target] || a.target;
  f.push(['Targets', target]);
  f.push(['Cost', a.spendAll ? `${a.cost} + all remaining ${resourceName(a.classId)}` : a.cost ? `${a.cost} ${resourceName(a.classId)}` : 'free']);
  f.push(['Cooldown', a.cooldown ? sec(a.cooldown) : 'none']);
  if (a.requiresStatus) f.push(['Only in', statusLink(a.requiresStatus)]);
  if (a.oncePerFight) f.push(['Limit', 'once per fight']);
  if (a.note) f.push(['Note', `plays a ${a.note === 'low' ? 'Low' : a.note === 'mid' ? 'Mid' : 'High'} note`]);
  if (a.blade) f.push(['Kind', a.blade === 'weapon' ? 'weapon ability: uses Arcana, leaves Edge' : 'spell: uses Edge, leaves Arcana']);
  return f;
}

function ruleText(a) {
  const r = a.defaultRule || {};
  const when = (r.conditions || []).filter(c => c.type !== 'always').map(describeCondition);
  const only = (r.targetConditions || []).map(describeCondition);
  const target = SELECTORS[r.target?.selector]?.label || r.target?.selector || '—';
  return `${when.length ? `when ${when.join(r.mode === 'any' ? ' or ' : ' and ')}` : 'whenever it is ready'} · target: ${esc(target)}${only.length ? ` · only if ${only.join(' and ')}` : ''}`;
}

function finalesHtml(a) {
  const f = a.effects.find(e => e.kind === 'finale');
  if (!f) return '';
  return `<table class="wiki-table"><tr><th>Notes in order</th><th>Finale</th><th>Effect</th></tr>${Object.entries(f.finales).map(([k, v]) => `<tr><td>${k === 'dissonance' ? 'a repeated note' : k.split(',').map(n => n[0].toUpperCase() + n.slice(1)).join(' → ')}</td><td><b>${esc(v.name)}</b></td><td>${{ party: 'every ally', enemies: 'every enemy', target: 'the target', self: 'the Bard' }[v.target]}: ${v.effects.map(e => effText(e, a.classId)).join('; ')}</td></tr>`).join('')}</table>`;
}

function abilityBlock(id, extra = '') {
  const a = ABILITIES[id];
  if (!a) return '';
  return `<div class="wiki-ability" id="wa-${esc(id)}">
    <div class="wiki-ab-head">${abilityIcon(id, 'md')}<div><b>${esc(a.name)}</b>${extra}<div class="small muted">${esc(a.description || '')}</div></div></div>
    <div class="wiki-facts">${abilityFacts(a).map(([k, v]) => `<span><i>${k}</i> ${v}</span>`).join('')}</div>
    <div class="small">${a.effects.map(e => effText(e, a.classId)).map(t => t[0].toUpperCase() + t.slice(1)).join('. ')}.</div>
    ${finalesHtml(a)}
    <div class="small muted">Default rule: ${ruleText(a)} · priority ${a.priority ?? '—'}</div>
  </div>`;
}

// ---------------------------------------------------------------- pages
const MECH = {
  basics: ['How combat works', () => `
    <p>Fights run by themselves, ${1000 / CONFIG.combat.tickMs} steps per second. Every unit waits for its <b>action timer</b>: a basic attack every ${CONFIG.combat.baseAttackInterval} s, an ability then waits a <b>global cooldown</b> of ${CONFIG.combat.globalCooldown} s. Attack speed shortens both (capped at ×${CONFIG.combat.attackSpeedCap}).</p>
    <p>When a character can act, it goes through its equipped abilities from <b>highest priority</b> down and uses the first one that is ready, affordable and whose <b>rule</b> is true (see Ability rules). If none fits, it makes a basic attack.</p>
    <p>A party has up to ${CONFIG.party.size} members. Between fights there is a ${CONFIG.combat.restBetweenFights} s rest. A fight that runs longer than ${CONFIG.combat.maxBattleSeconds} s per wave is lost. The first tutorial fights can't be lost.</p>`],
  damage: ['Damage, defense & crits', () => `
    <p>Damage is <i>power × the ability's percentage</i>. Physical damage is reduced by the target's <b>defense</b>: reduction = defense ÷ (defense + ${CONFIG.combat.armorK} + 12 × attacker level), at most ${pct(CONFIG.combat.armorCap)}. Magic damage only counts ${pct(CONFIG.combat.magicArmorFactor)} of defense. Some effects ignore armor completely.</p>
    <p><b>Critical hits</b> deal ×${1.5} damage plus any critical-damage bonus. Critical chance is capped at ${pct(CONFIG.combat.critCap)}.</p>
    <p><b>Damage over time</b> ticks once per second. Whether a tick can crit depends on the effect (see Statuses); each tick rolls its own crit. <b>Shields</b> absorb damage before health.</p>
    <p>Abilities can be ranked up to rank ${CONFIG.maxAbilityRank} in the skill tree; each rank above 1 adds ${pct(CONFIG.abilityRankBonus)} to the ability's damage, healing, shields and damage or healing over time, and makes summoned minions ${pct(CONFIG.abilityRankBonus)} stronger (health and power). Costs, cooldowns, durations and fixed percentage buffs don't change.</p>`],
  roles: ['Roles & threat', () => `
    <p>Every class has a role. The role gives a bonus to everyone of that class:</p>
    <table class="wiki-table"><tr><th>Role</th><th>Bonus</th></tr>${Object.values(CONFIG.roles).map(r => `<tr><td>${esc(r.label)}</td><td>${[r.threatMult && `×${r.threatMult} threat`, r.damageTakenPct && `${signed(r.damageTakenPct)} damage taken`, r.healingPct && `${signed(r.healingPct)} healing`, r.damagePct && `${signed(r.damagePct)} damage`, r.buffDurationPct && `buffs last ${signed(r.buffDurationPct)} longer`].filter(Boolean).join(', ')}</td></tr>`).join('')}</table>
    <p>Enemies attack whoever has the most <b>threat</b>. Damage and shields absorbed create threat; tanks create far more, taunts force enemies onto the taunter. At the start of a fight, the front party positions start with some threat.</p>
    <p>Parties with different classes get a synergy bonus (${signed(CONFIG.synergy.perDistinctClassPct)} per different class, ${signed(CONFIG.synergy.balancedBonusPct)} for a balanced party).</p>`],
  resources: ['Resources & statuses', () => `
    <p>Every class has its own resource (see each class). Most regenerate every second; some fill in other ways, e.g. the Sentinel's Retribution fills from damage taken (shields included).</p>
    <p><b>Statuses</b> are buffs (good) and debuffs (bad) with a duration. Applying a status again refreshes it, unless it stacks. Some statuses belong to a group (Druid forms, Bard songs): only one of a group from the same caster at a time.</p>`],
  rules: ['Ability rules', () => `
    <p>Each equipped ability has a rule: <b>conditions</b> (when to use it), a <b>target</b>, and <b>target conditions</b>. Change them on the Abilities page. Conditions can be grouped with AND/OR and negated.</p>
    <h4>Conditions</h4><ul class="wiki-cols">${Object.values(CONDITIONS).map(c => `<li>${esc(c.label)}</li>`).join('')}</ul>
    <h4>Targets</h4><ul class="wiki-cols">${Object.values(SELECTORS).map(c => `<li>${esc(c.label)}</li>`).join('')}</ul>
    <h4>Target conditions</h4><ul class="wiki-cols">${Object.values(TARGET_CONDITIONS).map(c => `<li>${esc(c.label)}</li>`).join('')}</ul>`],
  arena: ['Arena (PvP)', () => `
    <p>From hero level ${CONFIG.featureUnlocks?.arena ?? 1}, pick one of your party setups as your <b>arena team</b>. It attacks other players' teams and defends against them, also while you're offline. Your ability rules decide everything.</p>
    <p><b>Level:</b> both teams fight at the average level of the two heroes. Characters above it are scaled down (stats, gear and the earliest skill points that fit); characters below it are scaled up (stats, gear, and their missing skill points spent automatically for the fight).</p>
    <p><b>Between players:</b> damage ×${CONFIG.arena.damageMult}, healing ×${CONFIG.arena.healingMult}, stuns and Stasis last ×${CONFIG.arena.controlMult}. Taunts also pull the other team's basic attacks. After ${CONFIG.arena.timeLimit} s the team with the larger share of its health left wins.</p>
    <p><b>Rating:</b> everyone starts at ${CONFIG.arena.startRating}. Elo with K = ${CONFIG.arena.kFactor}: against an equal opponent a win gives about +${CONFIG.arena.kFactor / 2} and a loss −${CONFIG.arena.kFactor / 2}; the defender gains or loses the same amount. You have ${CONFIG.arena.attacksMax} attacks; one comes back every ${CONFIG.arena.attackRefillMinutes} minutes. The same player can't be attacked again for ${CONFIG.arena.sameOpponentMinutes} minutes. A win gives ${CONFIG.arena.winGoldPerLevel} gold per fight level.</p>`],
  progress: ['Levels, skill tree & ascension', () => `
    <p>The level cap is ${CONFIG.levelCap}. Every level gives ${CONFIG.skillPointsPerLevel} skill point for the passive <b>skill tree</b>; your hero gets an extra point every ${CONFIG.mainCharacter.bonusSkillPointEvery} levels, ${pct(CONFIG.mainCharacter.attributeBonus)} more attributes and ${CONFIG.mainCharacter.extraAbilitySlots} extra ability slot (${CONFIG.baseAbilitySlots} for recruits).</p>
    <p>The tree has four paths per class with abilities, attribute nodes, <b>notables</b> (bigger bonuses) and <b>keystones</b> on the outer ring (strong bonuses with a drawback). Points can be refunded for gold.</p>
    ${CONFIG.ascension?.enabled ? `<p><b>Ascension</b>: at level ${CONFIG.levelCap} your hero can ascend into one of three ascendancies of its class (see each class). The hero starts again at level 1 with ${CONFIG.ascension.bonusSkillPoints} bonus skill points and keeps its gear (scaled to item level 1; reforge it in town). Ascended heroes are level-synced to the zone.</p>` : ''}
    <h4>Features unlock with your hero's level</h4><table class="wiki-table"><tr><th>Feature</th><th>Hero level</th></tr>${Object.entries(CONFIG.featureUnlocks || {}).map(([k, v]) => `<tr><td>${esc(FEATURE_LABELS[k] || k)}</td><td>${v}</td></tr>`).join('')}</table>`],
};

function classPage(id) {
  const c = CLASSES[id];
  const spec = TREE_SPECS[id];
  const base = classAbilities(id).filter(a => !a.subclass);
  const ring = {}; for (const b of spec.branches) for (const [r, a] of Object.entries(b.abilities || {})) ring[a] = `${b.name}, ring ${r}`;
  return `<div class="wiki-class-head" style="--cc:${c.color}">${classIcon(id, 'lg')}<div><h2 style="color:${c.color}">${esc(c.name)}</h2><div class="muted">${esc(CONFIG.roles[c.role]?.label || c.role)} · ${esc(c.resource.name)}</div></div></div>
    <p>${esc(c.description)}</p>
    <div class="two-col"><div><h4>Strengths</h4><ul class="plus">${c.strengths.map(s => `<li>${esc(s)}</li>`).join('')}</ul></div><div><h4>Weaknesses</h4><ul class="minus">${c.weaknesses.map(s => `<li>${esc(s)}</li>`).join('')}</ul></div></div>
    <h3>Resource: ${esc(c.resource.name)}</h3>
    <p>Maximum ${c.resource.max}, starts fights at ${c.resource.start}, regenerates ${c.resource.regen} per second${c.resource.fromDamage ? `, fills by ${c.resource.fromDamage} per 1% of maximum health lost (shields included)` : ''}${c.resource.onDamaged ? `, +${c.resource.onDamaged} when hit` : ''}${c.resource.onHit ? `, +${c.resource.onHit} per hit` : ''}${c.resource.onAlternate ? `, +${c.resource.onAlternate} when alternating weapon and spell` : ''}.</p>
    <h3>Attributes</h3>
    <table class="wiki-table"><tr><th>Attribute</th><th>Start</th><th>Per level</th></tr>${Object.entries(ATTRIBUTES).map(([k, a]) => `<tr><td>${a.label}</td><td>${c.baseAttributes[k]}</td><td>+${c.growth[k]}</td></tr>`).join('')}</table>
    <p class="small">Scaling: ${Object.entries(c.scaling).map(([stat, from]) => `<b>${esc(statName(stat))}</b> ${Object.entries(from).map(([k, v]) => `${v} per ${ATTRIBUTES[k]?.label || k}`).join(' + ')}`).join(' · ')}${c.powerBlend ? ` · the lower of physical and magic power gains ${pct(c.powerBlend)} of the higher one` : ''}.</p>
    <p class="small">Basic attack: <b>${esc(c.basicAttack.name)}</b>, ${pct(c.basicAttack.power)} of ${statName(c.basicAttack.stat)} as ${c.basicAttack.school} damage. Threat ×${c.threatMult ?? 1}.</p>
    <h3>Titles</h3><p class="small">${(c.tiers || []).map(t => `Lv ${t.level}: <b>${esc(t.title)}</b>${t.mainOnly ? ' (hero only)' : ''}${t.bonus ? ` (${describeNodeStats(t.bonus).map(esc).join(', ')})` : ''}`).join(' · ')}</p>
    <h3>Abilities</h3>
    ${base.map(a => abilityBlock(a.id, a.id === spec.start ? ' <span class="tag">starting ability</span>' : ring[a.id] ? ` <span class="muted small">· ${esc(ring[a.id])}</span>` : '')).join('')}
    <h3>Skill tree</h3>
    <p class="small muted">Starts with ${abilityLink(spec.start)}. Notables on ring 8 are keystones.</p>
    <table class="wiki-table"><tr><th>Path</th><th>Attributes</th><th>Abilities</th><th>Notables & keystones</th></tr>${spec.branches.map(b => `<tr><td><b>${esc(b.name)}</b></td><td>${b.attrs.map(a => ATTRIBUTES[a]?.label || a).join(', ')}</td><td>${Object.entries(b.abilities || {}).map(([r, a]) => `${abilityLink(a)} (ring ${r})`).join('<br>') || '—'}</td><td>${Object.entries(b.notables || {}).map(([r, n]) => `<b>${esc(n.name)}</b> (ring ${r}): ${describeNodeStats(n.stats).map(esc).join(', ')}`).join('<br>')}</td></tr>`).join('')}</table>
    <h3>Ascendancies</h3>
    ${subclassesOf(id).map(s => subclassHtml(s)).join('')}`;
}

function subclassHtml(s) {
  const br = s.branches[0] || {};
  return `<div class="wiki-sub" style="--sub-color:${esc(s.color || '#c9a24a')}">
    <h4>${esc(s.glyph || '')} ${esc(s.name)} <span class="muted small">· “${esc(s.title || '')}”</span></h4>
    <p class="small">${esc(s.description || '')}</p>
    <p class="small"><b>Passive:</b> ${describeNodeStats(s.bonus).map(esc).join(' · ') || '—'}</p>
    <p class="small"><b>Notables:</b> ${s.branches.flatMap(b => Object.values(b.notables || {})).map(n => `<b>${esc(n.name)}</b> (${describeNodeStats(n.stats).map(esc).join(', ')})`).join(' · ')}</p>
    <p class="small"><b>Nodes that change base abilities:</b></p>
    <ul class="small">${s.branches.flatMap(b => Object.values(b.mutators || {})).map(m => `<li><b>${esc(m.name)}</b> (${abilityLink(m.ability)}): ${esc(m.description)}</li>`).join('')}</ul>
    ${Object.values(br.abilities || {}).map(a => abilityBlock(a)).join('')}
  </div>`;
}

function abilityPage(id) {
  const a = ABILITIES[id];
  if (!a) return '<p>Unknown ability.</p>';
  const owner = a.subclass ? `${esc(SUBCLASSES[a.subclass]?.name || a.subclass)} (${esc(CLASSES[a.classId]?.name || '')} ascendancy)` : esc(CLASSES[a.classId]?.name || a.classId || 'Enemy');
  return `<p class="small muted">${link(`class:${a.classId}`, owner)}</p>${abilityBlock(id)}`;
}

function statusRow(id) {
  const s = STATUSES[id];
  return `<tr id="ws-${esc(id)}"><td><b>${esc(s.name)}</b></td><td>${s.type === 'buff' ? '<span class="up">buff</span>' : '<span class="down">debuff</span>'}</td><td class="small">${esc(s.description || '')}${statusFacts(id).length ? `<div class="muted">${statusFacts(id).map(esc).join(' · ')}</div>` : ''}${s.reactions ? `<div>${Object.entries(s.reactions).map(([el, r]) => `with ${esc(el)}: <b>${esc(r.name)}</b>${r.area ? ' (every enemy)' : ''} — ${r.effects.map(e => effText(e, 'alchemist')).join('; ')}`).join('<br>')}</div>` : ''}</td></tr>`;
}
function statusesPage(only = null) {
  const ids = only ? [only] : Object.keys(STATUSES).sort((a, b) => STATUSES[a].name.localeCompare(STATUSES[b].name));
  return `${only ? '' : '<p>Every buff and debuff in the game.</p>'}<table class="wiki-table"><tr><th>Status</th><th>Type</th><th>Effect</th></tr>${ids.map(statusRow).join('')}</table>${only ? `<p>${link('statuses', 'All statuses →')}</p>` : ''}`;
}

function itemsPage() {
  return `<h3>Slots</h3><p>${SLOT_IDS.map(s => esc(SLOTS[s].label)).join(' · ')}</p>
    <h3>Rarities</h3><table class="wiki-table"><tr><th>Rarity</th><th>Stat multiplier</th><th>Extra affixes</th><th>Drop weight</th></tr>${CONFIG.rarities.map(r => `<tr><td style="color:${r.color}"><b>${esc(r.label)}</b></td><td>×${r.mult}</td><td>${r.affixes}</td><td>${r.weight}</td></tr>`).join('')}</table>
    <h3>Item types</h3><table class="wiki-table"><tr><th>Item</th><th>Slot</th><th>Classes</th></tr>${Object.entries(ITEM_BASES).map(([id, b]) => `<tr><td>${esc(b.name)}</td><td>${esc(SLOTS[b.slot]?.label || b.slot)}</td><td class="small">${(b.classes || CLASS_IDS).map(c => esc(CLASSES[c]?.name || c)).join(', ')}</td></tr>`).join('')}</table>
    <h3>Affixes</h3><p class="small">${Object.values(AFFIXES).map(a => esc(a.label)).join(' · ')}</p>
    <h3>Uniques</h3><table class="wiki-table"><tr><th>Unique</th><th>Item</th><th>From level</th><th>Where</th><th>Effect</th></tr>${Object.values(UNIQUES).sort((a, b) => a.minLevel - b.minLevel).map(u => `<tr><td class="unique-name"><b>${esc(u.name)}</b></td><td>${esc(ITEM_BASES[u.baseId]?.name || u.baseId)}</td><td>${u.minLevel}</td><td class="small">${(u.zones || []).map(z => esc(ZONES[z]?.name || z)).join(', ') || 'anywhere'}</td><td class="small">${esc(u.description || '')}</td></tr>`).join('')}</table>
    <h3>Sets</h3>${Object.values(SETS).map(s => `<div class="wiki-sub" style="--sub-color:#3fbf6a"><h4 class="set-name">${esc(s.name)} <span class="muted small">from level ${s.minLevel}${s.zones?.length ? ` · ${s.zones.map(z => esc(ZONES[z]?.name || z)).join(', ')}` : ''}</span></h4><p class="small">${Object.values(s.pieces).map(esc).join(' · ')}</p><ul class="small">${Object.entries(s.bonuses).map(([n, b]) => `<li><b>${n} pieces:</b> ${esc(b.description)}</li>`).join('')}</ul></div>`).join('')}`;
}

function townPage() {
  return `<p>Buildings are upgraded with gold and materials and take time to build. The Town Hall's level is the maximum level of every other building.</p>
    ${Object.values(BUILDINGS).sort((a, b) => a.order - b.order).map(b => `<div class="wiki-sub" style="--sub-color:#c9a24a"><h4>${esc(b.name)} <span class="muted small">max level ${b.maxLevel}${b.unlockLevel ? ` · hero level ${b.unlockLevel}` : ''}</span></h4><p class="small">${esc(b.description)}</p><p class="small muted">At level 1: ${buildingEffects(b.id, 1).map(esc).join(' · ')}<br>At level ${b.maxLevel}: ${buildingEffects(b.id, b.maxLevel).map(esc).join(' · ')}</p></div>`).join('')}
    <h3>Materials</h3><table class="wiki-table"><tr><th>Material</th><th>Source</th></tr>${Object.values(MATERIALS).sort((a, b) => (a.order || 0) - (b.order || 0)).map(m => `<tr><td>${esc(m.glyph || '')} ${esc(m.name)}</td><td class="small">${esc(m.description || '')}</td></tr>`).join('')}</table>`;
}

function expeditionsPage() {
  return `<p>Send recruits on expeditions to gather materials. Durations: ${EXPEDITION_DURATIONS.map(d => d.label).join(', ')}.</p>
    <table class="wiki-table"><tr><th>Destination</th><th>Camp level</th><th>Yields per hour</th><th>Rare finds</th></tr>${Object.values(EXPEDITIONS).sort((a, b) => a.order - b.order).map(e => `<tr><td><b>${esc(e.name)}</b><div class="small muted">${esc(e.description || '')}</div></td><td>${e.campLevel}</td><td class="small">${Object.entries(e.yields || {}).map(([k, v]) => `${esc(MATERIALS[k]?.name || k)} ${v}`).join(', ')}</td><td class="small">${Object.entries(e.rare || {}).map(([k, v]) => `${esc(MATERIALS[k]?.name || k)} (${pct(v, 1)})`).join(', ') || '—'}</td></tr>`).join('')}</table>`;
}

function zonesPage() {
  return `<p>Zones open one after another; beating a zone's boss opens the next. Each zone has its own material and exclusive uniques and sets. Enemy details are in the Bestiary.</p>
    <table class="wiki-table"><tr><th>Zone</th><th>Levels</th><th>Enemies</th><th>Boss</th><th>Exclusive</th></tr>${Object.values(ZONES).sort((a, b) => a.order - b.order).map(z => `<tr><td><b>${esc(z.name)}</b><div class="small muted">${esc(z.description || '')}</div></td><td style="white-space:nowrap">${z.levelRange[0]}–${z.levelRange[1]}</td><td class="small">${z.enemies.map(e => esc(ENEMIES[e]?.name || e)).join(', ')}</td><td class="small">${esc(ENEMIES[z.boss]?.name || z.boss)}</td><td class="small">${[z.material && MATERIALS[z.material] ? `${esc(MATERIALS[z.material].name)} (material)` : '', ...Object.values(UNIQUES).filter(u => u.zones?.includes(z.id)).map(u => `<span class="unique-name">${esc(u.name)}</span>`), ...Object.values(SETS).filter(s => s.zones?.includes(z.id)).map(s => `<span class="set-name">${esc(s.name)}</span>`)].filter(Boolean).join(', ') || '—'}</td></tr>`).join('')}</table>`;
}

// ---------------------------------------------------------------- navigation & search
function nav() {
  const item = (page, label, cls = '') => `<button class="wiki-nav-item ${ui.page === page ? 'active' : ''} ${cls}" data-wiki="${page}">${label}</button>`;
  const roles = Object.keys(CONFIG.roles);
  return `<div class="wiki-nav-group"><h5>Game mechanics</h5>${Object.entries(MECH).map(([k, [t]]) => item(`mech:${k}`, esc(t))).join('')}</div>
    <div class="wiki-nav-group"><h5>Classes</h5>${CLASS_IDS.slice().sort((a, b) => roles.indexOf(CLASSES[a].role) - roles.indexOf(CLASSES[b].role) || CLASSES[a].order - CLASSES[b].order).map(id => item(`class:${id}`, `${classIcon(id, 'sm')} ${esc(CLASSES[id].name)} <small>${esc(CONFIG.roles[CLASSES[id].role]?.label || '')}</small>`)).join('')}</div>
    <div class="wiki-nav-group"><h5>Reference</h5>${item('statuses', 'Statuses')}${item('items', 'Items, uniques & sets')}${item('town', 'Town & materials')}${item('expeditions', 'Expeditions')}${item('zones', 'Zones')}</div>`;
}

function searchResults(q) {
  q = q.toLowerCase();
  const hit = s => String(s || '').toLowerCase().includes(q);
  const ab = Object.entries(ABILITIES).filter(([, a]) => a.classId && CLASSES[a.classId] && (hit(a.name) || hit(a.description))).slice(0, 40);
  const st = Object.entries(STATUSES).filter(([, s]) => hit(s.name) || hit(s.description)).slice(0, 20);
  const cl = CLASS_IDS.filter(id => hit(CLASSES[id].name));
  const sub = Object.entries(SUBCLASSES).filter(([, s]) => hit(s.name));
  const un = Object.values(UNIQUES).filter(u => hit(u.name) || hit(u.description)).slice(0, 10);
  const out = [];
  if (cl.length || sub.length) out.push(`<h4>Classes</h4><p>${[...cl.map(id => link(`class:${id}`, esc(CLASSES[id].name))), ...sub.map(([, s]) => link(`class:${s.classId}`, `${esc(s.name)} (${esc(CLASSES[s.classId]?.name)})`))].join(' · ')}</p>`);
  if (ab.length) out.push(`<h4>Abilities</h4><ul>${ab.map(([id, a]) => `<li>${link(`ability:${id}`, esc(a.name))} <span class="muted small">${esc(a.subclass ? SUBCLASSES[a.subclass]?.name : CLASSES[a.classId].name)} — ${esc(a.description || '')}</span></li>`).join('')}</ul>`);
  if (st.length) out.push(`<h4>Statuses</h4><ul>${st.map(([id, s]) => `<li>${link(`status:${id}`, esc(s.name))} <span class="muted small">${esc(s.description || '')}</span></li>`).join('')}</ul>`);
  if (un.length) out.push(`<h4>Uniques</h4><ul>${un.map(u => `<li>${link('items', esc(u.name))} <span class="muted small">${esc(u.description || '')}</span></li>`).join('')}</ul>`);
  return out.join('') || '<p class="muted">Nothing found.</p>';
}

function pageHtml() {
  if (ui.search.trim().length >= 2) return `<h2>Search: “${esc(ui.search.trim())}”</h2>${searchResults(ui.search.trim())}`;
  const [kind, id] = ui.page.split(':');
  if (kind === 'mech' && MECH[id]) return `<h2>${esc(MECH[id][0])}</h2>${MECH[id][1]()}`;
  if (kind === 'class' && CLASSES[id]) return classPage(id);
  if (kind === 'ability') return abilityPage(id);
  if (kind === 'status' && STATUSES[id]) return `<h2>${esc(STATUSES[id].name)}</h2>${statusesPage(id)}`;
  if (kind === 'statuses') return `<h2>Statuses</h2>${statusesPage()}`;
  if (kind === 'items') return `<h2>Items, uniques & sets</h2>${itemsPage()}`;
  if (kind === 'town') return `<h2>Town & materials</h2>${townPage()}`;
  if (kind === 'expeditions') return `<h2>Expeditions</h2>${expeditionsPage()}`;
  if (kind === 'zones') return `<h2>Zones</h2>${zonesPage()}`;
  return `<h2>${esc(MECH.basics[0])}</h2>${MECH.basics[1]()}`;
}

export const wikiView = {
  id: 'wiki', label: 'Wiki', icon: '📚',
  mount(root) {
    root.addEventListener('click', e => {
      const l = e.target.closest('[data-wiki]');
      if (!l) return;
      e.preventDefault();
      ui.page = l.dataset.wiki; ui.search = '';
      delete root.dataset.wikiPage;
      this.render(root);
      root.querySelector('.wiki-page')?.scrollTo?.(0, 0);
      window.scrollTo(0, 0);
    });
    root.addEventListener('input', e => {
      if (!e.target.matches('[data-wiki-search]')) return;
      ui.search = e.target.value;
      const page = root.querySelector('.wiki-page');
      if (page) page.innerHTML = pageHtml();
    });
  },
  render(root) {
    if (root.querySelector('.wiki') && root.dataset.wikiPage === ui.page) return; // nothing changed (live state updates)
    root.dataset.wikiPage = ui.page;
    root.innerHTML = `<div class="wiki">
      <aside class="wiki-nav panel"><input data-wiki-search placeholder="Search abilities, statuses…" value="${esc(ui.search)}">${nav()}</aside>
      <article class="wiki-page panel">${pageHtml()}</article>
    </div>`;
  },
};
