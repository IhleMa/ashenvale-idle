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
import { abilitySlots, respecCost } from '/shared/character.js';

export const characterView = {
  id: 'character', label: 'Character', icon: '👤',
  mount(root) {
    bindPicker(root, () => this.render(root));
    root.addEventListener('click', async e => {
      const ch = selectedChar();
      const t = e.target.closest('[data-act]');
      if (!t || !ch) return;
      const a = t.dataset.act;
      if (a === 'attr') await run(act('allocate_attribute', { charId: ch.id, attr: t.dataset.attr, amount: e.shiftKey ? ch.unspentAttributePoints : 1 }));
      if (a === 'respec' && await confirmBox(`Reset all spent attribute points for ${respecCost(ch)} gold?`, 'Reset')) await run(act('reset_attributes', { charId: ch.id }));
      if (a === 'slot') openSlot(ch, t.dataset.slot);
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
            <div class="muted">${esc(charTitle(ch))} · ${classBadge(ch.classId)} ${ch.isMain ? '<span class="tag hero">HERO</span>' : ''}</div>
            <div class="lvl-line"><b>Level ${ch.level}</b>${ch.level < CONFIG.levelCap ? bar(ch.xp, xpToNext(ch.level), 'xp', `${fmt(ch.xp)} / ${fmt(xpToNext(ch.level))} XP`) : '<span class="muted"> (max level)</span>'}</div>
            <div class="row gap wrap">
              <label class="inline">Role <select data-role>${Object.entries(CONFIG.roles).map(([id, r]) => `<option value="${id}" ${ch.role === id ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select></label>
              <span class="muted small" ${tipAttr(roleTip(ch.role))}>ⓘ role bonus</span>
              ${ch.trait ? `<span class="trait" ${tipAttr(esc(TRAITS[ch.trait].description))}>Trait: ${esc(TRAITS[ch.trait].name)}</span>` : ''}
              <span class="muted small">Power ${fmt(powerRating(s))}</span>
            </div>
            ${ch.isMain ? `<div class="hero-perks small muted">Hero perks: +${Math.round(CONFIG.mainCharacter.attributeBonus * 100)}% attributes · ${abilitySlots(ch)} ability slots · +${CONFIG.mainCharacter.extraAttributePointsPerLevel} attribute point/level · +${Math.round(CONFIG.mainCharacter.xpBonus * 100)}% XP · Leadership aura at Lv ${CONFIG.mainCharacter.leadershipAura.unlockLevel}</div>` : `<div class="row end"><button class="btn small danger ghost" data-act="dismiss">Dismiss</button></div>`}
          </div>
        </section>

        <section class="panel">
          <div class="panel-head"><h3>Attributes</h3>${ch.unspentAttributePoints ? `<span class="points">${ch.unspentAttributePoints} point${ch.unspentAttributePoints > 1 ? 's' : ''} to spend</span>` : ''}</div>
          <div class="attr-list">
            ${Object.entries(ATTRIBUTES).map(([k, a]) => `<div class="attr-row">
              <span class="attr-name" ${tipAttr(attrTip(ch.classId, k))}>${a.label}</span>
              <b>${s.attributes[k]}</b>
              <span class="muted small">${ch.attributes[k] ? `(+${ch.attributes[k]} spent)` : ''}</span>
              ${ch.unspentAttributePoints ? `<button class="btn tiny" data-act="attr" data-attr="${k}" title="Shift-click to spend all">+</button>` : ''}
            </div>`).join('')}
          </div>
          <div class="row between small muted"><span>Shift-click + to spend all points.</span><button class="btn tiny ghost" data-act="respec">Respec (${fmt(respecCost(ch))}g)</button></div>
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
              return `<button class="equip-slot" data-act="slot" data-slot="${slot}" ${it ? tipAttr(itemTooltipHtml(it)) : ''}>
                ${it ? itemIcon(it, 'md') : slotIcon(slot, 'md')}
                <span class="slot-text"><small>${esc(SLOTS[slot].label)}</small><b class="${it ? `rarity-text rarity-${it.rarity}` : 'muted'}">${it ? esc(it.name) : 'Empty'}</b></span>
              </button>`;
            }).join('')}
          </div>
          <div class="muted small">${p.inventory.filter(i => canEquip(i, ch)).length} usable item(s) in inventory.</div>
        </section>
      </div>`;
  },
};

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
        <div class="grow">${itemTooltipHtml(i, current)}</div>
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
