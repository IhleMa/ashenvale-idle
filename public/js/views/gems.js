// Jewelcrafting: resonance gems (cut, fuse) and sockets.
import { state } from '../state.js';
import { act } from '../net.js';
import { esc, fmt, bar, run, toast, tipAttr, confirmBox, itemTooltipHtml } from '../ui.js';
import { itemIcon, gemIcon, materialIcon, portrait } from '../assets.js';
import { MATERIALS } from '/shared/data/town.js';
import { SLOTS, maxSockets } from '/shared/data/items.js';
import { GEM_IDS, GEM_KINDS, GEM_TIERS, MAX_GEM_TIER, GEM_CONFIG, COMBAT_GEMS, gemKey, parseGemKey, gemName, gemText, cutCost, fuseCost, drillCost, drillJewelerLevel, unsocketCost } from '/shared/gems.js';

const ui = { tab: 'pouch', sel: null }; // sel = { uid, charId }
const jLevel = p => p.town?.buildings?.jeweler?.level || 0;
const jWorker = p => { const id = p.town?.buildings?.jeweler?.worker; return id ? p.characters[id] : null; };

function costHtml(p, cost) {
  const parts = [];
  if (cost.gold) parts.push(`<span class="${p.gold >= cost.gold ? '' : 'bad-text'}">${fmt(cost.gold)}g</span>`);
  for (const [k, v] of Object.entries(cost.mats || {})) parts.push(`<span class="${(p.town.materials[k] || 0) >= v ? '' : 'bad-text'}">${materialIcon(k, 'xxs')} ${fmt(v)} ${esc(MATERIALS[k]?.name || k)}</span>`);
  return parts.join(' · ');
}
const affordable = (p, c) => p.gold >= (c.gold || 0) && Object.entries(c.mats || {}).every(([k, v]) => (p.town.materials[k] || 0) >= v);

function jewelerNote(p) {
  if (!jLevel(p)) return `<div class="notice">🏗 Build the <b>Jeweler</b> in your <a href="#/town">Town</a> to cut gems and drill sockets. Socketing gems you already have works anywhere.</div>`;
  if (!jWorker(p)) return `<div class="notice">👷 Assign a recruit to the <b>Jeweler</b> in your <a href="#/town">Town</a> — a jewelcrafter cuts and fuses the gems.</div>`;
  const w = jWorker(p);
  return `<div class="muted small">💍 Jeweler level ${jLevel(p)} · ${esc(w.name)} (Jewelcrafting ${w.profession.level}) — ${Math.round(Math.min(0.2, w.profession.level / 250) * 100)}% chance for a bonus gem when cutting or fusing.</div>`;
}

// ---------------------------------------------------------------- gems tab: every gem kind, its qualities, cutting & fusing
function pouchHtml(p) {
  const gems = p.town.gems || {};
  const total = Object.values(gems).reduce((a, b) => a + b, 0);
  const can = jLevel(p) >= 1 && jWorker(p);
  const cc = cutCost(1);
  return `<section class="panel">
    <div class="panel-head"><h3>💎 Resonance gems <span class="muted small">${fmt(total)} in your pouch</span></h3><span class="muted small">${GEM_CONFIG.fuseCount} gems → 1 of the next quality</span></div>
    <p class="muted small">A socketed gem changes the <b>affixes of its own item</b>. Gems drop from enemies (bosses and rifts most often); the Jeweler cuts a Chipped gem of your choice from Gem Fragments (${costHtml(p, cc)}). One gem of each kind per item.</p>
    ${jewelerNote(p)}
    ${p.town.gemRefund?.fragments && Date.now() - p.town.gemRefund.at < 14 * 864e5 ? `<div class="notice small">Gems were reworked: your old stat gems and shards were turned into ${fmt(p.town.gemRefund.fragments)} Gem Fragments.</div>` : ''}
    <div class="gem-kinds">${GEM_IDS.map(kind => {
      const g = GEM_KINDS[kind];
      return `<div class="gem-kind">
        <div class="row gap">${gemIcon(kind, 1, 'md')}<div class="grow"><b>${esc(g.name)}</b>${COMBAT_GEMS.has(g.effect) ? ' <span class="tag">combat</span>' : ''}<div class="small muted">${esc(gemText(kind, 1))}</div></div>
          <button class="btn tiny ${can && affordable(p, cc) ? 'primary' : ''}" data-cut="${kind}" ${can && affordable(p, cc) ? '' : 'disabled'} ${tipAttr(`Cut a ${esc(gemName(kind, 1))}<br>${costHtml(p, cc)}`)}>Cut</button></div>
        <div class="gem-qualities">${GEM_TIERS.slice(1).map((t, i) => {
          const tier = i + 1, n = gems[gemKey(kind, tier)] || 0;
          const canFuse = tier < MAX_GEM_TIER && n >= GEM_CONFIG.fuseCount;
          const fc = tier < MAX_GEM_TIER ? fuseCost(tier) : null;
          const fuseOk = canFuse && jWorker(p) && jLevel(p) >= GEM_TIERS[tier + 1].jeweler && affordable(p, fc);
          return `<div class="gem-q ${n ? '' : 'empty'}" ${tipAttr(`<b>${esc(gemName(kind, tier))}</b><br>${esc(gemText(kind, tier))}`)}>${gemIcon(kind, tier, 'sm')}<b>${n}</b>
            ${canFuse ? `<button class="btn tiny ${fuseOk ? 'primary' : ''}" data-fuse="${kind}" data-tier="${tier}" ${fuseOk ? '' : 'disabled'} ${tipAttr(`Fuse ${GEM_CONFIG.fuseCount}× ${esc(gemName(kind, tier))} → 1× ${esc(gemName(kind, tier + 1))}<br>${costHtml(p, fc)}${jLevel(p) < GEM_TIERS[tier + 1].jeweler ? `<br>Needs Jeweler level ${GEM_TIERS[tier + 1].jeweler}` : ''}`)}>⤴</button>` : ''}</div>`;
        }).join('')}</div>
      </div>`;
    }).join('')}</div>
  </section>`;
}

// ---------------------------------------------------------------- sockets tab
function findSel(p) {
  if (!ui.sel) return null;
  if (ui.sel.charId) { const ch = p.characters[ui.sel.charId]; const it = ch && Object.values(ch.equipment).find(i => i?.uid === ui.sel.uid); return it ? { item: it, ch } : null; }
  const it = p.inventory.find(i => i.uid === ui.sel.uid);
  return it ? { item: it, ch: null } : null;
}

function socketsHtml(p) {
  const party = new Set(p.parties?.[p.activeParty ?? 0]?.members || []);
  const chars = Object.values(p.characters).sort((a, b) => (party.has(b.id) - party.has(a.id)) || (b.isMain - a.isMain));
  const selected = findSel(p);
  const invSocketed = p.inventory.filter(i => i.sockets?.length || maxSockets(i) > 0).sort((a, b) => (b.sockets?.length || 0) - (a.sockets?.length || 0) || b.level - a.level);
  const slotCell = (it, charId) => `<button class="sock-item ${selected?.item.uid === it.uid ? 'active' : ''}" data-pick="${it.uid}" data-char="${charId || ''}" ${tipAttr(itemTooltipHtml(it))}>${itemIcon(it, 'sm')}<span class="sock-dots">${(it.sockets || []).map(g => `<i class="${g ? 'full' : ''}" style="${g ? `--gem:${GEM_KINDS[parseGemKey(g)?.kind]?.color}` : ''}"></i>`).join('')}</span></button>`;
  return `<div class="sock-layout">
    <section class="panel sock-pick">
      <h3>Choose an item</h3>
      ${chars.map(ch => `<div class="sock-char"><div class="row gap">${portrait(ch, 'xs')}<b>${esc(ch.name)}</b>${party.has(ch.id) ? '<span class="tag">party</span>' : ''}</div>
        <div class="sock-row">${Object.values(ch.equipment).filter(Boolean).map(it => slotCell(it, ch.id)).join('') || '<span class="faint small">nothing equipped</span>'}</div></div>`).join('')}
      <div class="sock-char"><b>Inventory</b> <span class="muted small">${invSocketed.length} items</span><div class="sock-row">${invSocketed.slice(0, 60).map(it => slotCell(it, null)).join('') || '<span class="faint small">empty</span>'}</div></div>
    </section>
    <section class="panel sock-detail">${selected ? itemSocketHtml(p, selected) : '<p class="muted">Pick an item on the left. Items show their sockets as dots — filled ones hold a gem.</p>'}</section>
  </div>`;
}

function itemSocketHtml(p, { item, ch }) {
  const sockets = item.sockets || [];
  const max = maxSockets(item);
  const used = new Set(sockets.map(g => parseGemKey(g)?.kind).filter(Boolean));
  const gems = Object.entries(p.town.gems || {}).filter(([, n]) => n > 0).map(([k, n]) => ({ k, n, ...parseGemKey(k) })).filter(g => g.kind).sort((a, b) => a.kind.localeCompare(b.kind) || b.tier - a.tier);
  const dc = sockets.length < max ? drillCost(item) : null;
  const dl = sockets.length < max ? drillJewelerLevel(item) : null;
  const canDrill = dc && jWorker(p) && jLevel(p) >= dl && affordable(p, dc);
  return `<div class="row gap">${itemIcon(item, 'md')}<div><div class="rarity-text rarity-${item.rarity}"><b>${esc(item.name)}</b></div><div class="muted small">${esc(SLOTS[item.slot]?.label)} · item level ${item.level}${ch ? ` · worn by ${esc(ch.name)}` : ''}</div></div></div>
    <h4>Sockets <span class="muted small">${sockets.length} / ${max} possible</span></h4>
    ${sockets.length ? sockets.map((g, i) => {
      const gem = g && parseGemKey(g);
      return `<div class="socket ${gem ? 'full' : ''}">
        <div class="socket-hole">${gem ? gemIcon(gem.kind, gem.tier, 'md') : '<span class="empty-socket"></span>'}</div>
        <div class="grow">${gem ? `<b>${esc(gemName(gem.kind, gem.tier))}</b><div class="small muted">${esc(gemText(gem.kind, gem.tier))}</div>` : '<span class="muted">Empty socket</span>'}
          <div class="row gap wrap"><select data-gem-for="${i}"><option value="">${gem ? 'Swap for…' : 'Insert a gem…'}</option>${gems.filter(x => !used.has(x.kind) || x.kind === gem?.kind).map(x => `<option value="${x.k}">${esc(gemName(x.kind, x.tier))} ×${x.n}</option>`).join('')}</select>
          ${gem ? `<button class="btn tiny ghost" data-unsocket="${i}" ${tipAttr('The gem goes back into your pouch.')}>Remove (${fmt(unsocketCost(gem.tier, item.level))}g)</button>` : ''}</div></div>
      </div>`;
    }).join('') : '<p class="muted small">This item has no sockets yet.</p>'}
    ${!gems.length ? '<p class="faint small">Your gem pouch is empty — gems drop from enemies, or cut one at the Jeweler.</p>' : ''}
    <h4>With its gems</h4><div class="gem-preview">${itemTooltipHtml(item)}</div>
    ${dc ? `<div class="drill"><h4>Drill a socket</h4><div class="small">${costHtml(p, dc)}</div>
        ${jLevel(p) < dl ? `<div class="warn-text small">Socket #${sockets.length + 1} needs Jeweler level ${dl}.</div>` : !jWorker(p) ? '<div class="warn-text small">Needs a jewelcrafter working at the Jeweler.</div>' : ''}
        <button class="btn small ${canDrill ? 'primary' : ''}" data-drill ${canDrill ? '' : 'disabled'}>🔩 Drill socket #${sockets.length + 1}</button></div>`
      : `<p class="faint small">${esc(SLOTS[item.slot]?.label)}s of this rarity hold at most ${max} socket${max > 1 ? 's' : ''}.</p>`}
    <p class="faint small">Gems stay in the item when you trade it on the Auction House. Selling or salvaging an item returns its gems to your pouch.</p>`;
}

function html() {
  const p = state.player;
  if (!p.town) return '<section class="panel"><p class="muted">Create your hero first.</p></section>';
  const tabs = [['pouch', '💎 Gems & fusing'], ['sockets', '🔩 Sockets']];
  return `<div class="tabs">${tabs.map(([id, l]) => `<button class="tab ${ui.tab === id ? 'active' : ''}" data-gtab="${id}">${l}</button>`).join('')}</div>
    ${ui.tab === 'sockets' ? socketsHtml(p) : pouchHtml(p)}`;
}

export function openSockets(uid, charId = null) { ui.tab = 'sockets'; ui.sel = { uid, charId }; location.hash = '#/gems'; }

export const gemsView = {
  id: 'gems', label: 'Gems', icon: '💎',
  mount(root) {
    root.addEventListener('click', async e => {
      const t = e.target.closest('button');
      if (!t) return;
      const d = t.dataset;
      if (d.gtab) { ui.tab = d.gtab; this.render(root); return; }
      if (d.pick) { ui.sel = { uid: d.pick, charId: d.char || null }; this.render(root); return; }
      if (d.cut) {
        const r = await run(act('gem_cut', { kind: d.cut, count: 1 }));
        if (r) toast(`Cut ${r.count}× ${gemName(d.cut, 1)}${r.extra ? ` (${r.extra} bonus!)` : ''}`, 'success');
        return;
      }
      if (d.fuse) {
        const tier = Number(d.tier);
        const r = await run(act('gem_fuse', { kind: d.fuse, tier }));
        if (r) toast(`Fused into ${gemName(d.fuse, tier + 1)}${r.extra ? ' — and a bonus one!' : ''}`, 'success');
        return;
      }
      const sel = findSel(state.player);
      if (!sel) return;
      const ref = { itemUid: sel.item.uid, charId: sel.ch?.id || null };
      if ('unsocket' in d) { await run(act('gem_unsocket', { ...ref, index: Number(d.unsocket) }), 'Gem returned to your pouch.'); return; }
      if ('drill' in d) {
        const c = drillCost(sel.item);
        if (await confirmBox(`Drill socket #${(sel.item.sockets?.length || 0) + 1} into ${sel.item.name}? Cost: ${fmt(c.gold)} gold and materials.`, 'Drill')) await run(act('gem_drill', ref), 'New socket drilled!');
      }
    });
    root.addEventListener('change', async e => {
      const t = e.target;
      if (t.matches('[data-gem-for]') && t.value) {
        const sel = findSel(state.player);
        if (!sel) return;
        const idx = Number(t.dataset.gemFor);
        const old = sel.item.sockets?.[idx];
        if (old) {
          const o = parseGemKey(old);
          if (!(await confirmBox(`Swap the ${gemName(o.kind, o.tier)} (back to your pouch, ${fmt(unsocketCost(o.tier, sel.item.level))} gold) for this gem?`, 'Swap'))) { t.value = ''; return; }
        }
        await run(act('gem_socket', { itemUid: sel.item.uid, charId: sel.ch?.id || null, index: idx, gem: t.value }), 'Gem socketed.');
      }
    });
  },
  render(root) {
    if (document.activeElement?.tagName === 'SELECT' && root.contains(document.activeElement)) return;
    root.innerHTML = html();
  },
};
