// Expeditions: send recruits out to gather materials.
import { state } from '../state.js';
import { act } from '../net.js';
import { esc, fmt, run, toast, tipAttr, duration, bar, confirmBox } from '../ui.js';
import { portrait, materialIcon, professionIcon, backgroundStyle, assetUrl } from '../assets.js';
import { CLASSES } from '/shared/data/classes.js';
import { MATERIALS, PROFESSIONS, BUILDINGS } from '/shared/data/town.js';
import { EXPEDITIONS, EXPEDITION_DURATIONS, CAMP_SLOTS } from '/shared/data/expeditions.js';
import { campSlots, campMembers, busyWith, expectedYield, expeditionXp } from '/shared/expeditions.js';
import { bLevel } from '/shared/town.js';

const ui = { dest: 'copper_hills', hours: 1, team: [] };
let timer = null;
const now = () => Date.now() + (state.timeOffset || 0);

function destArt(id, cls = '') {
  const url = assetUrl(`expeditions/${id}`);
  return url ? `<span class="art ${cls}"><img src="${esc(url)}" alt=""></span>` : `<span class="art ph ${cls}" style="--ph:#4a5a3a"><span class="ph-glyph">🧭</span></span>`;
}

function yieldList(yields, rare) {
  const main = Object.entries(yields).map(([m, v]) => `<span class="cost" ${tipAttr(esc(MATERIALS[m].name))}>${materialIcon(m, 'xxs')} ~${fmt(v)}</span>`).join('');
  const r = Object.entries(rare || {}).map(([m, v]) => `<span class="cost rare" ${tipAttr(`${esc(MATERIALS[m].name)}: lucky find (expected ${v.toFixed(2)})`)}>${materialIcon(m, 'xxs')} ${v >= 1 ? '~' + fmt(v) : Math.round(Math.min(1, v) * 100) + '%'}</span>`).join('');
  return `<span class="costs">${main}${r}</span>`;
}

function statusLabel(p, ch) {
  const b = busyWith(p, ch.id);
  if (!b) return '';
  if (b.type === 'work') return `Working: ${BUILDINGS[b.buildingId]?.name}`;
  return `Away: ${EXPEDITIONS[b.destId]?.name}`;
}

function activeHtml(p) {
  const list = p.expeditions || [];
  const t = now();
  if (!list.length) return '<p class="muted small">No expeditions underway.</p>';
  return `<div class="exp-active">${list.map(ex => {
    const d = EXPEDITIONS[ex.destId];
    const done = ex.endsAt <= t;
    return `<div class="exp-run ${done ? 'done' : ''}">
      ${destArt(ex.destId, 'sm')}
      <div class="grow"><b>${esc(d.name)}</b> <span class="muted small">${EXPEDITION_DURATIONS.find(x => x.hours === ex.hours)?.label || ex.hours + 'h'}</span>
        <div class="row gap small">${ex.charIds.map(id => p.characters[id]).filter(Boolean).map(c => `${portrait(c, 'xxs')} ${esc(c.name)}`).join(' · ')}</div>
        ${done ? '<div class="up small">Returned — rewards ready!</div>' : `<div data-exp-progress="${ex.startedAt}:${ex.endsAt}">${bar(0, 1, 'build thin', '')}<small class="muted">back in <span data-ends="${ex.endsAt}">${duration((ex.endsAt - t) / 1000)}</span></small></div>`}
      </div>
      ${done ? `<button class="btn primary small" data-claim="${ex.id}">Claim</button>` : `<button class="btn tiny ghost" data-cancel="${ex.id}" title="Recall the recruits early (no rewards)">Recall</button>`}
    </div>`;
  }).join('')}</div>`;
}

function plannerHtml(p) {
  const d = EXPEDITIONS[ui.dest];
  const camp = bLevel(p, 'expedition_camp');
  const maxMembers = campMembers(p);
  const recruits = Object.values(p.characters).filter(c => !c.isMain).sort((a, b) => (busyWith(p, a.id) ? 1 : 0) - (busyWith(p, b.id) ? 1 : 0) || (b.profession?.id === d.bonus) - (a.profession?.id === d.bonus) || b.level - a.level);
  ui.team = ui.team.filter(id => p.characters[id] && !busyWith(p, id)).slice(0, maxMembers);
  const team = ui.team.map(id => p.characters[id]);
  const est = expectedYield(d, team, ui.hours);
  const locked = d.campLevel > camp;
  const slotsFull = (p.expeditions || []).length >= campSlots(p);
  const inParty = team.filter(c => p.parties.some(pt => pt.members.includes(c.id)));
  return `<div class="panel exp-planner" style="${backgroundStyle(`expeditions/${d.id}`)}">
    <div class="row gap">${destArt(d.id, 'lg')}<div class="grow"><h2>${esc(d.name)}</h2>
      <p class="muted small">${esc(d.description)}</p>
      <div class="small">Recommended level <b>${d.level}</b>${d.bonus ? ` · Bonus for ${professionIcon(d.bonus, 'xxs')} <b>${esc(PROFESSIONS[d.bonus].name)}</b>` : ' · Any profession'}</div></div></div>
    ${locked ? `<div class="notice">Requires Expedition Camp level ${d.campLevel}. <a href="#/town">Upgrade it in the Town →</a></div>` : ''}
    <h4>Duration</h4>
    <div class="row gap wrap">${EXPEDITION_DURATIONS.map(x => `<button class="btn small ${x.hours === ui.hours ? 'primary' : ''}" data-hours="${x.hours}">${x.label}</button>`).join('')}</div>
    <h4>Team <span class="muted small">${team.length}/${maxMembers}</span></h4>
    <div class="exp-team">${recruits.map(c => {
      const busy = statusLabel(p, c);
      const on = ui.team.includes(c.id);
      const match = d.bonus && c.profession?.id === d.bonus;
      return `<button class="exp-pick ${on ? 'on' : ''} ${match ? 'match' : ''}" data-pick="${c.id}" ${busy ? 'disabled' : ''}>
        ${portrait(c, 'sm')}<span><b>${esc(c.name)}</b><small>Lv ${c.level} ${esc(CLASSES[c.classId].name)}</small>
        <small>${c.profession ? `${professionIcon(c.profession.id, 'xxs')} ${esc(PROFESSIONS[c.profession.id].name)} ${c.profession.level}` : ''}</small>
        ${busy ? `<small class="warn-text">${esc(busy)}</small>` : ''}</span>${on ? '<span class="check">✓</span>' : ''}</button>`;
    }).join('') || '<p class="muted small">You have no companions yet. <a href="#/recruitment">Recruit some first.</a></p>'}</div>
    ${team.length ? `<div class="exp-estimate">
      <div class="small"><b>Expected haul</b> ${yieldList(est.yields, est.rare)}</div>
      <div class="small muted">Team strength ${Math.round(est.factors.power * 100)}% (avg. level ${Math.round(est.factors.avgLevel)} vs ${d.level})${est.factors.prof > 1 ? ` · profession bonus +${Math.round((est.factors.prof - 1) * 100)}%` : ''} · each recruit gains ${fmt(expeditionXp(d, ui.hours))} XP</div>
      ${inParty.length ? `<div class="small warn-text">${inParty.map(c => esc(c.name)).join(', ')} will leave your party while away.</div>` : ''}
    </div>` : '<p class="muted small">Pick recruits for the team. Recruits with the bonus profession bring back much more.</p>'}
    <div class="row end gap"><span class="muted small">Returns in ${EXPEDITION_DURATIONS.find(x => x.hours === ui.hours).label}</span>
      <button class="btn primary" data-send ${locked || slotsFull || !team.length ? 'disabled' : ''}>${slotsFull ? 'All expedition slots busy' : 'Send expedition'}</button></div>
  </div>`;
}

export const expeditionsView = {
  id: 'expeditions', label: 'Expeditions', icon: '🧭',
  mount(root) {
    root.addEventListener('click', async e => {
      const t = e.target.closest('button');
      if (!t) return;
      const d = t.dataset;
      const p = state.player;
      if (d.dest) { ui.dest = d.dest; this.render(root); return; }
      if (d.hours) { ui.hours = Number(d.hours); this.render(root); return; }
      if (d.pick) {
        if (ui.team.includes(d.pick)) ui.team = ui.team.filter(x => x !== d.pick);
        else if (ui.team.length < campMembers(p)) ui.team.push(d.pick);
        else toast(`Up to ${campMembers(p)} recruit(s) per expedition — upgrade the Expedition Camp for bigger teams.`, 'error');
        this.render(root); return;
      }
      if ('send' in d) {
        const r = await run(act('expedition_start', { destId: ui.dest, charIds: ui.team, hours: ui.hours }));
        if (r) { toast(`Expedition to ${EXPEDITIONS[ui.dest].name} has set out!`, 'success'); ui.team = []; }
        return;
      }
      if (d.claim || 'claimAll' in d) {
        const r = await run(act('expedition_claim', d.claim ? { id: d.claim } : {}));
        if (r) toast(`Brought back: ${Object.entries(r.got).map(([k, v]) => `${v} ${MATERIALS[k].name}`).join(', ') || 'nothing'}`, 'success');
        return;
      }
      if (d.cancel && await confirmBox('Recall this expedition early? The recruits return immediately but bring nothing back.', 'Recall')) await run(act('expedition_cancel', { id: d.cancel }));
    });
    timer = setInterval(() => {
      root.querySelectorAll('[data-ends]').forEach(el => { el.textContent = duration(Math.max(0, (Number(el.dataset.ends) - now()) / 1000)); });
      let finished = false;
      root.querySelectorAll('[data-exp-progress]').forEach(el => {
        const [s, en] = el.dataset.expProgress.split(':').map(Number);
        const f = el.querySelector('.fill');
        if (f) f.style.width = `${Math.min(100, ((now() - s) / (en - s)) * 100)}%`;
        if (now() >= en) finished = true;
      });
      if (finished) this.render(root);
    }, 1000);
  },
  unmount() { clearInterval(timer); },
  render(root) {
    const p = state.player;
    if (!p?.town) return;
    const camp = bLevel(p, 'expedition_camp');
    const ready = (p.expeditions || []).filter(x => x.endsAt <= now()).length;
    root.innerHTML = `
      <section class="panel">
        <div class="panel-head"><h3>Expeditions <span class="muted small">${(p.expeditions || []).length}/${campSlots(p)} underway</span></h3>
          <div class="row gap">${ready > 1 ? `<button class="btn small primary" data-claim-all>Claim all (${ready})</button>` : ''}<a class="small" href="#/town">Expedition Camp: level ${camp}${camp < 5 ? ` → ${CAMP_SLOTS[camp + 1]} slots at level ${camp + 1}` : ''}</a></div></div>
        <p class="muted small">Recruits on an expedition can't fight or work in town until they return. Rewards are calculated by the server when you claim them.</p>
        ${activeHtml(p)}
      </section>
      <div class="exp-layout">
        <section class="panel">
          <h3>Destinations</h3>
          <div class="exp-dests">${Object.values(EXPEDITIONS).map(d => {
            const locked = d.campLevel > camp;
            const est = expectedYield(d, [{ level: d.level }], 1);
            return `<button class="exp-dest ${ui.dest === d.id ? 'active' : ''} ${locked ? 'locked' : ''}" data-dest="${d.id}">
              ${destArt(d.id, 'md')}
              <span class="grow"><b>${esc(d.name)}</b>
                <small>Lv ${d.level}${d.bonus ? ` · ${esc(PROFESSIONS[d.bonus].name)}` : ''}${locked ? ` · 🔒 Camp ${d.campLevel}` : ''}</small>
                <small>${Object.keys(est.yields).map(m => materialIcon(m, 'xxs')).join(' ')}${Object.keys(est.rare).length ? ' + ' + Object.keys(est.rare).map(m => materialIcon(m, 'xxs')).join(' ') : ''}</small></span>
            </button>`;
          }).join('')}</div>
        </section>
        ${plannerHtml(p)}
      </div>`;
  },
};
