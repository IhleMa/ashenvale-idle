// Premium currency ("Ashen Crystals"): finish timers instantly.
export const PREMIUM = { name: 'Ashen Crystals', short: 'Crystals', glyph: '💠' };

// Cost to skip `remainingMs` at a rate of `minutesPerCrystal` (at least 1 crystal)
export function speedUpCost(remainingMs, minutesPerCrystal = 10) {
  if (remainingMs <= 0) return 0;
  return Math.max(1, Math.ceil(remainingMs / 60000 / Math.max(1, minutesPerCrystal)));
}
