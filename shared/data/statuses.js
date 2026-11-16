// Status effect definitions (buffs & debuffs).
// mods: percentage modifiers applied while active (per stack where stackable).
// tick: periodic effect every CONFIG.combat.statusTickInterval seconds; value is set by the applying ability.
export const STATUSES = {
  // --- Debuffs ---
  poison:    { name: 'Poison',    type: 'debuff', tick: 'damage', school: 'physical', ignoreArmor: true, maxStacks: 5, description: 'Takes physical damage every second. Stacks.' },
  bleed:     { name: 'Bleed',     type: 'debuff', tick: 'damage', school: 'physical', ignoreArmor: true, maxStacks: 3, description: 'Bleeding for damage every second.' },
  burn:      { name: 'Burn',      type: 'debuff', tick: 'damage', school: 'magical',  maxStacks: 3, description: 'Burning for magical damage every second.' },
  frostbite: { name: 'Frostbite', type: 'debuff', mods: { attackSpeedPct: -0.25 }, description: 'Attack speed reduced by 25%.' },
  stun:      { name: 'Stun',      type: 'debuff', control: 'stun', description: 'Cannot act.' },
  weakened:  { name: 'Weakened',  type: 'debuff', mods: { damagePct: -0.2 }, description: 'Deals 20% less damage.' },
  exposed:   { name: 'Exposed',   type: 'debuff', mods: { damageTakenPct: 0.15 }, description: 'Takes 15% more damage.' },
  marked:    { name: "Hunter's Mark", type: 'debuff', mods: { damageTakenPct: 0.10 }, description: 'Takes 10% more damage.' },
  sundered:  { name: 'Sundered',  type: 'debuff', mods: { defensePct: -0.3 }, description: 'Defense reduced by 30%.' },
  curse:     { name: 'Curse',     type: 'debuff', tick: 'damage', school: 'magical', mods: { healingTakenPct: -0.5 }, description: 'Shadow damage over time, healing received halved.' },

  // --- Buffs ---
  shield_wall:  { name: 'Shield Wall',  type: 'buff', mods: { damageTakenPct: -0.45 }, description: 'Takes 45% less damage.' },
  taunting:     { name: 'Taunting',     type: 'buff', description: 'Enemies are forced to attack this unit.' },
  fortified:    { name: 'Fortified',    type: 'buff', mods: { defensePct: 0.35 }, description: 'Defense increased by 35%.' },
  battle_cry:   { name: 'Battle Cry',   type: 'buff', mods: { damagePct: 0.15 }, description: 'Deals 15% more damage.' },
  renew:        { name: 'Renew',        type: 'buff', tick: 'heal', description: 'Restores health every second.' },
  barrier:      { name: 'Barrier',      type: 'buff', absorb: true, description: 'Absorbs incoming damage.' },
  blessing:     { name: 'Blessing',     type: 'buff', mods: { damagePct: 0.08, defensePct: 0.15 }, description: '+8% damage, +15% defense.' },
  evasion:      { name: 'Evasion',      type: 'buff', mods: { dodge: 0.5 }, description: '50% chance to dodge attacks.' },
  rapid_fire:   { name: 'Rapid Fire',   type: 'buff', mods: { attackSpeedPct: 0.4 }, description: 'Attack speed +40%.' },
  arcane_power: { name: 'Arcane Power', type: 'buff', mods: { damagePct: 0.25 }, description: 'Deals 25% more damage.' },
  enrage:       { name: 'Enrage',       type: 'buff', mods: { damagePct: 0.5, attackSpeedPct: 0.3 }, description: 'Greatly increased damage and speed.' },
  stone_skin:   { name: 'Stone Skin',   type: 'buff', mods: { damageTakenPct: -0.7 }, description: 'Takes 70% less damage.' },
  regeneration: { name: 'Regeneration', type: 'buff', tick: 'heal', description: 'Regenerating health.' },
};

export const STATUS_IDS = Object.keys(STATUSES);
