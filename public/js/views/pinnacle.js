// Pinnacle bosses: endgame fights whose mechanics ask for a specific party — Sigils, rewards and the fastest kills.
import { morphed } from '../morph.js';
import { state, hero } from '../state.js';
import { act } from '../net.js';
import { esc, run, toast, tipAttr, nameHtml, confirmBox } from '../ui.js';
import { enemyArt, classIcon } from '../assets.js';
import { PINNACLE, pinnacleList, weekKey } from '/shared/pinnacle.js';
import { UNIQUES } from '/shared/data/legendaries.js';
import { COSMETICS } from '/shared/data/cosmetics.js';
import { classLabel } from '/shared/data/subclasses.js';

let view = null, viewAt = 0;
async function load(root) {
  if (Date.now() - viewAt < 15000 && view) return;
  viewAt = Date.now();
  try { view = await act('pinnacle_view'); } catch { /* ignore */ }
  if (root.isConnected) pinnacleView.render(root);
}

const secs = t => (t >= 60 ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}.${Math.round((t % 1) * 10)}` : `${t.toFixed(1)} s`);
// who decides: alone, as the group leader, or as a member (the leader challenges)
const role = () => (state.group?.together ? (state.group.leaderId === state.player.id ? 'leader' : 'member') : 'solo');

function bossCard(def, me) {
  const h = hero();
  const sig = me.sigils || 0;
  const r = role();
  const lvlOk = (h?.level || 0) >= PINNACLE.minLevel;
  const can = lvlOk && sig > 0 && r !== 'member';
  const why = !lvlOk ? `Your hero needs level ${PINNACLE.minLevel}` : sig < 1 ? 'You need a Pinnacle Sigil' : r === 'member' ? 'Only the group leader can challenge' : r === 'leader' ? 'Use a sigil: your whole group fights' : 'Use a sigil: your active party fights';
  const title = COSMETICS.title?.[def.title], frame = COSMETICS.frame?.[def.frame];
  const killed = !!me.firstKill?.[def.id];
  const weeklyDone = me.weekly?.[def.id] === weekKey();
  const board = view?.bosses?.find(b => b.id === def.id)?.board || [];
  const enemies = [...new Set(def.waves.flat())];
  return `<section class="panel pin-card ${killed ? 'killed' : ''}">
    <div class="pin-head">
      <div class="pin-art">${enemies.slice(0, 3).map(e => enemyArt(e, 'md')).join('')}</div>
      <div class="grow">
        <h3>${esc(def.name)} ${killed ? '<span class="tag good">Defeated</span>' : ''}</h3>
        <p>${esc(def.summary)}</p>
        <p class="pin-counter">🛡 <b>Your party needs:</b> ${esc(def.counter)}</p>
      </div>
      <div class="pin-go">
        <button class="btn ${can ? 'primary' : ''}" data-challenge="${def.id}" ${can ? '' : 'disabled'} ${tipAttr(why)}>⚔ Challenge</button>
        <span class="muted small">1 ✨ Sigil</span>
      </div>
    </div>
    <div class="pin-body">
      <div>
        <h4>Rewards</h4>
        <ul class="pin-rewards">
          ${(def.uniques || []).map(id => UNIQUES[id]).filter(Boolean).map(u => `<li ${tipAttr(`<b class="rarity-text rarity-legendary">${esc(u.name)}</b><br>${esc(u.description || '')}<br><i class="faint">${esc(u.flavor || '')}</i>`)}><span class="rarity-text rarity-legendary">${esc(u.name)}</span> <span class="faint small">pinnacle unique · ${Math.round((def.uniqueChance ?? 0.3) * 100)}%</span></li>`).join('')}
          <li>First kill: title <b>${esc(title?.name || def.title)}</b> and portrait frame <b>${esc(frame?.name || def.frame)}</b> ${killed ? '✓' : ''}</li>
          <li>Weekly first kill: ${PINNACLE.weekly?.crystals ? `+${PINNACLE.weekly.crystals} 💠 and ` : ''}a guaranteed pinnacle unique ${weeklyDone ? '<span class="muted small">(claimed this week)</span>' : '<span class="tag">available</span>'}</li>
          <li class="faint small">Plus boss loot ×${PINNACLE.rewardMult ?? 3}</li>
        </ul>
        <div class="small muted">Your kills: <b>${me.kills?.[def.id] || 0}</b>${me.best?.[def.id] ? ` · best time <b>${secs(me.best[def.id])}</b>` : ''}</div>
      </div>
      <div>
        <h4>Fastest kills</h4>
        ${board.length ? `<table class="rank-table compact"><tbody>${board.map((e, i) => `<tr class="${e.players.includes(state.player.name) ? 'me' : ''}">
          <td class="rank-no">${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</td>
          <td>${e.players.map(n => `<b>${nameHtml(n, { title: false })}</b>`).join(', ')}<div class="pin-chars">${e.chars.map(c => `<span ${tipAttr(`${esc(c.name)} · ${esc(classLabel(c.classId, c.subclass))}${c.owner ? ` (${esc(c.owner)})` : ''}`)}>${classIcon(c.classId, 'xs')}</span>`).join('')}</div></td>
          <td class="num"><b>${secs(e.time)}</b></td></tr>`).join('')}</tbody></table>` : '<p class="muted small">Nobody has defeated it yet — be the first!</p>'}
      </div>
    </div>
  </section>`;
}

export const pinnacleView = {
  id: 'pinnacle', label: 'Pinnacle', icon: '🏔',
  mount(root) {
    view = null; viewAt = 0;
    load(root);
    root.addEventListener('click', async e => {
      const b = e.target.closest('[data-challenge]');
      if (!b) return;
      const def = pinnacleList().find(d => d.id === b.dataset.challenge);
      const r = role();
      if (!await confirmBox(`Use 1 Pinnacle Sigil to challenge ${def.name}${r === 'leader' ? ' with your group' : ' with your active party'}?\n\n${def.counter}\n\nThe sigil is used up when the fight starts, win or lose (leaving the fight early loses it too).`, 'Challenge')) return;
      const res = await run(act('pinnacle_start', { bossId: def.id }));
      if (res !== undefined) { toast(`The fight against ${def.name} begins!`, 'success'); viewAt = 0; location.hash = '#/combat'; }
    });
  },
  render(root) {
    const me = state.player.pinnacle || view?.me || { sigils: 0 };
    const h = hero();
    const r = role();
    morphed(root).innerHTML = `
      <section class="panel pin-intro">
        <div class="row between wrap gap">
          <div class="grow">
            <h2>🏔 Pinnacle bosses</h2>
            <p class="muted">The hardest fights in Ashenvale, made for level ${PINNACLE.minLevel} heroes (ascended ones especially). Every boss has a mechanic that a party without the right answer cannot survive — read what your party needs and bring it. Each boss enrages after five minutes.</p>
            <p class="small">${r === 'leader' ? '🤝 <b>Your group fights together</b> — every member\'s line-up joins. You decide which boss.' : r === 'member' ? '🤝 You are in a group: the <b>leader</b> challenges, and you fight along.' : `You fight with your <b>active party</b>.${h && h.level < PINNACLE.minLevel ? ` <span class="bad">Your hero needs level ${PINNACLE.minLevel}.</span>` : ''}`}</p>
          </div>
          <div class="pin-sigils" ${tipAttr(`Pinnacle Sigils are a very rare drop from enemies of level ${PINNACLE.sigilDrops?.minLevel ?? 55} or higher — most likely from bosses and elites. They never drop in rifts. Each challenge uses one.`)}>
            <span class="pin-sigil-icon">✨</span><div><b>${me.sigils || 0}</b><div class="muted small">Pinnacle Sigil${me.sigils === 1 ? '' : 's'}</div></div>
          </div>
        </div>
      </section>
      ${pinnacleList().map(d => bossCard(d, me)).join('')}`;
    load(root);
  },
};
