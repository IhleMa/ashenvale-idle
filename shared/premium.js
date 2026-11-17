// Premium currency ("Ashen Crystals"): finish timers instantly.
import { CONFIG } from './config.js';

export const PREMIUM = CONFIG.premium; // content/config.json → premium

// Cost to skip `remainingMs` at a rate of `minutesPerCrystal` (at least 1 crystal)
export function speedUpCost(remainingMs, minutesPerCrystal = 10) {
  if (remainingMs <= 0) return 0;
  return Math.max(1, Math.ceil(remainingMs / 60000 / Math.max(1, minutesPerCrystal)));
}
