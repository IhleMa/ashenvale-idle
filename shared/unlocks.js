// Features that open up as the hero levels (config.json → featureUnlocks: { feature: heroLevel }).
// A hero that has ascended once keeps everything unlocked, even while levelling again.
import { CONFIG } from './config.js';

export const FEATURE_LABELS = { quests: 'Quests', auction: 'Trading on the Auction House', bestiary: 'The Bestiary', multiplayer: 'Co-op', arena: 'The Arena', rifts: 'Rifts', gems: 'Gems', pinnacle: 'Pinnacle bosses' };

// actions that need a feature (others, e.g. collecting mail or removing a gem, always work)
export const ACTION_FEATURE = {
  quest_claim: 'quests', quest_reroll: 'quests',
  ah_list: 'auction', ah_buy: 'auction',
  group_create: 'multiplayer', group_invite: 'multiplayer', group_accept: 'multiplayer', group_start: 'multiplayer',
  rift_start: 'rifts',
  pinnacle_start: 'pinnacle',
  arena_set_party: 'arena', arena_attack: 'arena', arena_refresh: 'arena',
  gem_cut: 'gems', gem_fuse: 'gems', gem_socket: 'gems', gem_drill: 'gems',
};

export function unlockLevelOf(feature) { return CONFIG.featureUnlocks?.[feature] || 0; }

// hero level that counts for unlocks
export function unlockHeroLevel(p) {
  const h = p?.characters?.[p.heroId];
  if (!h) return 0;
  return h.ascensions ? CONFIG.levelCap : h.level;
}

// 0 when open, otherwise the hero level needed
export function featureLock(p, feature) {
  if (!p?.characters?.[p.heroId]) return 0; // no player data yet: don't report locks
  const need = unlockLevelOf(feature);
  return need && unlockHeroLevel(p) < need ? need : 0;
}
