// Character sheet: attributes, stats, equipment, role.
import { state, selectedChar } from '../state.js';
import { act } from '../net.js';
import { esc, fmt, pct, bar, run, modal, itemTooltipHtml, tipAttr, confirmBox } from '../ui.js';
import { portrait, itemIcon, slotIcon } from '../assets.js';
import { charPicker, bindPicker, charTitle, roleBadge, classBadge } from '../components.js';
import { CONFIG, xpToNext } from '/shared/config.js';
import { CLASSES, TRAITS } from '/shared/data/classes.js';
import { SLOTS, SLOT_IDS, canEquip } from '/shared/data/items.js';
import { computeStats, ATTRIBUTES, powerRating } from '/shared/stats.js';
import { abilitySlots } from '/shared/character.js';
import { activeSetBonuses, equippedSetCounts, SETS, UNIQUES } from '/shared/data/legendaries.js';
import { availablePoints, treeStats } from '/shared/skilltree.js';
import { PROFESSIONS, BUILDINGS, professionXpToNext } from '/shared/data/town.js';
import { SUBCLASSES, subclassesOf } from '/shared/data/subclasses.js';
import { ABILITIES } from '/shared/data/abilities.js';
import { describeNodeStats } from '/shared/data/skilltree.js';
import { describeChanges } from '/shared/mutators.js';
import { professionIcon } from '../assets.js';

export const characterView = {
  id: 'character', label: 'Character', icon: '👤',
  mount(root) {
    bindPicker(root, () => this.render(root));
    root.addEventListener('click', async e => {
      const ch = selectedChar();
      const t = e.target.closest('[data-act]');
      if (!t || !ch) return;
      const a = t.dataset.act;
      if (a === 'slot') openSlot(ch, t.dataset.slot);
      if (a === 'ascend') openAscend(ch, t.dataset.sub || null);
      if (a === 'rename') {
        const name = prompt('New name', ch.name);
        if (name) await run(act('rename_character', { charId: ch.id, name }));
      }
      if (a === 'dismiss' && await confirmBox(`Dismiss ${ch.name}? Their equipment returns to your inventory.`, 'Dismiss')) {
        await run(act('dismiss', { charId: ch.id }));
        state.selectedCharId = state.player.heroId;
      }
    });
    root.addEventListener('change', async e => {
      const ch = selectedChar();
      if (e.target.matches('[data-role]')) await run(act('set_role', { charId: ch.id, role: e.target.value }));
    });
  },
  render(root) {
    const ch = selectedChar();
    if (!ch) return;
    const cls = CLASSES[ch.classId];
    const s = computeStats(ch);
    const p = state.player;
    root.innerHTML = `
      ${charPicker(ch.id)}
      <div class="char-sheet">
        <section class="panel char-head">
          <div class="char-portrait">${portrait(ch, 'xl')}</div>
          <div class="char-ident">
            <h2>${ch.isMain ? '<span class="hero-star">★</span> ' : ''}${esc(ch.name)} <button class="icon-btn small" data-act="rename" title="Rename">✎</button></h2>
            <div class="muted">${esc(charTitle(ch))} · ${classBadge(ch.classId, ch.subclass)} ${ch.isMain ? '<span class="tag hero">HERO</span>' : ''}</div>
            <div class="lvl-line"><b>Level ${ch.level}</b>${ch.level < CONFIG.levelCap ? bar(ch.xp, xpToNext(ch.level), 'xp', `${fmt(ch.xp)} / ${fmt(xpToNext(ch.level))} XP`) : '<span class="muted"> (max level)</span>'}</div>
            <div class="row gap wrap">
              <label class="inline">Role <select data-role>${Object.entries(CONFIG.roles).map(([id, r]) => `<option value="${id}" ${ch.role === id ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select></label>
              <span class="muted small" ${tipAttr(roleTip(ch.role))}>ⓘ role bonus</span>
              ${ch.trait ? `<span class="trait" ${tipAttr(esc(TRAITS[ch.trait].description))}>Trait: ${esc(TRAITS[ch.trait].name)}</span>` : ''}
              <span class="muted small">Power ${fmt(powerRating(s))}</span>
              ${ch.profession ? (() => { const wb = Object.entries(p.town?.buildings || {}).find(([, b]) => b.worker === ch.id); return `<span class="prof-badge" ${tipAttr(`${esc(PROFESSIONS[ch.profession.id].name)} skill ${ch.profession.level} (${ch.profession.xp}/${professionXpToNext(ch.profession.level)} XP)`)}>${professionIcon(ch.profession.id, 'xxs')} ${esc(PROFESSIONS[ch.profession.id].name)} ${ch.profession.level}${wb ? ` · works at the ${esc(BUILDINGS[wb[0]].name)}` : ''}</span>`; })() : ''}
            </div>
            ${ch.isMain ? `<div class="hero-perks small muted">Hero perks: +${Math.round(CONFIG.mainCharacter.attributeBonus * 100)}% attributes · ${abilitySlots(ch)} ability slots · +1 skill point every ${CONFIG.mainCharacter.bonusSkillPointEvery} levels · +${Math.round(CONFIG.mainCharacter.xpBonus * 100)}% XP · Leadership aura at Lv ${CONFIG.mainCharacter.leadershipAura.unlockLevel}</div>` : `<div class="row end"><button class="btn small danger ghost" data-act="dismiss">Dismiss</button></div>`}
          </div>
        </section>

        <section class="panel">
          <div class="panel-head"><h3>Attributes</h3>${availablePoints(ch) ? `<a class="points" href="#/skilltree">${availablePoints(ch)} skill point${availablePoints(ch) > 1 ? 's' : ''} to spend →</a>` : '<a class="small" href="#/skilltree">Open skill tree →</a>'}</div>
          <div class="attr-list">
            ${Object.entries(ATTRIBUTES).map(([k, a]) => {
              const fromTree = treeStats(ch)[k] || 0;
              return `<div class="attr-row">
                <span class="attr-name" ${tipAttr(attrTip(ch.classId, k))}>${a.label}</span>
                <b>${s.attributes[k]}</b>
                <span class="muted small">${fromTree ? `+${fromTree} from skill tree` : ''}</span>
              </div>`;
            }).join('')}
          </div>
          <p class="small muted">Attributes grow with your level and are raised further through the passive skill tree and equipment.</p>
          <h3>Combat stats</h3>
          <div class="stat-grid">
            ${statRow('Health', fmt(s.maxHp))}
            ${statRow('Physical Power', fmt(s.physPower))}
            ${statRow('Magic Power', fmt(s.magPower))}
            ${statRow('Healing Power', fmt(s.healPower))}
            ${statRow('Defense', fmt(s.defense), 'Reduces physical damage (half effect vs. magic).')}
            ${statRow('Critical Chance', pct(s.critChance))}
            ${statRow('Critical Damage', pct(s.critDamage, 0))}
            ${statRow('Attack Speed', pct(s.attackSpeed, 0))}
            ${statRow(cls.resource.name, `${s.resourceMax} (+${cls.resource.regen}/s)`)}
          </div>
        </section>

        <section class="panel">
          <div class="panel-head"><h3>Equipment</h3><span class="muted small">Click a slot to change gear</span></div>
          <div class="equip-grid">
            ${SLOT_IDS.map(slot => {
              const it = ch.equipment[slot];
              return `<button class="equip-slot" data-act="slot" data-slot="${slot}" ${it ? tipAttr(itemTooltipHtml(it, null, ch)) : ''}>
                ${it ? itemIcon(it, 'md') : slotIcon(slot, 'md')}
                <span class="slot-text"><small>${esc(SLOTS[slot].label)}</small><b class="${it ? `rarity-text rarity-${it.rarity} ${it.unique ? 'unique-name' : ''} ${it.set ? 'set-name' : ''}` : 'muted'}">${it ? esc(it.name) : 'Empty'}</b></span>
              </button>`;
            }).join('')}
          </div>
          ${specialEffectsHtml(ch)}
          <div class="muted small">${p.inventory.filter(i => canEquip(i, ch)).length} usable item(s) in inventory.</div>
        </section>
        ${ch.isMain ? ascensionPanel(ch) : ''}
      </div>`;
  },
};

// ---------- Ascension (hero only) ----------
function subclassCard(sub, { pick = false, current = false } = {}) {
  const abil = sub.branches.flatMap(b => Object.values(b.abilities || {})).map(id => ABILITIES[id]).filter(Boolean);
  const keys = sub.branches.flatMap(b => Object.values(b.notables || {}));
  const muts = sub.branches.flatMap(b => Object.values(b.mutators || {}));
  return `<div class="subclass-card ${current ? 'current' : ''}" style="--sub-color:${esc(sub.color || '#c9a24a')}">
    <div class="subclass-head"><span class="subclass-glyph">${esc(sub.glyph || '🌟')}</span><div><b>${esc(sub.name)}</b>${current ? ' <span class="tag hero">CURRENT</span>' : ''}<div class="small muted">${esc(sub.description || '')}</div></div></div>
    <div class="small"><b>Passive:</b> ${describeNodeStats(sub.bonus).map(esc).join(' · ') || '—'}</div>
    <div class="subclass-abil">${abil.map(a => `<div class="small"><b>${esc(a.name)}</b> <span class="muted">— ${esc(a.description)}</span></div>`).join('')}</div>
    ${muts.length ? `<div class="subclass-abil">${muts.map(m => `<div class="small" ${tipAttr(esc(describeChanges(m.changes).join(', ')))}><span class="mut-tag">✦ ${esc(m.name)}</span> <span class="muted">${esc(m.description || '')}</span></div>`).join('')}</div>` : ''}
    ${keys.length ? `<div class="small muted">Notables: ${keys.map(k => `<span ${tipAttr(esc(describeNodeStats(k.stats).join(', ')))}>${esc(k.name)}</span>`).join(' · ')}</div>` : ''}
    ${pick ? `<div class="row end"><button class="btn primary small" data-pick="${esc(sub.id)}">Ascend as ${esc(sub.name)}</button></div>` : ''}
  </div>`;
}

function ascensionPanel(ch) {
  const cfg = CONFIG.ascension;
  if (!cfg?.enabled) return '';
  const subs = subclassesOf(ch.classId);
  if (!subs.length) return '';
  const atCap = ch.level >= CONFIG.levelCap;
  const cur = ch.subclass && SUBCLASSES[ch.subclass];
  const hist = (ch.ascensionHistory || []).map(h => SUBCLASSES[h.subclass]?.name || h.subclass);
  let head;
  if (cur) head = `<p><b>${esc(ch.name)}</b> has ascended as a <b style="color:${esc(cur.color || 'inherit')}">${esc(cur.glyph || '')} ${esc(cur.name)}</b>${ch.ascensions > 1 ? ` (${ch.ascensions} ascensions: ${hist.map(esc).join(' → ')})` : ''}.</p>`
    + (atCap ? `<div class="row gap"><button class="btn primary glow" data-act="ascend">🌟 Switch subclass</button><span class="small muted">Starts again at level 1 as another ${esc(CLASSES[ch.classId].name)} subclass.</span></div>`
      : `<p class="small muted">Reach level ${CONFIG.levelCap} again to switch to another subclass.${CONFIG.ascension.levelSync?.enabled ? ` Until then, your party is <b>level-synced</b> to level ${Math.min(CONFIG.levelCap, ch.level + CONFIG.ascension.levelSync.levelGap)}.` : ''}</p>`);
  else head = atCap
    ? `<p>Your hero has reached the level cap. Ascending is optional, but unlocks a subclass with new skill-tree branches and abilities.</p><div class="row gap"><button class="btn primary glow" data-act="ascend">🌟 Ascend</button></div>`
    : `<p class="small muted">At level ${CONFIG.levelCap} your hero can <b>ascend</b> into one of these subclasses (optional): back to level 1, but with a new skill-tree branch, new abilities, a passive bonus and +${cfg.bonusSkillPoints} skill points.</p>`;
  return `<section class="panel ascension-panel">
    <div class="panel-head"><h3>🌟 Ascension</h3></div>
    ${head}
    <details ${cur ? '' : 'open'}><summary class="small">Subclasses of the ${esc(CLASSES[ch.classId].name)}</summary>
      <div class="subclass-grid">${subs.map(s => subclassCard(s, { current: s.id === ch.subclass })).join('')}</div>
    </details>
  </section>`;
}

function openAscend(ch) {
  const subs = subclassesOf(ch.classId).filter(s => s.id !== ch.subclass);
  const m = modal(`<h3>🌟 ${ch.subclass ? 'Switch subclass' : 'Ascend'} — ${esc(ch.name)}</h3>
    <p class="small muted">Choose a ${esc(CLASSES[ch.classId].name)} subclass. You keep the whole ${esc(CLASSES[ch.classId].name)} tree and abilities; the subclass adds a new branch on top.</p>
    <div class="subclass-grid">${subs.map(s => subclassCard(s, { pick: true })).join('')}</div>`, { wide: true });
  m.el.addEventListener('click', async e => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    const sub = SUBCLASSES[b.dataset.pick];
    const gear = SLOT_IDS.filter(sl => ch.equipment[sl]).length;
    const cfg = CONFIG.ascension;
    const ok = await confirmBox(`<b>Ascend ${esc(ch.name)} as ${esc(sub.name)}?</b>
      <ul class="small">
        <li>${esc(ch.name)} goes back to <b>level 1</b> and the skill tree is reset (now with the ${esc(sub.name)} branch).</li>
        <li>All ${gear} equipped item${gear === 1 ? '' : 's'} will be <b>sent to your mailbox</b> (Auction House → Mailbox).</li>
        <li>+${cfg.bonusSkillPoints} bonus skill points and the ${esc(sub.name)} passive: ${describeNodeStats(sub.bonus).map(esc).join(', ')}.</li>
        ${cfg.levelSync?.enabled ? `<li><b>Level sync:</b> until ${esc(ch.name)} reaches level ${CONFIG.levelCap} again, everyone in the hero's party fights at the hero's level + ${cfg.levelSync.levelGap} (stats, skill points and gear scaled down). Your party starts again in the first zone.</li>` : ''}
        <li>Gold, items, recruits, town and everything else are kept.</li>
      </ul>`, `Ascend as ${sub.name}`, { html: true });
    if (!ok) return;
    const r = await run(act('ascend', { subclassId: sub.id }));
    if (r !== undefined) m.close();
  });
}

function specialEffectsHtml(ch) {
  const uniques = Object.values(ch.equipment).filter(i => i?.unique && UNIQUES[i.unique]);
  const counts = equippedSetCounts(ch);
  if (!uniques.length && !Object.keys(counts).length) return '';
  return `<div class="special-effects">
    ${uniques.map(i => `<div class="small"><span class="unique-name">✦ ${esc(UNIQUES[i.unique].name)}:</span> ${esc(UNIQUES[i.unique].description)}</div>`).join('')}
    ${Object.entries(counts).map(([sid, n]) => `<div class="small"><span class="set-name">${esc(SETS[sid].name)} (${n}/${Object.keys(SETS[sid].pieces).length})</span>
      ${Object.entries(SETS[sid].bonuses).map(([need, b]) => `<div class="set-bonus ${n >= Number(need) ? 'on' : ''}">(${need}) ${esc(b.description)}</div>`).join('')}</div>`).join('')}
  </div>`;
}

function statRow(label, value, tip) {
  return `<div class="stat-row" ${tip ? tipAttr(esc(tip)) : ''}><span>${esc(label)}</span><b>${value}</b></div>`;
}

function attrTip(classId, attr) {
  const sc = CLASSES[classId].scaling;
  const names = { hp: 'Health', physPower: 'Physical Power', magPower: 'Magic Power', healPower: 'Healing Power', defense: 'Defense', critChance: 'Crit Chance', attackSpeed: 'Attack Speed' };
  const parts = Object.entries(sc).filter(([, m]) => m[attr]).map(([k, m]) => `${names[k]}: ${k === 'critChance' || k === 'attackSpeed' ? '+' + (m[attr] * 100).toFixed(2) + '%' : '+' + m[attr]} per point`);
  return `<b>${ATTRIBUTES[attr].label}</b> for ${esc(CLASSES[classId].name)}<br>${parts.join('<br>') || 'No effect for this class.'}`;
}

function roleTip(role) {
  const r = CONFIG.roles[role];
  const parts = [];
  if (r.threatMult) parts.push(`Generates ${r.threatMult}× threat`);
  if (r.damageTakenPct) parts.push(`${Math.round(r.damageTakenPct * 100)}% damage taken`);
  if (r.damagePct) parts.push(`+${Math.round(r.damagePct * 100)}% damage`);
  if (r.healingPct) parts.push(`+${Math.round(r.healingPct * 100)}% healing`);
  if (r.buffDurationPct) parts.push(`+${Math.round(r.buffDurationPct * 100)}% buff duration`);
  return `<b>${esc(r.label)}</b><br>${parts.join('<br>')}`;
}

function openSlot(ch, slot) {
  const p = state.player;
  const current = ch.equipment[slot];
  const options = p.inventory.filter(i => i.slot === slot).sort((a, b) => b.level - a.level);
  const m = modal(`<h2>${esc(SLOTS[slot].label)} — ${esc(ch.name)}</h2>
    <h3>Equipped</h3>${current ? `<div class="item-choice">${itemIcon(current, 'md')}<div class="grow">${itemTooltipHtml(current)}</div><button class="btn small" data-unequip>Unequip</button></div>` : '<p class="muted">Nothing equipped.</p>'}
    <h3 style="margin-top:16px">From inventory</h3>
    <div class="item-choice-list">${options.length ? options.map(i => {
      const ok = canEquip(i, ch);
      return `<div class="item-choice ${ok ? '' : 'disabled'}">
        ${itemIcon(i, 'md')}
        <div class="grow">${itemTooltipHtml(i, current, ch)}</div>
        <button class="btn small primary" data-equip="${i.uid}" ${ok ? '' : 'disabled'}>${ok ? 'Equip' : i.requiredLevel > ch.level ? `Lv ${i.requiredLevel}` : 'Wrong class'}</button>
      </div>`;
    }).join('') : '<p class="muted">No items for this slot. Defeat enemies to find loot!</p>'}</div>`, { wide: true });
  m.el.addEventListener('click', async e => {
    const eq = e.target.closest('[data-equip]');
    if (eq) { if (await run(act('equip', { charId: ch.id, itemUid: eq.dataset.equip })) !== undefined) m.close(); }
    if (e.target.closest('[data-unequip]')) { if (await run(act('unequip', { charId: ch.id, slot })) !== undefined) m.close(); }
  });
}

export { roleBadge };
