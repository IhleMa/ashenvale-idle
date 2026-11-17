// Central game balance settings — the numbers live in content/config.json.
import { CONTENT } from './content.js';

export const CONFIG = CONTENT.config;

export function xpToNext(level) {
  return Math.floor(CONFIG.xp.base * Math.pow(level, CONFIG.xp.exponent));
}

export function rarityById(id) {
  return CONFIG.rarities.find(r => r.id === id) || CONFIG.rarities[0];
}

export function rarityIndex(id) {
  return Math.max(0, CONFIG.rarities.findIndex(r => r.id === id));
}
