// What a character's minions would look like if summoned right now: built with the same code the fight uses
// (makeCharacterUnit → makeMinionUnit), so gear, skill-tree minion bonuses and the summon ability's rank all count.
import { CONFIG } from './config.js';
import { ABILITIES } from './data/abilities.js';
import { MINIONS } from './data/minions.js';
import { mutatedAbilities, getTree, allocatedSet } from './skilltree.js';
import { makeCharacterUnit, makeMinionUnit } from './combat.js';

const summonEffects = (ch, abilityId) => {
  const ab = mutatedAbilities(ch)[abilityId] || ABILITIES[abilityId];
  return (ab?.effects || []).filter(e => e.kind === 'summon' && e.minion && MINIONS[e.minion]);
};
export const isMinionAbility = (ch, abilityId) => summonEffects(ch, abilityId).length > 0;

// rank: the summon ability's rank to show (default: its current rank, or 1 if not learned yet)
export function minionPreview(ch, abilityId, { rank = null } = {}) {
  const effs = summonEffects(ch, abilityId);
  if (!effs.length) return [];
  const owner = makeCharacterUnit(ch, { ownerId: 'preview', ownerName: '', position: 0 });
  const r = rank ?? Math.max(1, ch.abilities?.[abilityId] || 1);
  const strength = 1 + CONFIG.abilityRankBonus * (r - 1);
  return effs.map(e => {
    const m = makeMinionUnit(e.minion, owner, 0, strength);
    const power = m.stats[m.basicAttack.stat] || 0;
    return {
      id: e.minion, name: MINIONS[e.minion].name, role: MINIONS[e.minion].role || 'damage', rank: r,
      count: e.count || 1, max: (e.max || 1) + (owner.minionBonus.extraMax || 0),
      hp: m.maxHp, defense: m.stats.defense, power,
      attackName: m.basicAttack.name, school: m.basicAttack.school,
      hit: Math.round(power * m.basicAttack.power * (1 + (m.bonuses.damagePct || 0))), // before the enemy's defense
      attackSpeed: m.stats.attackSpeed, critChance: m.stats.critChance, damagePct: m.bonuses.damagePct || 0,
      duration: m.duration,
    };
  });
}

// a node with minion stats (e.g. Thick Bones): every learned minion before → after taking it
export function minionNodeDelta(ch, nodeId) {
  const node = getTree(ch.classId, ch.subclass).nodes[nodeId];
  if (!node || !Object.keys(node.stats || {}).some(k => k.startsWith('minion'))) return [];
  const set = allocatedSet(ch);
  const without = set.has(nodeId) ? { ...ch, tree: { ...ch.tree, allocated: [...set].filter(id => id !== nodeId) } } : ch;
  const withIt = set.has(nodeId) ? ch : { ...ch, tree: { ...ch.tree, allocated: [...set, nodeId] } };
  const out = [];
  for (const abilityId of Object.keys(ch.abilities || {})) {
    const a = minionPreview(without, abilityId), b = minionPreview(withIt, abilityId);
    a.forEach((x, i) => out.push({ before: x, after: b[i] }));
  }
  return out;
}
