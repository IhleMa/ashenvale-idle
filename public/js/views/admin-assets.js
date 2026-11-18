// Admin → 🖼 Assets: which images the game looks for and which exist on this server.
import { act } from '../net.js';
import { esc, run, toast } from '../ui.js';

const ui = { show: 'missing', q: '', optional: true };
let data = null;

export async function mountAssets(host) {
  host.innerHTML = '<p class="muted">Scanning public/assets…</p>';
  data = await run(act('admin_assets'));
  if (!data) return;
  render(host);
  host.onclick = e => {
    const t = e.target.closest('[data-as-show], [data-as-refresh], [data-as-download], [data-as-copy]');
    if (!t) return;
    if (t.dataset.asShow) { ui.show = t.dataset.asShow; render(host); }
    if ('asRefresh' in t.dataset) mountAssets(host);
    if ('asDownload' in t.dataset) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([data.missingMarkdown], { type: 'text/markdown' }));
      a.download = 'ASSETS_MISSING.md';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    if (t.dataset.asCopy) navigator.clipboard?.writeText(t.dataset.asCopy).then(() => toast(`Copied ${t.dataset.asCopy}`, 'success', 1500));
  };
  host.oninput = e => {
    if (e.target.matches('[data-as-q]')) { ui.q = e.target.value.toLowerCase(); renderList(host); }
  };
  host.onchange = e => {
    if (e.target.matches('[data-as-opt]')) { ui.optional = e.target.checked; renderList(host); }
  };
}

function render(host) {
  const pct = data.total ? Math.round((data.found / data.total) * 100) : 0;
  host.innerHTML = `
    <div class="assets-head">
      <div><b>${data.found}</b> of <b>${data.total}</b> images present (${pct}%) · <b>${data.missing}</b> missing
        <span class="muted">(${data.missingRecommended} recommended, ${data.missing - data.missingRecommended} optional)</span></div>
      <div class="bar"><div class="fill" style="width:${pct}%"></div></div>
      <p class="muted small">Upload files to <code>public/assets/&lt;folder&gt;/</code> on the server (e.g. with the panel's file manager), named like below — any of .png, .webp, .jpg, .gif, .svg, .avif.
        Players see new art after a page refresh; no restart needed. Click a file name to copy it.</p>
      <div class="row gap wrap">
        <div class="tabs small">${[['missing', 'Missing'], ['present', 'Present'], ['all', 'All']].map(([id, l]) => `<button class="tab ${ui.show === id ? 'active' : ''}" data-as-show="${id}">${l}</button>`).join('')}</div>
        <input type="search" data-as-q placeholder="Filter (e.g. enemies, wolf)…" value="${esc(ui.q)}" style="width:220px">
        <label class="inline small"><input type="checkbox" data-as-opt ${ui.optional ? 'checked' : ''}> include optional</label>
        <span class="grow"></span>
        <button class="btn small" data-as-refresh>↻ Rescan</button>
        <button class="btn small" data-as-download>⬇ Download missing list (.md)</button>
      </div>
    </div>
    <div class="assets-list"></div>`;
  renderList(host);
}

function renderList(host) {
  const q = ui.q.trim();
  const secs = data.sections
    .filter(s => ui.optional || !s.optional)
    .map(s => ({
      ...s,
      list: s.entries.filter(e => (ui.show === 'all' || (ui.show === 'missing' ? !e.ok : e.ok))
        && (!q || e.file.toLowerCase().includes(q) || e.name.toLowerCase().includes(q) || s.title.toLowerCase().includes(q))),
    }))
    .filter(s => s.list.length)
    .sort((a, b) => (ui.show === 'missing' ? a.optional - b.optional : 0));
  const el = host.querySelector('.assets-list');
  if (!secs.length) { el.innerHTML = `<p class="muted">${ui.show === 'missing' && !q ? '🎉 Nothing missing.' : 'Nothing matches.'}</p>`; return; }
  el.innerHTML = secs.map(s => {
    const have = s.entries.filter(e => e.ok).length;
    return `<details class="assets-sec" ${secs.length <= 3 || q ? 'open' : ''}>
      <summary><b>${esc(s.title)}</b> <span class="muted small">${have}/${s.entries.length} present${s.optional ? ' · optional' : ''}</span></summary>
      ${s.note ? `<p class="muted small">${esc(s.note).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')}</p>` : ''}
      <div class="assets-grid">${s.list.map(e => `<div class="asset-cell ${e.ok ? 'ok' : ''}">
        ${e.ok ? `<img src="${esc(e.url)}" alt="" loading="lazy">` : '<span class="asset-missing">?</span>'}
        <div class="asset-text"><button class="link mono" data-as-copy="${esc(e.file)}" title="Copy file name">${esc(e.file)}</button><span class="muted small">${esc(e.name)}</span></div>
      </div>`).join('')}</div>
    </details>`;
  }).join('');
}
