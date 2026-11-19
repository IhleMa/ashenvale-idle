// Arena: pick a party setup as your arena team, attack other players' teams, rating and fight log.
// Both teams fight at the average level of the two heroes; the fight plays live on the Combat page.
import { state } from '../state.js';
import { act } from '../net.js';
import { esc, fmt, run, duration, botTag } from '../ui.js';
import { portrait } from '../assets.js';
import { classBadge } from '../components.js';
import { openInspect } from '../inspect.js';
import { CONFIG } from '/shared/config.js';
import { classLabel } from '/shared/data/subclasses.js';

let view = null; // { opponents, nextAttackAt } from the server
let loading = false;
let ticker = null;

async function load(root, refresh = false) {
  if (loading) return;
  loading = true;
  try { view = await act(refresh ? 'arena_refresh' : 'arena_view'); } catch { view = view || { opponents: [] }; }
  loading = false;
  if (root.isConnected) arenaView.render(root, true);
}

const A = () => CONFIG.arena || {};
const ago = t => { const s = Math.max(0, (Date.now() + (state.timeOffset || 0) - t) / 1000); return s < 90 ? 'just now' : `${duration(s)} ago`; };

function teamHtml(team) {
  return `<div class="arena-team">${team.map(c => `<span class="member-char">${portrait(c, 'xs')}<span>${c.isMain ? '★ ' : ''}${esc(c.name)} <small class="muted">Lv ${c.level}</small> ${classBadge(c.classId, c.subclass)}</span></span>`).join('')}</div>`;
}

export const arenaView = {
  id: 'arena', label: 'Arena', icon: '🏟',
  mount(root) {
    view = null;
    load(root);
    ticker = setInterval(() => { const el = root.querySelector('[data-next-attack]'); if (el) el.textContent = nextText(); }, 1000);
    root.addEventListener('change', async e => {
      if (e.target.matches('[data-arena-party]')) {
        const v = e.target.value;
        await run(act('arena_set_party', { party: v === '' ? null : Number(v) }), v === '' ? 'You left the arena.' : 'Arena team saved.');
        load(root);
      }
    });
    root.addEventListener('click', async e => {
      const atk = e.target.closest('[data-attack]');
      if (atk) {
        atk.disabled = true;
        if (await run(act('arena_attack', { opponentId: atk.dataset.attack })) !== undefined) location.hash = '#/combat';
        else atk.disabled = false;
        return;
      }
      if (e.target.closest('[data-arena-refresh]')) { load(root, true); return; }
      const ins = e.target.closest('[data-inspect]');
      if (ins) openInspect(ins.dataset.inspect);
    });
  },
  unmount() { clearInterval(ticker); ticker = null; },
  render(root, fresh = false) {
    const p = state.player;
    const a = p.arena;
    if (!a) { root.innerHTML = '<p class="muted">Loading…</p>'; return; }
    // the rest of the page only changes when the server data or the arena state changes
    const sig = JSON.stringify([a.party, a.rating, a.attacks, a.log?.[0]?.at, p.parties.map(x => x.members.join()), fresh ? Math.random() : 0]);
    if (!fresh && root.dataset.sig === sig) return;
    root.dataset.sig = sig;
    const party = a.party != null ? p.parties[a.party] : null;
    const teamChars = party ? party.members.map(id => p.characters[id]).filter(Boolean) : [];
    root.innerHTML = `
      <div class="arena-layout">
        <div class="arena-main">
          <section class="panel arena-head">
            <div class="arena-rating"><span class="muted small">Arena rating</span><b>${fmt(a.rating)}</b><span class="small muted">best ${fmt(a.best || a.rating)}</span></div>
            <div class="arena-stats small">
              <div>Attacks: <b>${a.wins}</b> won · <b>${a.losses}</b> lost</div>
              <div>Defenses: <b>${a.defWins}</b> won · <b>${a.defLosses}</b> lost</div>
              <div>Attacks left: <b>${a.attacks} / ${A().attacksMax}</b> <span class="muted" data-next-attack>${nextText()}</span></div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head"><h3>Your arena team</h3>
              <select data-arena-party><option value="" ${a.party == null ? 'selected' : ''}>— not in the arena —</option>${p.parties.map((x, i) => `<option value="${i}" ${a.party === i ? 'selected' : ''} ${x.members.length ? '' : 'disabled'}>${esc(x.name)} (${x.members.length})</option>`).join('')}</select></div>
            ${party ? teamHtml(teamChars.sort((x, y) => (y.isMain ? 1 : 0) - (x.isMain ? 1 : 0)).map(c => ({ ...c, subclass: c.subclass }))) : '<p class="muted small">Pick one of your party setups. It attacks for you and defends against other players, even while you are offline. Change the party itself on the Party page.</p>'}
            <p class="muted small">Both teams fight at the <b>average level of the two heroes</b>: higher characters are scaled down, lower ones up (their missing skill points are spent automatically for the fight). Between players damage is ${Math.round((A().damageMult ?? 1) * 100)}% and healing ${Math.round((A().healingMult ?? 1) * 100)}%, stuns last ${Math.round((A().controlMult ?? 1) * 100)}% as long, and after ${A().timeLimit} s the team with more health left wins. Your ability rules decide everything, so tune them on the Abilities page.</p>
          </section>

          <section class="panel">
            <div class="panel-head"><h3>Opponents</h3><button class="btn small ghost" data-arena-refresh ${loading ? 'disabled' : ''}>↻ New opponents</button></div>
            ${a.party == null ? '<p class="muted">Choose your arena team first.</p>' : !view ? '<p class="muted">Looking for opponents…</p>' : view.opponents.length ? `<div class="arena-opponents">${view.opponents.map(o => `
              <div class="arena-opponent">
                <div class="row gap">${o.hero ? portrait(o.hero, 'sm') : ''}<div class="grow"><b>${esc(o.name)}</b>${botTag(o)} <span class="muted small">${o.hero ? `${esc(o.hero.name)} · Lv ${o.hero.level} ${esc(classLabel(o.hero.classId, o.hero.subclass))}` : ''}</span>
                  <div class="small">Rating <b>${fmt(o.rating)}</b> · ${o.wins}–${o.losses} · power ${fmt(o.power)} · fight at <b>level ${o.fightLevel}</b></div></div>
                  <button class="btn tiny ghost" data-inspect="${esc(o.name)}">Inspect</button>
                  <button class="btn primary" data-attack="${o.id}" ${a.attacks > 0 ? '' : 'disabled'}>Attack</button></div>
                ${teamHtml(o.team)}
              </div>`).join('')}</div>` : '<p class="muted">No opponents right now. Players show up here once they pick an arena team (players you attacked in the last ' + (A().sameOpponentMinutes ?? 60) + ' minutes are left out).</p>'}
            <p class="muted small">A win gives ${A().winGoldPerLevel} gold per fight level. Rating: win or lose against someone with a similar rating moves about ${Math.round((A().kFactor ?? 32) / 2)} points; beating a stronger player gives more. Defending works the same way.</p>
          </section>
        </div>

        <section class="panel arena-log">
          <h3>Fight log</h3>
          ${(a.log || []).length ? a.log.map(l => `<div class="arena-log-row ${l.won ? 'won' : 'lost'}">
            <span class="arena-log-icon">${l.type === 'attack' ? '⚔' : '🛡'}</span>
            <div class="grow"><b>${l.type === 'attack' ? `You attacked ${esc(l.opponent)}` : `${esc(l.opponent)} attacked you`}</b> — ${l.won ? 'won' : 'lost'}${l.byTime ? ' on time' : ''}
              <div class="muted small">level ${l.level} · ${l.time} s · ${ago(l.at)}</div></div>
            <span class="arena-delta ${l.delta >= 0 ? 'up' : 'down'}">${l.delta >= 0 ? '+' : ''}${l.delta}</span></div>`).join('') : '<p class="muted small">No arena fights yet.</p>'}
        </section>
      </div>`;
  },
};

function nextText() {
  const a = state.player?.arena;
  if (!a || a.attacks >= (A().attacksMax ?? 5) || !a.nextAttackAt) return '';
  const s = (a.nextAttackAt - Date.now() - (state.timeOffset || 0)) / 1000;
  return s > 0 ? `(next in ${duration(s)})` : '(refilling…)';
}
