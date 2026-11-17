// Central game balance settings — the numbers live in content/config.json.
import { CONTENT, onContentReload } from './content.js';
import { makeCurve } from './curve.js';

export const CONFIG = CONTENT.config;

// XP needed to go from "level" to the next one: content/config.json → xp.
// With xp.curve (control points [[level, xp], …], edited in Admin → 📈 XP curve) the value follows a smooth
// curve through those points; without it, the formula base × level^exponent.
let curveCache = null;
onContentReload(() => { curveCache = null; });
export function xpToNext(level) {
  const x = CONFIG.xp;
  if (Array.isArray(x.curve) && x.curve.length) {
    if (!curveCache) curveCache = makeCurve(x.curve);
    return Math.max(1, Math.round(curveCache(level)));
  }
  return Math.floor(x.base * Math.pow(level, x.exponent));
}
// the formula, for comparison in the editor
export const xpFormula = (level, xp = CONFIG.xp) => Math.floor(xp.base * Math.pow(level, xp.exponent));

export function rarityById(id) {
  return CONFIG.rarities.find(r => r.id === id) || CONFIG.rarities[0];
}

export function rarityIndex(id) {
  return Math.max(0, CONFIG.rarities.findIndex(r => r.id === id));
}
