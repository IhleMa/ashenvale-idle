// Cosmetics bought with gold (a gold sink with no power): name colours, titles, portrait frames and profile borders
// (around the inspect window). Defined in content/cosmetics/{name_colors,titles,frames,borders}/. A title with "achievement" is earned, not bought.
import { CONTENT, withIds, onContentReload } from '../content.js';

export const COSMETIC_KINDS = {
  color: { key: 'nameColors', label: 'Name colour', plural: 'Name colours' },
  title: { key: 'titles', label: 'Title', plural: 'Titles' },
  frame: { key: 'frames', label: 'Portrait frame', plural: 'Portrait frames' },
  border: { key: 'borders', label: 'Profile border', plural: 'Profile borders' },
};
export const COSMETIC_TIERS = { basic: 'Basic', fine: 'Fine', prestige: 'Prestige', legendary: 'Legendary', earned: 'Earned' };
export const COSMETICS = {};
const load = () => { for (const [kind, k] of Object.entries(COSMETIC_KINDS)) COSMETICS[kind] = withIds(CONTENT.cosmetics?.[k.key] || {}); };
load();
onContentReload(load);

export const cosmetic = (kind, id) => (id ? COSMETICS[kind]?.[id] || null : null);
// a player owns a cosmetic when bought, or (earned titles) when the achievement is done
export function ownsCosmetic(p, kind, id) {
  const c = cosmetic(kind, id);
  if (!c) return false;
  if (c.achievement) return !!p.achievements?.[c.achievement];
  return !!p.cosmetics?.owned?.includes(`${kind}:${id}`);
}
// what other players see: only ids that still exist and are owned
export function publicCosmetics(p) {
  const eq = p.cosmetics?.equipped || {};
  const out = {};
  for (const kind of Object.keys(COSMETIC_KINDS)) if (eq[kind] && ownsCosmetic(p, kind, eq[kind])) out[kind] = eq[kind];
  return Object.keys(out).length ? out : null;
}
