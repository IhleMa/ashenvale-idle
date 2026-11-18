// Party composition bonuses & building combat units from characters.
import { CONFIG } from './config.js';
import { makeCharacterUnit } from './combat.js';
import { syncParty } from './levelsync.js';

// characters: array of character objects in position order
export function partyBonuses(characters) {
  const roles = new Set(characters.map(c => c.role));
  const classes = new Set(characters.map(c => c.classId));
  const bonuses = [];
  let allStatsPct = 0, damagePct = 0;
  if (roles.has('tank') && roles.has('healer') && (roles.has('damage') || roles.has('support'))) {
    allStatsPct += CONFIG.synergy.balancedBonusPct;
    bonuses.push({ name: 'Balanced Formation', description: `Tank + Healer + Damage: +${Math.round(CONFIG.synergy.balancedBonusPct * 100)}% to all stats` });
  }
  if (classes.size > 1) {
    const pct = (classes.size - 1) * CONFIG.synergy.perDistinctClassPct;
    allStatsPct += pct;
    bonuses.push({ name: 'Diverse Party', description: `${classes.size} different classes: +${Math.round(pct * 100)}% to all stats` });
  }
  const main = characters.find(c => c.isMain);
  if (main && main.level >= CONFIG.mainCharacter.leadershipAura.unlockLevel) {
    damagePct += CONFIG.mainCharacter.leadershipAura.damagePct;
    bonuses.push({ name: `${main.name}'s Leadership`, description: `Hero aura: party deals +${Math.round(CONFIG.mainCharacter.leadershipAura.damagePct * 100)}% damage` });
  }
  return { allStatsPct, damagePct, list: bonuses };
}

// buffs: extra temporary bonuses (e.g. elixirs) { damagePct, damageTakenPct, allStatsPct }
export function buildPartyUnits(characters, { ownerId, ownerName, positionOffset = 0, extraBonuses = null, buffs = null, vsEnemy = null } = {}) {
  const pb = extraBonuses || partyBonuses(characters);
  characters = syncParty(characters).characters; // ascension level sync
  return characters.map((ch, i) => makeCharacterUnit(ch, {
    ownerId, ownerName, position: positionOffset + i, vsEnemy,
    bonuses: {
      allStatsPct: pb.allStatsPct + (buffs?.allStatsPct || 0),
      damagePct: pb.damagePct + (buffs?.damagePct || 0),
      damageTakenPct: buffs?.damageTakenPct || 0,
    },
  }));
}
