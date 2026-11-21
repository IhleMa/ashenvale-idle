// Updates a part of the page to new HTML by changing only what differs (DOM morphing with idiomorph) instead of
// replacing everything. Elements that stay keep their scroll position, focus, typed text, open dropdowns, running
// CSS animations and hover state, so state updates (a fight ending, gold ticking up) never reset what the player
// is doing. Event listeners belong on the view's root (delegation), which is never replaced.
import { Idiomorph } from './vendor/idiomorph.js';

const OPTIONS = {
  morphStyle: 'innerHTML',
  ignoreActiveValue: true, // don't overwrite what the player is typing in the focused field
  restoreFocus: true,
  callbacks: {
    // <details> the player opened or closed keeps that state
    beforeAttributeUpdated: (name, el) => !(name === 'open' && el.tagName === 'DETAILS'),
  },
};

export function setHtml(el, html) {
  if (!el) return;
  if (!el.firstChild) { el.innerHTML = html; return; } // first draw: nothing to keep
  Idiomorph.morph(el, html, OPTIONS);
}

// drop-in for `el.innerHTML = html` in render code: `morphed(el).innerHTML = html`
export const morphed = el => ({ set innerHTML(html) { setHtml(el, html); } });
