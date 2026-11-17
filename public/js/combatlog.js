// Structured combat log: turns server events into categorized entries and filters them.
import { ABILITIES } from '/shared/data/abilities.js';
import { STATUSES } from '/shared/data/statuses.js';
import { esc, fmt } from './ui.js';
import { unitKey } from './meter.js';

export const LOG_CATEGORIES = {
  hit:    { label: 'Ability hits', tip: 'Damage from abilities' },
  auto:   { label: 'Auto-attacks', tip: 'Basic attack damage' },
  dot:    { label: 'DoT ticks', tip: 'Poison, bleed, burn… ticks' },
  heal:   { label: 'Heals', tip: 'Direct healing' },
  hot:    { label: 'HoT ticks', tip: 'Renew, regeneration… ticks' },
  cast:   { label: 'Buffs & utility', tip: 'Non-damaging ability casts and cleanses' },
  status: { label: 'Status applied', tip: 'Every buff/debuff application (very spammy)' },
  miss:   { label: 'Dodges', tip: 'Dodged attacks' },
  event:  { label: 'Key events', tip: 'Deaths, boss phases, waves, results' },
};

export const PRESETS = {
  quiet:   { label: 'Key events', cats: ['event'] },
  default: { label: 'Default', cats: ['hit', 'heal', 'cast', 'event'] },
  all:     { label: 'Everything', cats: Object.keys(LOG_CATEGORIES) },
};

const STORE_KEY = 'ashenvale.logFilter.v2';
export function loadFilter() {
  const def = { cats: Object.fromEntries(Object.keys(LOG_CATEGORIES).map(c => [c, PRESETS.default.cats.includes(c)])), source: 'all', critsOnly: false, minAmount: 0, search: '', autoscroll: true };
  try { return { ...def, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') }; } catch { return def; }
}
export function saveFilter(f) { try { localStorage.setItem(STORE_KEY, JSON.stringify({ ...f, search: '' })); } catch { /* ignore */ } }

function nameOf(units, uid) {
  const u = units.get(uid);
  if (!u) return '?';
  return `<span class="log-name ${u.side === 'A' ? 'ally' : 'foe'}">${esc(u.name)}</span>`;
}

// Returns an entry object (or null) for one server event
export function makeEntry(units, ev, time) {
  const src = units.get(ev.src), tgt = units.get(ev.tgt);
  const base = { t: time, src: src ? unitKey(src) : null, tgt: tgt ? unitKey(tgt) : null, srcSide: src?.side || null, srcOwner: src?.ownerId || null, tgtOwner: tgt?.ownerId || null, amount: 0, crit: false };
  const ab = ev.ability ? ABILITIES[ev.ability]?.name : null;
  const crit = ev.crit ? ' <span class="log-crit">CRIT</span>' : '';
  switch (ev.type) {
    case 'ability': {
      const a = ABILITIES[ev.ability];
      if (a && a.effects.some(e => e.kind === 'damage' || e.kind === 'heal')) return null; // described by hit/heal lines
      const tg = ev.tgts.length > 1 ? (units.get(ev.tgts[0])?.side === src?.side ? 'the party' : 'all enemies') : nameOf(units, ev.tgts[0]);
      return { ...base, cat: 'cast', html: `${nameOf(units, ev.src)} uses <b>${esc(a?.name)}</b>${ev.tgts[0] === ev.src && ev.tgts.length === 1 ? '' : ` on ${tg}`}.` };
    }
    case 'damage': {
      const cat = ev.dot ? 'dot' : (ev.ability || ev.proc) ? 'hit' : 'auto';
      const how = ev.dot ? `<i>${esc(STATUSES[ev.dot]?.name)}</i> (${nameOf(units, ev.src)}) deals` : `${nameOf(units, ev.src)}'s ${ab ? `<b>${esc(ab)}</b>` : ev.proc ? `<span class="log-proc">${esc(ev.proc)}</span>` : 'attack'} hits`;
      const abs = ev.absorbed ? ` <span class="muted">(${fmt(ev.absorbed)} absorbed)</span>` : '';
      return { ...base, cat, amount: ev.amount + (ev.absorbed || 0), crit: !!ev.crit, html: `${how} ${nameOf(units, ev.tgt)} for <span class="log-dmg">${fmt(ev.amount)}</span>${crit}${abs}` };
    }
    case 'heal': {
      if (ev.amount <= 0) return null;
      const over = ev.overheal ? ` <span class="muted">(${fmt(ev.overheal)} over)</span>` : '';
      return { ...base, cat: ev.hot ? 'hot' : 'heal', amount: ev.amount, crit: !!ev.crit, html: `${nameOf(units, ev.src)}'s ${ev.hot ? `<i>${esc(STATUSES[ev.hot]?.name)}</i>` : `<b>${esc(ab || 'heal')}</b>`} heals ${nameOf(units, ev.tgt)} for <span class="log-heal">${fmt(ev.amount)}</span>${crit}${over}` };
    }
    case 'status': {
      const st = STATUSES[ev.status];
      if (!st) return null;
      return { ...base, cat: 'status', html: `${nameOf(units, ev.tgt)} ${st.type === 'buff' ? 'gains' : 'suffers'} <span class="${st.type === 'buff' ? 'log-buff' : 'log-debuff'}">${esc(st.name)}</span>${ev.src !== ev.tgt ? ` from ${nameOf(units, ev.src)}` : ''}.` };
    }
    case 'proc': return { ...base, cat: 'cast', html: `<span class="log-proc">✦ ${esc(ev.name)}</span> triggers for ${nameOf(units, ev.src)}${ev.tgt !== ev.src ? ` on ${nameOf(units, ev.tgt)}` : ''}.` };
    case 'miss': return { ...base, cat: 'miss', html: `${nameOf(units, ev.tgt)} dodges ${nameOf(units, ev.src)}'s attack.` };
    case 'cleanse': return { ...base, cat: 'cast', html: `${nameOf(units, ev.src)} removes ${esc(STATUSES[ev.status]?.name)} from ${nameOf(units, ev.tgt)}.` };
    case 'death': return { ...base, cat: 'event', html: `<span class="log-death">☠ ${nameOf(units, ev.tgt)} has fallen.</span>` };
    case 'phase': return { ...base, cat: 'event', html: `<span class="log-phase">⚠ ${esc(ev.message)}</span>` };
    case 'spawn': return { ...base, cat: 'event', html: `${esc(ev.unit.name)} joins the fight!` };
    case 'wave': return ev.total > 1 ? { ...base, cat: 'event', html: `<span class="log-phase">Wave ${ev.wave} of ${ev.total}</span>` } : null;
    default: return null;
  }
}

export function passes(e, f, myId) {
  if (e.cat === 'sep') return true;
  if (!f.cats[e.cat]) return false;
  if (e.cat !== 'event') {
    if (f.critsOnly && !e.crit) return false;
    if (f.minAmount > 0 && e.amount < f.minAmount && (e.cat === 'hit' || e.cat === 'auto' || e.cat === 'dot' || e.cat === 'heal' || e.cat === 'hot')) return false;
    const s = f.source;
    if (s === 'party' && e.srcSide !== 'A') return false;
    if (s === 'enemies' && e.srcSide !== 'B') return false;
    if (s === 'mine' && e.srcOwner !== myId && e.tgtOwner !== myId) return false;
    if (s.startsWith('u:') && e.src !== s.slice(2) && e.tgt !== s.slice(2)) return false;
  }
  if (f.search) {
    const text = e.text ??= e.html.replace(/<[^>]+>/g, '').toLowerCase();
    if (!text.includes(f.search)) return false;
  }
  return true;
}
