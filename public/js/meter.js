// Damage meter: aggregates the server's combat events into per-unit / per-ability statistics.
// Purely presentational — the numbers come from authoritative server events.
import { ABILITIES } from '/shared/data/abilities.js';
import { STATUSES } from '/shared/data/statuses.js';

export function createMeter(title = '') {
  return { title, duration: 0, units: {}, fights: 0 };
}

// Stable key so the same character is merged across fights (session totals)
export function unitKey(u) {
  return u.side === 'A' ? `A:${u.ownerId || ''}:${u.charId || u.name}` : `B:${u.defId}#${u.uid}`;
}

function entry(m, u) {
  const k = unitKey(u);
  if (!m.units[k]) {
    m.units[k] = {
      key: k, name: u.name, side: u.side, classId: u.classId || null, defId: u.defId, isMain: !!u.isMain,
      ownerName: u.ownerName || null, ownerId: u.ownerId || null, boss: !!u.boss, count: 0,
      dmg: { total: 0, byAbility: {}, byTarget: {} },
      heal: { total: 0, over: 0, byAbility: {}, byTarget: {} },
      taken: { total: 0, absorbed: 0, bySource: {}, byAbility: {} },
      casts: {}, deaths: 0, dodged: 0, missed: 0,
    };
  }
  return m.units[k];
}

const bump = (map, key, label) => (map[key] ||= { key, label, total: 0, hits: 0, crits: 0, max: 0, over: 0 });

export function abilityKey(ev) {
  if (ev.ability) return ev.ability;
  if (ev.dot) return `dot:${ev.dot}`;
  if (ev.hot) return `hot:${ev.hot}`;
  return 'auto';
}
export function abilityLabel(key) {
  if (key === 'auto') return 'Auto Attack';
  if (key.startsWith('dot:')) return `${STATUSES[key.slice(4)]?.name || key.slice(4)} (DoT)`;
  if (key.startsWith('hot:')) return `${STATUSES[key.slice(4)]?.name || key.slice(4)} (HoT)`;
  return ABILITIES[key]?.name || key;
}

// Record one battle event. units: Map uid -> unit
export function recordEvent(m, units, ev, time) {
  m.duration = Math.max(m.duration, time || 0);
  const src = units.get(ev.src), tgt = units.get(ev.tgt);
  switch (ev.type) {
    case 'damage': {
      if (!src || !tgt) return;
      const amount = ev.amount + (ev.absorbed || 0);
      const s = entry(m, src), t = entry(m, tgt);
      const ak = abilityKey(ev);
      s.dmg.total += amount;
      const a = bump(s.dmg.byAbility, ak, abilityLabel(ak));
      a.total += amount; a.hits++; if (ev.crit) a.crits++; a.max = Math.max(a.max, amount);
      const tk = unitKey(tgt);
      const bt = bump(s.dmg.byTarget, tk, tgt.name);
      bt.total += amount; bt.hits++; if (ev.crit) bt.crits++; bt.max = Math.max(bt.max, amount);
      t.taken.total += amount;
      t.taken.absorbed += ev.absorbed || 0;
      const bs = bump(t.taken.bySource, unitKey(src), src.name);
      bs.total += amount; bs.hits++; if (ev.crit) bs.crits++; bs.max = Math.max(bs.max, amount);
      const ba = bump(t.taken.byAbility, `${unitKey(src)}|${ak}`, `${abilityLabel(ak)} — ${src.name}`);
      ba.total += amount; ba.hits++; if (ev.crit) ba.crits++; ba.max = Math.max(ba.max, amount);
      break;
    }
    case 'heal': {
      if (!src || !tgt) return;
      const s = entry(m, src);
      const ak = abilityKey(ev);
      s.heal.total += ev.amount;
      s.heal.over += ev.overheal || 0;
      const a = bump(s.heal.byAbility, ak, abilityLabel(ak));
      a.total += ev.amount; a.over += ev.overheal || 0; a.hits++; if (ev.crit) a.crits++; a.max = Math.max(a.max, ev.amount);
      const bt = bump(s.heal.byTarget, unitKey(tgt), tgt.name);
      bt.total += ev.amount; bt.over += ev.overheal || 0; bt.hits++; if (ev.crit) bt.crits++; bt.max = Math.max(bt.max, ev.amount);
      break;
    }
    case 'ability': {
      if (!src) return;
      const s = entry(m, src);
      s.casts[ev.ability] = (s.casts[ev.ability] || 0) + 1;
      break;
    }
    case 'miss': {
      if (tgt) entry(m, tgt).dodged++;
      if (src) entry(m, src).missed++;
      break;
    }
    case 'death': if (tgt) entry(m, tgt).deaths++; break;
    default: break;
  }
}

// Make sure every unit in the fight appears even before it does anything
export function seedUnits(m, units) { for (const u of units.values()) { const e = entry(m, u); e.count = Math.max(e.count, 1); } }

function mergeStat(into, from) {
  for (const [k, v] of Object.entries(from)) {
    const t = (into[k] ||= { key: v.key, label: v.label, total: 0, hits: 0, crits: 0, max: 0, over: 0 });
    t.total += v.total; t.hits += v.hits; t.crits += v.crits; t.over += v.over || 0; t.max = Math.max(t.max, v.max);
  }
}

export function mergeMeter(into, from) {
  into.duration += from.duration;
  into.fights += 1;
  for (const u of Object.values(from.units)) {
    const key = u.side === 'B' ? `B:${u.defId}` : u.key; // enemies of the same type are combined in session totals
    const t = into.units[key] || (into.units[key] = JSON.parse(JSON.stringify({ ...u, key, dmg: { total: 0, byAbility: {}, byTarget: {} }, heal: { total: 0, over: 0, byAbility: {}, byTarget: {} }, taken: { total: 0, absorbed: 0, bySource: {}, byAbility: {} }, casts: {}, deaths: 0, dodged: 0, missed: 0, count: 0 })));
    t.count += 1;
    t.dmg.total += u.dmg.total; mergeStat(t.dmg.byAbility, u.dmg.byAbility); mergeStat(t.dmg.byTarget, u.dmg.byTarget);
    t.heal.total += u.heal.total; t.heal.over += u.heal.over; mergeStat(t.heal.byAbility, u.heal.byAbility); mergeStat(t.heal.byTarget, u.heal.byTarget);
    t.taken.total += u.taken.total; t.taken.absorbed += u.taken.absorbed; mergeStat(t.taken.bySource, u.taken.bySource); mergeStat(t.taken.byAbility, u.taken.byAbility);
    for (const [a, n] of Object.entries(u.casts)) t.casts[a] = (t.casts[a] || 0) + n;
    t.deaths += u.deaths; t.dodged += u.dodged; t.missed += u.missed;
  }
}
