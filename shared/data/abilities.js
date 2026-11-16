// Ability definitions. Fully data-driven: the combat engine interprets `effects`.
//
// target: 'enemy' | 'ally' | 'self'   — what kind of unit the ability can target
// area:   true → hits every valid unit on that side (target selector is fixed to all_*)
// effects (applied to every target):
//   { kind:'damage', stat, power, school, hits?, executeBelow?, executeMult?, bonusCrit? }
//   { kind:'heal', stat, power }
//   { kind:'status', status, duration, stat?, power?, stacks?, chance?, self? }   (stat/power = tick value)
//   { kind:'shield', stat, power, duration }
//   { kind:'taunt', duration }
//   { kind:'cleanse', count }
//   { kind:'resource', amount }
//   { kind:'summon', enemyId, count, max }
// defaultRule: the behaviour a freshly unlocked ability starts with (players can change it).

const R = (conditions, selector, targetConditions = [], mode = 'all', param) => ({
  enabled: true, mode, conditions, target: { selector, ...(param ? { param } : {}) }, targetConditions,
});
const ALWAYS = [{ type: 'always' }];

export const ABILITIES = {
  // ======================= WARRIOR =======================
  heroic_strike: {
    name: 'Heroic Strike', classId: 'warrior', unlockLevel: 1, type: 'damage',
    description: 'A powerful blow dealing 160% physical damage.',
    cost: 20, cooldown: 3, target: 'enemy',
    effects: [{ kind: 'damage', stat: 'physPower', power: 1.6, school: 'physical' }],
    defaultRule: R(ALWAYS, 'enemy_current'),
  },
  taunt: {
    name: 'Taunt', classId: 'warrior', unlockLevel: 1, type: 'control',
    description: 'Forces all enemies to attack you for 5 seconds and generates high threat.',
    cost: 0, cooldown: 10, target: 'self',
    effects: [{ kind: 'taunt', duration: 5 }],
    defaultRule: R([{ type: 'enemies_alive', cmp: '>=', value: 1 }], 'self', [{ type: 'target_missing_status', status: 'taunting' }]),
  },
  shield_wall: {
    name: 'Shield Wall', classId: 'warrior', unlockLevel: 3, type: 'buff',
    description: 'Raise your shield, taking 45% less damage for 8 seconds.',
    cost: 15, cooldown: 25, target: 'self',
    effects: [{ kind: 'status', status: 'shield_wall', duration: 8 }],
    defaultRule: R([{ type: 'self_hp_below', value: 40 }, { type: 'self_missing_status', status: 'shield_wall' }], 'self'),
  },
  cleave: {
    name: 'Cleave', classId: 'warrior', unlockLevel: 6, type: 'damage',
    description: 'Strike all enemies for 90% physical damage.',
    cost: 30, cooldown: 6, target: 'enemy', area: true,
    effects: [{ kind: 'damage', stat: 'physPower', power: 0.9, school: 'physical' }],
    defaultRule: R([{ type: 'enemies_alive', cmp: '>=', value: 2 }], 'all_enemies'),
  },
  shield_bash: {
    name: 'Shield Bash', classId: 'warrior', unlockLevel: 10, type: 'control',
    description: 'Bash an enemy for 80% damage and stun it for 2 seconds.',
    cost: 20, cooldown: 14, target: 'enemy',
    effects: [{ kind: 'damage', stat: 'physPower', power: 0.8, school: 'physical' }, { kind: 'status', status: 'stun', duration: 2 }],
    defaultRule: R(ALWAYS, 'enemy_highest_threat', [{ type: 'target_missing_status', status: 'stun' }]),
  },
  battle_cry: {
    name: 'Battle Cry', classId: 'warrior', unlockLevel: 15, type: 'buff',
    description: 'Rally the party: all allies deal 15% more damage for 10 seconds.',
    cost: 30, cooldown: 30, target: 'ally', area: true,
    effects: [{ kind: 'status', status: 'battle_cry', duration: 10 }],
    defaultRule: R([{ type: 'self_missing_status', status: 'battle_cry' }], 'all_allies'),
  },
  sunder_armor: {
    name: 'Sunder Armor', classId: 'warrior', unlockLevel: 20, type: 'debuff',
    description: 'Deal 110% damage and reduce the target\'s defense by 30% for 10 seconds.',
    cost: 20, cooldown: 8, target: 'enemy',
    effects: [{ kind: 'damage', stat: 'physPower', power: 1.1, school: 'physical' }, { kind: 'status', status: 'sundered', duration: 10 }],
    defaultRule: R(ALWAYS, 'enemy_highest_hp', [{ type: 'target_missing_status', status: 'sundered' }]),
  },

  // ======================= MAGE =======================
  fireball: {
    name: 'Fireball', classId: 'mage', unlockLevel: 1, type: 'damage',
    description: 'Hurl a fireball for 170% magic damage that burns for 6 seconds.',
    cost: 18, cooldown: 3, target: 'enemy',
    effects: [{ kind: 'damage', stat: 'magPower', power: 1.7, school: 'magical' }, { kind: 'status', status: 'burn', duration: 6, stat: 'magPower', power: 0.15 }],
    defaultRule: R(ALWAYS, 'enemy_current'),
  },
  frost_bolt: {
    name: 'Frost Bolt', classId: 'mage', unlockLevel: 1, type: 'debuff',
    description: '130% magic damage and slows the target\'s attacks by 25% for 6 seconds.',
    cost: 14, cooldown: 4, target: 'enemy',
    effects: [{ kind: 'damage', stat: 'magPower', power: 1.3, school: 'magical' }, { kind: 'status', status: 'frostbite', duration: 6 }],
    defaultRule: R(ALWAYS, 'enemy_highest_threat', [{ type: 'target_missing_status', status: 'frostbite' }]),
  },
  arcane_missiles: {
    name: 'Arcane Missiles', classId: 'mage', unlockLevel: 3, type: 'damage',
    description: 'Fire 3 missiles, each dealing 70% magic damage.',
    cost: 25, cooldown: 7, target: 'enemy',
    effects: [{ kind: 'damage', stat: 'magPower', power: 0.7, school: 'magical', hits: 3 }],
    defaultRule: R(ALWAYS, 'enemy_lowest_hp_pct'),
  },
  flame_wave: {
    name: 'Flame Wave', classId: 'mage', unlockLevel: 6, type: 'damage',
    description: 'A wave of fire hits all enemies for 110% magic damage.',
    cost: 35, cooldown: 9, target: 'enemy', area: true,
    effects: [{ kind: 'damage', stat: 'magPower', power: 1.1, school: 'magical' }],
    defaultRule: R([{ type: 'enemies_alive', cmp: '>=', value: 2 }], 'all_enemies'),
  },
  frost_nova: {
    name: 'Frost Nova', classId: 'mage', unlockLevel: 10, type: 'control',
    description: 'Freeze all enemies: 60% magic damage and stun for 1.5 seconds.',
    cost: 30, cooldown: 20, target: 'enemy', area: true,
    effects: [{ kind: 'damage', stat: 'magPower', power: 0.6, school: 'magical' }, { kind: 'status', status: 'stun', duration: 1.5 }],
    defaultRule: R([{ type: 'ally_hp_below', value: 50 }], 'all_enemies'),
  },
  arcane_power: {
    name: 'Arcane Power', classId: 'mage', unlockLevel: 15, type: 'buff',
    description: 'Increase your damage by 25% for 10 seconds.',
    cost: 10, cooldown: 35, target: 'self',
    effects: [{ kind: 'status', status: 'arcane_power', duration: 10 }],
    defaultRule: R([{ type: 'resource_above', value: 60 }], 'self', [{ type: 'target_missing_status', status: 'arcane_power' }]),
  },
  meteor: {
    name: 'Meteor', classId: 'mage', unlockLevel: 22, type: 'damage',
    description: 'Call down a meteor: 260% magic damage to all enemies and burns them.',
    cost: 60, cooldown: 30, target: 'enemy', area: true,
    effects: [{ kind: 'damage', stat: 'magPower', power: 2.6, school: 'magical' }, { kind: 'status', status: 'burn', duration: 6, stat: 'magPower', power: 0.2 }],
    defaultRule: R(ALWAYS, 'all_enemies'),
  },

  // ======================= ROGUE =======================
  backstab: {
    name: 'Backstab', classId: 'rogue', unlockLevel: 1, type: 'damage',
    description: '180% physical damage with +20% critical chance.',
    cost: 35, cooldown: 3, target: 'enemy',
    effects: [{ kind: 'damage', stat: 'physPower', power: 1.8, school: 'physical', bonusCrit: 0.2 }],
    defaultRule: R(ALWAYS, 'enemy_current'),
  },
  poison_blade: {
    name: 'Poison Blade', classId: 'rogue', unlockLevel: 1, type: 'debuff',
    description: '90% damage and applies a stacking poison for 8 seconds.',
    cost: 25, cooldown: 4, target: 'enemy',
    effects: [{ kind: 'damage', stat: 'physPower', power: 0.9, school: 'physical' }, { kind: 'status', status: 'poison', duration: 8, stat: 'physPower', power: 0.18 }],
    defaultRule: R(ALWAYS, 'enemy_highest_hp'),
  },
  evasion: {
    name: 'Evasion', classId: 'rogue', unlockLevel: 3, type: 'buff',
    description: 'Gain 50% dodge chance for 6 seconds.',
    cost: 20, cooldown: 25, target: 'self',
    effects: [{ kind: 'status', status: 'evasion', duration: 6 }],
    defaultRule: R([{ type: 'self_hp_below', value: 50 }], 'self', [{ type: 'target_missing_status', status: 'evasion' }]),
  },
  execute: {
    name: 'Execute', classId: 'rogue', unlockLevel: 6, type: 'damage',
    description: '150% damage. Deals triple damage to enemies below 30% health.',
    cost: 30, cooldown: 6, target: 'enemy',
    effects: [{ kind: 'damage', stat: 'physPower', power: 1.5, school: 'physical', executeBelow: 0.3, executeMult: 3 }],
    defaultRule: R(ALWAYS, 'enemy_lowest_hp'),
  },
  rupture: {
    name: 'Rupture', classId: 'rogue', unlockLevel: 10, type: 'debuff',
    description: 'Open a wound that bleeds heavily for 10 seconds.',
    cost: 25, cooldown: 10, target: 'enemy',
    effects: [{ kind: 'status', status: 'bleed', duration: 10, stat: 'physPower', power: 0.45 }],
    defaultRule: R(ALWAYS, 'enemy_highest_hp', [{ type: 'target_missing_status', status: 'bleed' }, { type: 'target_hp_above', value: 40 }]),
  },
  expose_weakness: {
    name: 'Expose Weakness', classId: 'rogue', unlockLevel: 15, type: 'debuff',
    description: 'The target takes 15% more damage from all sources for 10 seconds.',
    cost: 20, cooldown: 15, target: 'enemy',
    effects: [{ kind: 'status', status: 'exposed', duration: 10 }],
    defaultRule: R(ALWAYS, 'enemy_highest_hp', [{ type: 'target_missing_status', status: 'exposed' }]),
  },
  shadow_flurry: {
    name: 'Shadow Flurry', classId: 'rogue', unlockLevel: 22, type: 'damage',
    description: 'Strike 5 times for 65% damage each.',
    cost: 50, cooldown: 14, target: 'enemy',
    effects: [{ kind: 'damage', stat: 'physPower', power: 0.65, school: 'physical', hits: 5 }],
    defaultRule: R(ALWAYS, 'enemy_current'),
  },

  // ======================= CLERIC =======================
  heal: {
    name: 'Heal', classId: 'cleric', unlockLevel: 1, type: 'heal',
    description: 'Restore health to one ally (220% healing power).',
    cost: 15, cooldown: 2.5, target: 'ally',
    effects: [{ kind: 'heal', stat: 'healPower', power: 2.2 }],
    defaultRule: R([{ type: 'ally_hp_below', value: 70 }], 'ally_lowest_hp_pct', [{ type: 'target_hp_below', value: 70 }]),
  },
  smite: {
    name: 'Smite', classId: 'cleric', unlockLevel: 1, type: 'damage',
    description: 'Holy damage equal to 150% magic power.',
    cost: 10, cooldown: 3, target: 'enemy',
    effects: [{ kind: 'damage', stat: 'magPower', power: 1.5, school: 'magical' }],
    defaultRule: R([{ type: 'resource_above', value: 50 }], 'enemy_current'),
  },
  renew: {
    name: 'Renew', classId: 'cleric', unlockLevel: 3, type: 'heal',
    description: 'Heals an ally every second for 10 seconds.',
    cost: 12, cooldown: 4, target: 'ally',
    effects: [{ kind: 'status', status: 'renew', duration: 10, stat: 'healPower', power: 0.35 }],
    defaultRule: R([{ type: 'ally_hp_below', value: 90 }], 'ally_lowest_hp_pct', [{ type: 'target_missing_status', status: 'renew' }, { type: 'target_hp_below', value: 90 }]),
  },
  purify: {
    name: 'Purify', classId: 'cleric', unlockLevel: 6, type: 'utility',
    description: 'Remove up to 2 harmful effects from an ally and heal them slightly.',
    cost: 12, cooldown: 6, target: 'ally',
    effects: [{ kind: 'cleanse', count: 2 }, { kind: 'heal', stat: 'healPower', power: 0.6 }],
    defaultRule: R(ALWAYS, 'ally_lowest_hp_pct', [{ type: 'target_has_debuff' }]),
  },
  prayer_of_healing: {
    name: 'Prayer of Healing', classId: 'cleric', unlockLevel: 10, type: 'heal',
    description: 'Heal all allies for 120% healing power.',
    cost: 35, cooldown: 10, target: 'ally', area: true,
    effects: [{ kind: 'heal', stat: 'healPower', power: 1.2 }],
    defaultRule: R([{ type: 'allies_below_hp', value: 65, count: 2 }], 'all_allies'),
  },
  power_word_barrier: {
    name: 'Power Word: Barrier', classId: 'cleric', unlockLevel: 15, type: 'buff',
    description: 'Shield an ally, absorbing damage for 10 seconds.',
    cost: 20, cooldown: 12, target: 'ally',
    effects: [{ kind: 'shield', stat: 'healPower', power: 2.5, duration: 10 }],
    defaultRule: R(ALWAYS, 'ally_tank', [{ type: 'target_missing_status', status: 'barrier' }]),
  },
  divine_blessing: {
    name: 'Divine Blessing', classId: 'cleric', unlockLevel: 22, type: 'buff',
    description: 'Bless the party: +8% damage and +15% defense for 15 seconds.',
    cost: 35, cooldown: 35, target: 'ally', area: true,
    effects: [{ kind: 'status', status: 'blessing', duration: 15 }],
    defaultRule: R([{ type: 'self_missing_status', status: 'blessing' }], 'all_allies'),
  },

  // ======================= RANGER =======================
  aimed_shot: {
    name: 'Aimed Shot', classId: 'ranger', unlockLevel: 1, type: 'damage',
    description: 'A carefully aimed shot for 175% physical damage.',
    cost: 25, cooldown: 4, target: 'enemy',
    effects: [{ kind: 'damage', stat: 'physPower', power: 1.75, school: 'physical' }],
    defaultRule: R(ALWAYS, 'enemy_current'),
  },
  serpent_sting: {
    name: 'Serpent Sting', classId: 'ranger', unlockLevel: 1, type: 'debuff',
    description: 'Poisons the target for 12 seconds.',
    cost: 15, cooldown: 3, target: 'enemy',
    effects: [{ kind: 'status', status: 'poison', duration: 12, stat: 'physPower', power: 0.2, stacks: 1 }],
    defaultRule: R(ALWAYS, 'enemy_highest_hp', [{ type: 'target_missing_status', status: 'poison' }]),
  },
  multi_shot: {
    name: 'Multi-Shot', classId: 'ranger', unlockLevel: 3, type: 'damage',
    description: 'Shoot all enemies for 80% physical damage.',
    cost: 30, cooldown: 6, target: 'enemy', area: true,
    effects: [{ kind: 'damage', stat: 'physPower', power: 0.8, school: 'physical' }],
    defaultRule: R([{ type: 'enemies_alive', cmp: '>=', value: 2 }], 'all_enemies'),
  },
  hunters_mark: {
    name: "Hunter's Mark", classId: 'ranger', unlockLevel: 6, type: 'debuff',
    description: 'Mark a target: it takes 10% more damage for 15 seconds.',
    cost: 10, cooldown: 8, target: 'enemy',
    effects: [{ kind: 'status', status: 'marked', duration: 15 }],
    defaultRule: R(ALWAYS, 'enemy_highest_hp', [{ type: 'target_missing_status', status: 'marked' }]),
  },
  rapid_fire: {
    name: 'Rapid Fire', classId: 'ranger', unlockLevel: 10, type: 'buff',
    description: 'Increase attack speed by 40% for 10 seconds.',
    cost: 20, cooldown: 30, target: 'self',
    effects: [{ kind: 'status', status: 'rapid_fire', duration: 10 }],
    defaultRule: R(ALWAYS, 'self', [{ type: 'target_missing_status', status: 'rapid_fire' }]),
  },
  volley: {
    name: 'Volley', classId: 'ranger', unlockLevel: 15, type: 'damage',
    description: 'Rain arrows: 3 volleys of 55% damage on all enemies.',
    cost: 45, cooldown: 14, target: 'enemy', area: true,
    effects: [{ kind: 'damage', stat: 'physPower', power: 0.55, school: 'physical', hits: 3 }],
    defaultRule: R([{ type: 'enemies_alive', cmp: '>=', value: 2 }], 'all_enemies'),
  },
  kill_shot: {
    name: 'Kill Shot', classId: 'ranger', unlockLevel: 22, type: 'damage',
    description: '200% damage, quadrupled against enemies under 20% health.',
    cost: 30, cooldown: 10, target: 'enemy',
    effects: [{ kind: 'damage', stat: 'physPower', power: 2.0, school: 'physical', executeBelow: 0.2, executeMult: 4 }],
    defaultRule: R([{ type: 'enemy_hp_below', value: 20 }], 'enemy_lowest_hp_pct', [{ type: 'target_hp_below', value: 20 }]),
  },

  // ======================= ENEMY ABILITIES =======================
  // Enemies use exactly the same rule system as players.
  e_bite:        { name: 'Savage Bite', classId: 'enemy', type: 'damage', cost: 0, cooldown: 6, target: 'enemy',
    effects: [{ kind: 'damage', stat: 'physPower', power: 1.3, school: 'physical' }, { kind: 'status', status: 'bleed', duration: 6, stat: 'physPower', power: 0.15 }],
    defaultRule: R(ALWAYS, 'enemy_highest_threat') },
  e_venom:       { name: 'Venom Spit', classId: 'enemy', type: 'debuff', cost: 0, cooldown: 7, target: 'enemy',
    effects: [{ kind: 'status', status: 'poison', duration: 8, stat: 'physPower', power: 0.2 }],
    defaultRule: R(ALWAYS, 'enemy_random') },
  e_stab:        { name: 'Dirty Stab', classId: 'enemy', type: 'damage', cost: 0, cooldown: 5, target: 'enemy',
    effects: [{ kind: 'damage', stat: 'physPower', power: 1.5, school: 'physical' }],
    defaultRule: R(ALWAYS, 'enemy_lowest_hp_pct') },
  e_shield_bash: { name: 'Shield Bash', classId: 'enemy', type: 'control', cost: 0, cooldown: 12, target: 'enemy',
    effects: [{ kind: 'damage', stat: 'physPower', power: 0.8, school: 'physical' }, { kind: 'status', status: 'stun', duration: 1.5 }],
    defaultRule: R(ALWAYS, 'enemy_highest_threat') },
  e_bone_arrow:  { name: 'Bone Arrow', classId: 'enemy', type: 'damage', cost: 0, cooldown: 5, target: 'enemy',
    effects: [{ kind: 'damage', stat: 'physPower', power: 1.4, school: 'physical' }],
    defaultRule: R(ALWAYS, 'enemy_lowest_hp') },
  e_firebolt:    { name: 'Firebolt', classId: 'enemy', type: 'damage', cost: 0, cooldown: 4, target: 'enemy',
    effects: [{ kind: 'damage', stat: 'magPower', power: 1.3, school: 'magical' }, { kind: 'status', status: 'burn', duration: 4, stat: 'magPower', power: 0.12 }],
    defaultRule: R(ALWAYS, 'enemy_random') },
  e_slam:        { name: 'Ground Slam', classId: 'enemy', type: 'damage', cost: 0, cooldown: 10, target: 'enemy', area: true,
    effects: [{ kind: 'damage', stat: 'physPower', power: 0.9, school: 'physical' }],
    defaultRule: R(ALWAYS, 'all_enemies') },
  e_dark_mend:   { name: 'Dark Mend', classId: 'enemy', type: 'heal', cost: 0, cooldown: 8, target: 'ally',
    effects: [{ kind: 'heal', stat: 'magPower', power: 2.0 }],
    defaultRule: R([{ type: 'ally_hp_below', value: 60 }], 'ally_lowest_hp_pct', [{ type: 'target_hp_below', value: 60 }]) },
  e_curse:       { name: 'Curse of Ash', classId: 'enemy', type: 'debuff', cost: 0, cooldown: 10, target: 'enemy',
    effects: [{ kind: 'status', status: 'curse', duration: 10, stat: 'magPower', power: 0.25 }],
    defaultRule: R(ALWAYS, 'enemy_random', [{ type: 'target_missing_status', status: 'curse' }]) },
  e_regenerate:  { name: 'Regenerate', classId: 'enemy', type: 'heal', cost: 0, cooldown: 20, target: 'self',
    effects: [{ kind: 'status', status: 'regeneration', duration: 8, stat: 'physPower', power: 0.5 }],
    defaultRule: R([{ type: 'self_hp_below', value: 50 }], 'self') },
  e_chill:       { name: 'Chilling Touch', classId: 'enemy', type: 'debuff', cost: 0, cooldown: 7, target: 'enemy',
    effects: [{ kind: 'damage', stat: 'magPower', power: 1.0, school: 'magical' }, { kind: 'status', status: 'frostbite', duration: 6 }],
    defaultRule: R(ALWAYS, 'enemy_highest_threat') },
  e_weaken:      { name: 'Enfeeble', classId: 'enemy', type: 'debuff', cost: 0, cooldown: 12, target: 'enemy',
    effects: [{ kind: 'status', status: 'weakened', duration: 8 }],
    defaultRule: R(ALWAYS, 'enemy_random', [{ type: 'target_missing_status', status: 'weakened' }]) },
  e_frenzy:      { name: 'Frenzy', classId: 'enemy', type: 'buff', cost: 0, cooldown: 25, target: 'self',
    effects: [{ kind: 'status', status: 'battle_cry', duration: 8 }],
    defaultRule: R([{ type: 'self_hp_below', value: 60 }], 'self') },
  e_cleave:      { name: 'Brutal Cleave', classId: 'enemy', type: 'damage', cost: 0, cooldown: 8, target: 'enemy', area: true,
    effects: [{ kind: 'damage', stat: 'physPower', power: 1.0, school: 'physical' }],
    defaultRule: R([{ type: 'enemies_alive', cmp: '>=', value: 2 }], 'all_enemies') },
  e_void_bolt:   { name: 'Void Bolt', classId: 'enemy', type: 'damage', cost: 0, cooldown: 4, target: 'enemy',
    effects: [{ kind: 'damage', stat: 'magPower', power: 1.5, school: 'magical' }],
    defaultRule: R(ALWAYS, 'enemy_lowest_hp_pct') },
  // Boss specials
  b_war_stomp:   { name: 'War Stomp', classId: 'enemy', type: 'control', cost: 0, cooldown: 18, target: 'enemy', area: true,
    effects: [{ kind: 'damage', stat: 'physPower', power: 1.1, school: 'physical' }, { kind: 'status', status: 'stun', duration: 1.5 }],
    defaultRule: R(ALWAYS, 'all_enemies') },
  b_crushing_blow: { name: 'Crushing Blow', classId: 'enemy', type: 'damage', cost: 0, cooldown: 12, target: 'enemy',
    effects: [{ kind: 'damage', stat: 'physPower', power: 3.2, school: 'physical' }, { kind: 'status', status: 'sundered', duration: 8 }],
    defaultRule: R(ALWAYS, 'enemy_highest_threat') },
  b_inferno:     { name: 'Inferno', classId: 'enemy', type: 'damage', cost: 0, cooldown: 15, target: 'enemy', area: true,
    effects: [{ kind: 'damage', stat: 'magPower', power: 1.4, school: 'magical' }, { kind: 'status', status: 'burn', duration: 6, stat: 'magPower', power: 0.2 }],
    defaultRule: R(ALWAYS, 'all_enemies') },
  b_blizzard:    { name: 'Blizzard', classId: 'enemy', type: 'damage', cost: 0, cooldown: 16, target: 'enemy', area: true,
    effects: [{ kind: 'damage', stat: 'magPower', power: 1.2, school: 'magical' }, { kind: 'status', status: 'frostbite', duration: 8 }],
    defaultRule: R(ALWAYS, 'all_enemies') },
  b_void_rift:   { name: 'Void Rift', classId: 'enemy', type: 'damage', cost: 0, cooldown: 14, target: 'enemy', area: true,
    effects: [{ kind: 'damage', stat: 'magPower', power: 1.6, school: 'magical' }, { kind: 'status', status: 'exposed', duration: 8 }],
    defaultRule: R(ALWAYS, 'all_enemies') },
  b_annihilate:  { name: 'Annihilate', classId: 'enemy', type: 'damage', cost: 0, cooldown: 20, target: 'enemy',
    effects: [{ kind: 'damage', stat: 'magPower', power: 4.0, school: 'magical' }],
    defaultRule: R(ALWAYS, 'enemy_lowest_hp_pct') },
};

for (const [id, a] of Object.entries(ABILITIES)) a.id = id;

export function classAbilities(classId) {
  return Object.values(ABILITIES).filter(a => a.classId === classId).sort((a, b) => a.unlockLevel - b.unlockLevel);
}
