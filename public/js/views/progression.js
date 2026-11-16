// Progression: levels, class titles, zones, achievements, statistics and settings.
import { state, chars } from '../state.js';
import { act } from '../net.js';
import { esc, fmt, bar, run, tipAttr } from '../ui.js';
import { portrait, achievementIcon, loadAssets, enemyArt } from '../assets.js';
import { CONFIG, xpToNext } from '/shared/config.js';
import { CLASSES } from '/shared/data/classes.js';
import { ZONES } from '/shared/data/zones.js';
import { ENEMIES } from '/shared/data/enemies.js';
import { ACHIEVEMENTS } from '/shared/data/achievements.js';

export const progressionView = {
  id: 'progression', label: 'Progression', icon: '★',
  mount(root) {
    root.addEventListener('change', async e => {
      const t = e.target;
      if (t.matches('[data-setting]')) await run(act('set_settings', { [t.dataset.setting]: t.checked }), 'Settings saved.');
    });
    root.addEventListener('click', async e => {
      const t = e.target.closest('button');
      if (!t) return;
      if ('reloadArt' in t.dataset) { await loadAssets(); this.render(root); import('../ui.js').then(u => u.toast('Artwork reloaded.', 'success')); }
      if ('logout' in t.dataset) (await import('../main.js')).logout();
    });
  },
  render(root) {
    const p = state.player;
    const zones = Object.values(ZONES).sort((a, b) => a.order - b.order);
    root.innerHTML = `
      <div class="prog-layout">
        <section class="panel">
          <h3>Characters & class progression</h3>
          <div class="prog-chars">${chars().map(c => {
            const tiers = CLASSES[c.classId].tiers.filter(t => !t.mainOnly || c.isMain);
            return `<div class="prog-char">${portrait(c, 'sm')}
              <div class="grow"><b>${c.isMain ? '★ ' : ''}${esc(c.name)}</b> <span class="muted small">Lv ${c.level} ${esc(CLASSES[c.classId].name)}</span>
                ${c.level < CONFIG.levelCap ? bar(c.xp, xpToNext(c.level), 'xp thin', '') : ''}
                <div class="tier-track">${tiers.map(t => `<span class="tier ${c.level >= t.level ? 'done' : ''} ${t.mainOnly ? 'hero-only' : ''}" ${tipAttr(`<b>${esc(t.title)}</b> (Lv ${t.level})${t.bonus ? '<br>' + esc(bonusText(t.bonus)) : ''}${t.mainOnly ? '<br><i>Hero only</i>' : ''}`)}>${esc(t.title)}<small>Lv ${t.level}</small></span>`).join('')}</div>
              </div></div>`;
          }).join('')}</div>
        </section>

        <section class="panel">
          <h3>World map</h3>
          <div class="zone-list">${zones.map(z => {
            const open = p.unlockedZones.includes(z.id);
            return `<div class="zone-row ${open ? '' : 'locked'}">${enemyArt(z.boss, 'sm')}
              <div class="grow"><b>${esc(z.name)}</b> <span class="muted small">Lv ${z.levelRange[0]}–${z.levelRange[1]}</span>
              <div class="muted small">${open ? `Boss: ${esc(ENEMIES[z.boss].name)} — defeated ${p.bossKills[z.id] || 0}×` : '🔒 Defeat the previous boss to unlock'}</div></div>
              ${z.id === p.zone ? '<span class="tag live">Here</span>' : ''}</div>`;
          }).join('')}</div>
        </section>

        <section class="panel wide-panel">
          <h3>Achievements <span class="muted small">${Object.keys(p.achievements).length}/${Object.keys(ACHIEVEMENTS).length}</span></h3>
          <div class="ach-grid">${Object.values(ACHIEVEMENTS).map(a => {
            const done = !!p.achievements[a.id];
            const v = Math.min(a.goal, p.stats[a.stat] || 0);
            return `<div class="ach ${done ? 'done' : ''}">${achievementIcon(a.id, done, 'md')}
              <div class="grow"><b>${esc(a.name)}</b><div class="muted small">${esc(a.description)}</div>
              ${done ? `<div class="small gold-text">Completed · +${fmt(a.reward.gold)}g</div>` : bar(v, a.goal, 'thin', `${fmt(v)} / ${fmt(a.goal)}`)}</div></div>`;
          }).join('')}</div>
        </section>

        <section class="panel">
          <h3>Statistics</h3>
          <div class="stat-grid">
            ${[['Enemies defeated', p.stats.kills], ['Bosses defeated', p.stats.bossKills], ['Fights', p.stats.fights], ['Co-op victories', p.stats.coopWins], ['Companions recruited', p.stats.recruited], ['Epic+ items found', p.stats.epicFound], ['Legendary+ items found', p.stats.legendaryFound]]
              .map(([l, v]) => `<div class="stat-row"><span>${l}</span><b>${fmt(v)}</b></div>`).join('')}
          </div>
        </section>

        <section class="panel">
          <h3>Settings</h3>
          <label class="switch"><input type="checkbox" data-setting="autoDevelopRecruits" ${p.settings.autoDevelopRecruits ? 'checked' : ''}><span></span> Companions spend skill tree points automatically</label>
          <label class="switch"><input type="checkbox" data-setting="autoDevelopHero" ${p.settings.autoDevelopHero ? 'checked' : ''}><span></span> Hero spends skill tree points automatically</label>
          <label class="switch"><input type="checkbox" data-setting="publicProfile" ${p.settings.publicProfile !== false ? 'checked' : ''}><span></span> Let other players inspect my build (gear, skill tree, behaviour rules)</label>
          <p class="muted small">Offline progress: your active party keeps fighting in the current zone for up to ${CONFIG.offline.maxHours} hours while you're away, using the exact same combat rules (calculated by the server).</p>
          <div class="row gap"><button class="btn small" data-reload-art>Reload artwork</button><button class="btn small ghost danger" data-logout>Log out</button></div>
        </section>
      </div>`;
  },
};

function bonusText(b) {
  const names = { strPct: 'Strength', intPct: 'Intelligence', dexPct: 'Dexterity', vitPct: 'Vitality', allPct: 'all attributes & health', defensePct: 'Defense', healPowerPct: 'Healing Power', critChance: 'Critical Chance', critDamage: 'Critical Damage', attackSpeed: 'Attack Speed' };
  return Object.entries(b).map(([k, v]) => `+${Math.round(v * 100)}% ${names[k] || k}`).join(', ');
}
