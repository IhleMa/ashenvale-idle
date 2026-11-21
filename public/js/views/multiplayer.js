// Multiplayer: groups, invitations, co-op team selection, encounters and group chat.
import { morphed } from '../morph.js';
import { classLabel } from '/shared/data/subclasses.js';
import { state, chars, bus } from '../state.js';
import { act } from '../net.js';
import { esc, run, tipAttr, botTag, nameHtml, framed, heroNameHtml } from '../ui.js';
import { portrait, classIcon, backgroundStyle } from '../assets.js';
import { classBadge } from '../components.js';
import { openInspect } from '../inspect.js';
import { busyWith } from '/shared/expeditions.js';
import { CONFIG } from '/shared/config.js';
import { COOP_ENCOUNTERS } from '/shared/data/zones.js';
import { ENEMIES } from '/shared/data/enemies.js';
import { CLASSES } from '/shared/data/classes.js';

let unsub = null;
const MAX_PICKS = CONFIG.coop.recruitsPerPlayer ?? 1;
const ROLE_LABEL = r => CONFIG.roles[r]?.label || r;

export const multiplayerView = {
  id: 'multiplayer', label: 'Multiplayer', icon: '🤝',
  unmount() { unsub?.(); unsub = null; },
  mount(root) {
    // keep chat live even while the player is typing (full re-renders are deferred during typing)
    unsub = bus.on('msg:group', m => {
      const lines = root.querySelector('.chat-lines');
      if (!lines || !m.group) return;
      lines.innerHTML = m.group.chat.map(c => `<div class="chat-line ${c.from ? '' : 'system'}">${c.from ? `<b>${nameHtml(c.from, { title: false })}:</b> ` : ''}${esc(c.text)}</div>`).join('');
      lines.scrollTop = lines.scrollHeight;
    });
    root.addEventListener('click', async e => {
      const t = e.target.closest('button');
      if (!t) return;
      const d = t.dataset;
      if ('create' in d) await run(act('group_create'), 'Group created.');
      if ('leave' in d) await run(act('group_leave'));
      if (d.invite) await run(act('group_invite', { name: d.invite }), `Invitation sent to ${d.invite}.`);
      if ('inviteName' in d) {
        const input = root.querySelector('#invite-name');
        if (input.value.trim()) { await run(act('group_invite', { name: input.value.trim() }), 'Invitation sent.'); input.value = ''; }
      }
      if (d.inspect) { openInspect(d.inspect); return; }
      if (d.accept) await run(act('group_accept', { groupId: d.accept }), 'You joined the group!');
      if (d.decline) await run(act('group_decline', { groupId: d.decline }));
      if (d.kick) await run(act('group_kick', { playerId: d.kick }));
      if (d.promote) await run(act('group_promote', { playerId: d.promote }));
      // leader: let a member's offered recruit fight or sit out; 'auto' hands it back to the automatic choice
      if (d.recruitToggle) {
        const g = state.group;
        const fighting = g.members.filter(m => m.characters.some(c => !c.isMain)).map(m => m.id);
        const ids = fighting.includes(d.recruitToggle) ? fighting.filter(id => id !== d.recruitToggle) : [...fighting, d.recruitToggle];
        await run(act('group_set_recruits', { playerIds: ids }));
      }
      if ('recruitAuto' in d) await run(act('group_set_recruits', { playerIds: null }));
      if (d.start) {
        if (!state.group) await run(act('group_create'));
        if (await run(act('group_start', { encounterId: d.start })) !== undefined) location.hash = '#/combat';
      }
      if (d.coopToggle) {
        const p = state.player;
        const cur = p.coopChars.length ? p.coopChars : p.parties[p.activeParty].members.filter(id => id !== p.heroId).slice(0, MAX_PICKS);
        const next = cur.includes(d.coopToggle) ? cur.filter(x => x !== d.coopToggle) : [...cur, d.coopToggle].slice(-MAX_PICKS);
        await run(act('set_coop_chars', { charIds: next }));
      }
    });
    root.addEventListener('submit', async e => {
      e.preventDefault();
      const input = e.target.querySelector('input');
      if (e.target.matches('#chat-form') && input.value.trim()) {
        await run(act('group_chat', { text: input.value }));
        input.value = '';
      }
    });
  },
  render(root) {
    const p = state.player;
    const g = state.group;
    const me = p.id;
    const isLeader = g?.leaderId === me;
    const chatFocused = document.activeElement?.closest?.('#chat-form');
    morphed(root).innerHTML = `
      <div class="mp-layout">
        <div class="mp-left">
          ${state.invites.length ? `<section class="panel highlight"><h3>Invitations</h3>${state.invites.map(i => `<div class="bench-row"><div class="grow"><b>${esc(i.leader)}</b> invited you <span class="muted small">(${i.members} member${i.members > 1 ? 's' : ''})</span></div>
            <button class="btn tiny primary" data-accept="${i.groupId}">Accept</button><button class="btn tiny ghost" data-decline="${i.groupId}">Decline</button></div>`).join('')}</section>` : ''}

          <section class="panel">
            <div class="panel-head"><h3>Your group</h3>${g ? `<button class="btn small ghost danger" data-leave>Leave group</button>` : `<button class="btn small primary" data-create>Create group</button>`}</div>
            ${g ? groupHtml(g, me, isLeader) : `<p class="muted">Create a group and invite other players to take on dungeons, elite hunts and world bosses together. Up to ${CONFIG.coop.partySize} characters fight: every player's hero plus ${MAX_PICKS === 1 ? 'one recruit' : `${MAX_PICKS} recruits`} each while places are left. Going alone is possible, but the encounters are made for groups.</p>`}
          </section>

          <section class="panel">
            <div class="panel-head"><h3>Your co-op recruit</h3><span class="muted small">Hero + ${MAX_PICKS}</span></div>
            <p class="muted small">Pick ${MAX_PICKS === 1 ? 'the recruit' : 'the recruits'} you take along. Only ${CONFIG.coop.partySize} characters fight: with 4 players only the heroes; with 3 players one recruit comes — first one that fills a missing role (${(CONFIG.coop.fillRoles || []).map(ROLE_LABEL).join(', then ')}), otherwise in turn.</p>
            <div class="coop-team">${chars().map(c => {
              const picks = p.coopChars.length ? p.coopChars : p.parties[p.activeParty].members.filter(id => id !== p.heroId).slice(0, MAX_PICKS);
              const busy = busyWith(p, c.id);
              const on = !busy && (c.isMain || picks.includes(c.id));
              const nr = picks.indexOf(c.id) + 1;
              return `<button class="coop-pick ${on ? 'on' : ''}" ${c.isMain || busy ? 'disabled' : `data-coop-toggle="${c.id}"`} ${busy ? `title="${busy.type === 'work' ? 'Working in town' : 'On an expedition'}"` : ''}>${portrait(c, 'sm')}<span><b>${esc(c.name)}</b><small>Lv ${c.level} ${esc(classLabel(c.classId, c.subclass))} · ${esc(ROLE_LABEL(CLASSES[c.classId]?.role))}</small></span>${on ? `<span class="check">${c.isMain ? '★' : MAX_PICKS > 1 ? nr : '✓'}</span>` : ''}</button>`;
            }).join('')}</div>
          </section>

          <section class="panel">
            <h3>Co-op encounters</h3>
            <div class="encounter-list">${Object.values(COOP_ENCOUNTERS).map(enc => {
              const boss = ENEMIES[enc.waves[enc.waves.length - 1][0]];
              const can = !g || isLeader;
              return `<div class="encounter" style="${backgroundStyle(`encounters/${enc.id}`)}">
                <div class="grow"><span class="tag ${enc.type}">${enc.type.replace('_', ' ').toUpperCase()}</span>
                  <h4>${esc(enc.name)}</h4><p class="small muted">${esc(enc.description)}</p>
                  <div class="small faint">Min. level ${enc.minLevel} · ${enc.waves.length} wave${enc.waves.length > 1 ? 's' : ''} · Final foe: ${esc(boss.name)} · Rewards ×${enc.rewardMult}</div></div>
                <button class="btn ${can ? 'primary' : ''}" data-start="${enc.id}" ${can && !g?.inBattle ? '' : 'disabled'} ${tipAttr(g ? (isLeader ? 'Start with your group' : 'Only the leader can start') : 'Start alone (creates a group of one)')}>${g?.inBattle ? 'In progress' : g ? 'Start' : 'Go alone'}</button>
              </div>`;
            }).join('')}</div>
            <p class="muted small">Enemies gain +${Math.round(CONFIG.coop.hpScalePerExtraCharacter * 100)}% health and +${Math.round(CONFIG.coop.damageScalePerExtraCharacter * 100)}% damage for every character beyond 2 in the fight. Every participant receives their own loot.</p>
          </section>
        </div>

        <div class="mp-right">
          ${g ? `<section class="panel chat">
            <h3>Group chat</h3>
            <div class="chat-lines">${g.chat.map(c => `<div class="chat-line ${c.from ? '' : 'system'}">${c.from ? `<b>${nameHtml(c.from, { title: false })}:</b> ` : ''}${esc(c.text)}</div>`).join('') || '<div class="muted small">No messages.</div>'}</div>
            <form id="chat-form" class="row gap"><input maxlength="200" placeholder="Say something…" autocomplete="off"><button class="btn small" type="submit">Send</button></form>
          </section>` : ''}
          <section class="panel">
            <h3>Players online <span class="muted small">${state.online.length}</span></h3>
            <div class="online-list">${state.online.filter(o => o.id !== me).map(o => `<div class="bench-row">
              ${o.hero ? classIcon(o.hero.classId, 'xs') : ''}<div class="grow"><b>${nameHtml(o.name)}</b>${botTag(o)}<div class="muted small">${o.hero ? `${heroNameHtml(o.hero.name, o.name)} · Lv ${o.hero.level} ${esc(CLASSES[o.hero.classId].name)}` : 'Creating hero…'}</div></div>
              ${o.hero ? `<button class="btn tiny ghost" data-inspect="${esc(o.name)}">Inspect</button>` : ''}
              ${isLeader && !o.inGroup && o.hero ? `<button class="btn tiny" data-invite="${esc(o.name)}">Invite</button>` : o.inGroup ? '<span class="muted small">in group</span>' : ''}
            </div>`).join('') || '<p class="muted small">Nobody else is online right now.</p>'}</div>
            ${isLeader ? `<div class="row gap"><input id="invite-name" placeholder="Invite by username" maxlength="16"><button class="btn small" data-invite-name>Invite</button></div>` : ''}
          </section>
        </div>
      </div>`;
    const lines = root.querySelector('.chat-lines');
    if (lines) lines.scrollTop = lines.scrollHeight;
    if (chatFocused) root.querySelector('#chat-form input')?.focus();
  },
};

// leader only: a member's offered recruit can be switched between fighting and sitting out
function recruitButton(g, m, isLeader) {
  if (!isLeader || g.members.length < 2) return '';
  const fights = m.characters.find(c => !c.isMain);
  const offered = fights || m.bench?.[0];
  if (!offered) return '';
  const used = g.members.filter(x => x.characters.some(c => !c.isMain)).length;
  if (fights) return `<button class="btn tiny" data-recruit-toggle="${m.id}" ${tipAttr(`${esc(offered.name)} fights in the next fight. Click to leave them out.`)}>✓ Fights</button>`;
  const full = used >= g.freeSlots;
  return `<button class="btn tiny ghost" data-recruit-toggle="${m.id}" ${full ? 'disabled' : ''} ${tipAttr(full ? 'No recruit place left: leave another recruit out first' : `Let ${esc(offered.name)} fight in the next fight`)}>Let fight</button>`;
}

function groupHtml(g, me, isLeader) {
  return `<div class="group-members">${g.members.map(m => `<div class="group-member">
      <div class="row gap"><b>${m.id === g.leaderId ? '👑 ' : ''}${nameHtml(m.name)}</b>${botTag(m)}<span class="conn-dot ${m.online ? 'on' : ''}" title="${m.online ? 'Online' : 'Offline'}"></span>
        <span class="grow"></span>${m.id !== me ? `<button class="btn tiny ghost" data-inspect="${esc(m.name)}">Inspect</button>` : ''}${isLeader && m.id !== me ? `<button class="btn tiny ghost" data-promote="${m.id}">Make leader</button><button class="btn tiny ghost danger" data-kick="${m.id}">Remove</button>` : ''}</div>
      <div class="member-chars">${m.characters.map(c => `<span class="member-char">${c.isMain ? framed(portrait(c, 'xs'), m.name) : portrait(c, 'xs')}<span>${c.isMain ? '★ ' + heroNameHtml(c.name, m.name) : esc(c.name)} <small class="muted">Lv ${c.level}</small> ${classBadge(c.classId)}${c.reason?.startsWith('role:') ? ` <span class="tag small" title="Brought along because the group has no ${esc(ROLE_LABEL(c.reason.slice(5)))}">fills ${esc(ROLE_LABEL(c.reason.slice(5)))}</span>` : c.reason === 'turn' && g.members.length > 2 ? ' <span class="tag small" title="This player\'s turn for the recruit place">their turn</span>' : c.reason === 'leader' && g.members.length > 1 ? ' <span class="tag small" title="Picked by the group leader">leader\'s pick</span>' : ''}</span></span>`).join('')}
        ${m.bench?.length && g.members.length > 1 ? `<span class="member-char benched" title="${g.leaderRecruits ? 'The leader left this recruit out' : 'No free place in the next fight'}">${m.bench.map(c => esc(c.name)).join(', ')} <small class="muted">sit${m.bench.length > 1 ? '' : 's'} out</small></span>` : ''}
        ${recruitButton(g, m, isLeader)}</div>
    </div>`).join('')}
    ${isLeader && g.members.length > 1 ? `<div class="row gap small"><span class="muted">Recruits: ${g.leaderRecruits ? '<b>chosen by you</b>' : 'automatic (missing roles first, then in turn)'} · ${g.freeSlots} place${g.freeSlots === 1 ? '' : 's'}</span>${g.leaderRecruits ? `<button class="btn tiny ghost" data-recruit-auto ${tipAttr('Let the game choose again: missing roles first, then in turn')}>Automatic</button>` : ''}</div>`
      : g.leaderRecruits && g.members.length > 1 ? '<div class="muted small">The leader chose which recruits fight.</div>' : ''}
    ${g.invites.length ? `<div class="muted small">Pending: ${g.invites.map(esc).join(', ')}</div>` : ''}
    <div class="muted small">Next fight: ${g.members.reduce((n, m) => n + m.characters.length, 0)} / ${CONFIG.coop.partySize} characters.${g.members.length < CONFIG.coop.maxPlayers ? '' : ' Group is full.'}</div>
    ${g.inBattle ? '<div class="notice good">Your group is fighting! <a href="#/combat">Watch the battle →</a></div>' : ''}
  </div>`;
}
