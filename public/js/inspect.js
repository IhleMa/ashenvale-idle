// "Inspect player" window: public profile with hero, gear, skill tree, loadout, party and group.
import { describeChanges } from '/shared/mutators.js';
import { classLabel } from '/shared/data/subclasses.js';
import { state } from './state.js';
import { act } from './net.js';
import { esc, fmt, pct, modal, run, tipAttr, itemTooltipHtml, duration, botTag, nameHtml, framed, heroNameHtml, borderStyle, borderOf } from './ui.js';
import { portrait, classIcon, itemIcon, slotIcon, abilityIcon } from './assets.js';
import { classBadge, roleBadge } from './components.js';
import { CLASSES, TRAITS } from '/shared/data/classes.js';
import { ABILITIES } from '/shared/data/abilities.js';
import { SLOT_IDS, SLOTS } from '/shared/data/items.js';
import { ACHIEVEMENTS } from '/shared/data/achievements.js';
import { ZONES } from '/shared/data/zones.js';
import { CONDITIONS, SELECTORS, describeCondition } from '/shared/rules.js';
import { getTree, describeNodeStats } from '/shared/data/skilltree.js';
import { ATTRIBUTES } from '/shared/stats.js';

const RANK_LABELS = { level: 'Level', power: 'Party power', heroPower: 'Hero power', kills: 'Kills', bossKills: 'Bosses', coopWins: 'Co-op', achievements: 'Achievements', progress: 'Progress' };

export async function openInspect(name) {
  const m = modal('<div class="inspect-loading muted">Loading profile…</div>', { wide: true });
  m.el.classList.add('inspect-modal');
  let prof;
  try { prof = await act('inspect_player', { name }); } catch (e) { m.el.innerHTML = `<button class="modal-x" data-close>✕</button><p class="error">${esc(e.message)}</p>`; return; }
  m.el.innerHTML = `<button class="modal-x" data-close aria-label="Close">✕</button>${profileHtml(prof)}`;
  // profile border (cosmetic): a host around the window carries the ring and its effects
  const bst = borderStyle(borderOf(prof.name));
  if (bst) {
    const host = document.createElement('div');
    host.className = `${bst.cls} cos-border-modal`;
    host.setAttribute('style', bst.style);
    m.el.replaceWith(host);
    host.appendChild(m.el);
  }
  m.el.addEventListener('click', async e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.inspectName) { m.close(); openInspect(t.dataset.inspectName); return; }
    if ('invite' in t.dataset) {
      if (!state.group) await run(act('group_create'));
      await run(act('group_invite', { name: prof.name }), `Invitation sent to ${prof.name}.`);
    }
    const tab = t.dataset.itab;
    if (tab) {
      m.el.querySelectorAll('[data-itab]').forEach(b => b.classList.toggle('active', b === t));
      m.el.querySelectorAll('[data-ipane]').forEach(p => { p.hidden = p.dataset.ipane !== tab; });
    }
  });
}

function activityText(a) {
  switch (a.state) {
    case 'coop': return `<span class="act-dot coop"></span>In co-op: <b>${esc(a.title)}</b> (wave ${a.wave}/${a.waves})`;
    case 'boss': return `<span class="act-dot boss"></span>Fighting a boss: <b>${esc(a.title)}</b>`;
    case 'fighting': return `<span class="act-dot on"></span>Fighting in <b>${esc(a.title)}</b>`;
    case 'resting': return `<span class="act-dot on"></span>Resting in ${esc(a.title || '')}`;
    default: return `<span class="act-dot"></span>Offline${a.lastSeen ? ` · last seen ${duration((Date.now() - a.lastSeen) / 1000)} ago` : ''}`;
  }
}

function profileHtml(p) {
  const h = p.hero;
  const me = state.player?.id === p.id;
  const canInvite = !me && p.online && !p.group && (!state.group || state.group.leaderId === state.player.id);
  const ranks = Object.entries(p.ranks).filter(([, r]) => r).sort((a, b) => a[1] - b[1]).slice(0, 5);
  return `
  <div class="inspect-head">
    ${framed(portrait(h, 'lg'), p.name)}
    <div class="grow">
      <h2>${nameHtml(p.name)}${botTag(p)} ${me ? '<span class="tag hero">YOU</span>' : ''}</h2>
      <div><b>${heroNameHtml(h.name, p.name)}</b> · ${esc(h.title || '')} · Lv ${h.level} ${classBadge(h.classId, h.subclass)}</div>
      <div class="small muted inspect-activity">${activityText(p.activity)}</div>
      <div class="rank-chips">${ranks.map(([k, r]) => `<span class="rank-chip ${r <= 3 ? 'top' : ''}">#${r} ${RANK_LABELS[k]}</span>`).join('')}</div>
    </div>
    ${canInvite ? '<button class="btn primary small" data-invite>Invite to group</button>' : ''}
  </div>
  ${p.hidden ? '<div class="notice small">This player keeps their build private — only a summary is shown.</div>' : ''}
  <div class="tabs inspect-tabs">
    <button class="tab active" data-itab="overview">Overview</button>
    ${p.hidden ? '' : '<button class="tab" data-itab="hero">Hero build</button>'}
    <button class="tab" data-itab="party">Party</button>
  </div>
  <div data-ipane="overview">${overviewHtml(p)}</div>
  ${p.hidden ? '' : `<div data-ipane="hero" hidden>${charDetailHtml(h, p.name)}</div>`}
  <div data-ipane="party" hidden>${partyHtml(p)}</div>`;
}

function overviewHtml(p) {
  const g = p.group;
  const zones = Object.values(ZONES).sort((a, b) => a.order - b.order);
  return `<div class="inspect-grid">
    <section class="panel">
      <h3>Group</h3>
      ${g ? `<div class="small muted">${g.inBattle ? `⚔ Fighting <b>${esc(g.encounter || 'an encounter')}</b>` : 'Not in an encounter'}</div>
        <div class="group-mini">${g.members.map(m => `<div class="bench-row">${m.hero ? framed(portrait(m.hero, 'xs'), m.name) : ''}<div class="grow"><b>${m.leader ? '👑 ' : ''}${nameHtml(m.name)}</b>${botTag(m)} <span class="conn-dot ${m.online ? 'on' : ''}"></span>
          <div class="muted small">${m.hero ? `${heroNameHtml(m.hero.name, m.name)} · Lv ${m.hero.level} ${esc(classLabel(m.hero.classId, m.hero.subclass))}` : ''}</div></div>
          ${m.name !== p.name ? `<button class="btn tiny ghost" data-inspect-name="${esc(m.name)}">Inspect</button>` : ''}</div>`).join('')}</div>`
        : '<p class="muted small">Not in a group.</p>'}
    </section>
    <section class="panel">
      <h3>Statistics</h3>
      <div class="stat-grid">
        ${[['Party power', p.summary.partyPower], ['Hero power', p.summary.heroPower], ['Enemies slain', p.stats.kills], ['Bosses slain', p.stats.bossKills], ['Co-op victories', p.stats.coopWins], ['Fights', p.stats.fights], ['Companions recruited', p.stats.recruited], ['Epic+ items found', p.stats.epicFound]]
          .map(([l, v]) => `<div class="stat-row"><span>${l}</span><b>${fmt(v || 0)}</b></div>`).join('')}
      </div>
      <div class="small muted" style="margin-top:8px">Playing since ${new Date(p.createdAt).toLocaleDateString()}</div>
    </section>
    <section class="panel">
      <h3>World progress</h3>
      <div class="zone-pips">${zones.map(z => `<span class="zone-pip ${p.unlockedZones.includes(z.id) ? 'on' : ''} ${z.id === p.zone ? 'here' : ''}" ${tipAttr(`${esc(z.name)}${z.id === p.zone ? ' (current zone)' : ''}`)}>${esc(z.name)}</span>`).join('')}</div>
      <h3 style="margin-top:12px">Achievements <span class="muted small">${p.achievements.length}/${Object.keys(ACHIEVEMENTS).length}</span></h3>
      <div class="ach-pips">${Object.values(ACHIEVEMENTS).map(a => `<span class="ach-pip ${p.achievements.includes(a.id) ? 'on' : ''}" ${tipAttr(`<b>${esc(a.name)}</b><br>${esc(a.description)}`)}>★</span>`).join('')}</div>
    </section>
  </div>`;
}

function ruleText(abilityId, rule) {
  if (!rule) return '';
  if (rule.enabled === false) return 'Disabled';
  const when = rule.conditions?.length ? rule.conditions.map(describeCondition).join(rule.mode === 'any' ? ' OR ' : ' AND ') : 'always';
  const tgt = SELECTORS[rule.target?.selector]?.label || '';
  const tc = rule.targetConditions?.length ? `; only if ${rule.targetConditions.map(describeCondition).join(', ')}` : '';
  return `${tgt} — when ${when}${tc}`;
}

function charDetailHtml(c, owner) {
  const s = c.stats;
  const tree = getTree(c.classId, c.subclass);
  const notable = c.tree.notables;
  const bonus = describeNodeStats(c.tree.bonuses);
  return `<div class="inspect-grid">
    <section class="panel">
      <div class="row gap">${c.isMain ? framed(portrait(c, 'md'), owner) : portrait(c, 'md')}<div><b>${c.isMain ? '★ ' + heroNameHtml(c.name, owner) : esc(c.name)}</b> <span class="muted small">Lv ${c.level} · ${esc(c.title || '')}</span><div>${classBadge(c.classId, c.subclass)} ${roleBadge(c.role)}${c.trait ? ` <span class="trait">${esc(TRAITS[c.trait]?.name || '')}</span>` : ''}</div></div></div>
      <div class="attr-preview" style="margin-top:10px">${Object.entries(ATTRIBUTES).map(([k, a]) => `<div><span>${a.label}</span><b>${s.attributes[k]}</b></div>`).join('')}</div>
      <div class="stat-grid">
        ${[['Health', fmt(s.maxHp)], ['Physical Power', fmt(s.physPower)], ['Magic Power', fmt(s.magPower)], ['Healing Power', fmt(s.healPower)], ['Defense', fmt(s.defense)], ['Crit Chance', pct(s.critChance)], ['Crit Damage', pct(s.critDamage, 0)], ['Attack Speed', pct(s.attackSpeed, 0)], ['Power rating', fmt(c.power)]]
          .map(([l, v]) => `<div class="stat-row"><span>${l}</span><b>${v}</b></div>`).join('')}
      </div>
      <h4>Equipment</h4>
      <div class="equip-icons">${SLOT_IDS.map(sl => { const it = c.equipment[sl]; return `<span class="equip-icon" ${it ? tipAttr(itemTooltipHtml(it)) : tipAttr(`${esc(SLOTS[sl].label)}: empty`)}>${it ? itemIcon(it, 'sm') : slotIcon(sl, 'sm')}</span>`; }).join('')}</div>
    </section>
    <section class="panel">
      <h3>Skill tree <span class="muted small">${c.tree.spent}/${c.tree.total} points</span></h3>
      ${miniTree(c.classId, c.tree.allocated, c.subclass)}
      <div class="small">${notable.length ? notable.map(n => `<span class="notable-chip ${n.type}" ${tipAttr(n.mutator ? `${esc(n.description || '')}<br>${describeChanges(n.mutator.changes).map(esc).join(', ')}` : describeNodeStats(n.stats).map(esc).join('<br>'))}>${n.type === 'keystone' ? '✹' : n.type === 'mutator' ? '✦' : '◆'} ${esc(n.name)}</span>`).join(' ') : '<span class="muted">No notables yet.</span>'}</div>
      ${bonus.length ? `<ul class="tree-summary" style="margin-top:8px">${bonus.map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
    </section>
    <section class="panel">
      <h3>Combat loadout</h3>
      <ol class="inspect-loadout">${c.loadout.map(a => `<li>${abilityIcon(a, 'sm')}<div><b>${esc(ABILITIES[a]?.name)}</b> <span class="muted small">Rank ${c.ranks[a] || 1}</span><div class="small muted">${esc(ruleText(a, c.rules?.[a]))}</div></div></li>`).join('') || '<li class="muted">No abilities equipped.</li>'}</ol>
      <div class="small faint">Learned: ${Object.keys(c.ranks).map(a => esc(ABILITIES[a]?.name)).join(', ')}</div>
    </section>
  </div>`;
}

function partyHtml(p) {
  return `<div class="inspect-party">${p.party.map(c => `<div class="panel inspect-member">
    <div class="row gap">${c.isMain ? framed(portrait(c, 'md'), p.name) : portrait(c, 'md')}<div class="grow"><b>${c.isMain ? '★ ' + heroNameHtml(c.name, p.name) : esc(c.name)}</b> <span class="muted small">Lv ${c.level} · ${esc(c.title || '')}</span>
      <div>${classBadge(c.classId, c.subclass)} ${roleBadge(c.role)} <span class="muted small">Power ${fmt(c.power)}</span></div></div></div>
    <div class="row gap wrap" style="margin-top:8px">${c.loadout.map(a => `<span ${tipAttr(`<b>${esc(ABILITIES[a]?.name)}</b> (rank ${c.ranks[a] || 1})${c.rules ? `<br>${esc(ruleText(a, c.rules[a]))}` : ''}`)}>${abilityIcon(a, 'xs')}</span>`).join('')}</div>
    ${c.equipment ? `<div class="equip-icons small-icons">${SLOT_IDS.map(sl => { const it = c.equipment[sl]; return it ? `<span ${tipAttr(itemTooltipHtml(it))}>${itemIcon(it, 'xs')}</span>` : `<span>${slotIcon(sl, 'xs')}</span>`; }).join('')}</div>` : ''}
    ${c.tree ? `<div class="small muted">Skill tree: ${c.tree.spent}/${c.tree.total} points${c.tree.notables.length ? ' · ' + c.tree.notables.map(n => esc(n.name)).join(', ') : ''}</div>` : ''}
  </div>`).join('')}</div>`;
}

// Small read-only rendering of a skill tree
function miniTree(classId, allocated, subclass = null) {
  const tree = getTree(classId, subclass);
  const set = new Set(allocated);
  const R = tree.radius + 40;
  const seen = new Set();
  let lines = '';
  for (const n of Object.values(tree.nodes)) for (const l of n.links) {
    const k = n.id < l ? n.id + l : l + n.id;
    if (seen.has(k)) continue;
    seen.add(k);
    const m = tree.nodes[l];
    lines += `<line x1="${n.x}" y1="${n.y}" x2="${m.x}" y2="${m.y}" class="${set.has(n.id) && set.has(l) ? 'on' : ''}"/>`;
  }
  const size = { start: 22, ability: 16, keystone: 18, notable: 13, mutator: 13, rank: 9, small: 7 };
  const nodes = Object.values(tree.nodes).map(n => `<circle cx="${n.x}" cy="${n.y}" r="${size[n.type]}" class="t-${n.type} ${set.has(n.id) ? 'on' : ''}"><title>${esc(n.name)}</title></circle>`).join('');
  return `<svg class="mini-tree" viewBox="${-R} ${-R} ${R * 2} ${R * 2}" style="--cc:${CLASSES[classId].color}">${lines}${nodes}</svg>`;
}

export { classIcon };
