// Shared page anatomy: every screen starts with the same header (title, save status, Settings gear),
// and tabs with more than one view use the same sub-navigation.
import { esc } from '../format.js';

export function header({ title, eyebrow = '', actions = '', back = false }) {
  return `<header class="topbar">
    <div>${eyebrow ? `<div class="date">${esc(eyebrow)}</div>` : ''}<h1>${esc(title)}</h1></div>
    <div class="top-actions">${actions}
      ${back ? '<button class="btn soft" type="button" data-back style="height:38px">Done</button>' : `
      <a class="sync glass" href="#settings" data-sync><span class="dot"></span><span data-sync-text></span></a>
      <a class="icon-btn glass gear" href="#settings" aria-label="Settings"><svg class="i"><use href="#i-gear"/></svg></a>`}
    </div>
  </header>`;
}

// items: [[routeKey, label]]
export function subnav(items, current, label) {
  return `<nav class="subnav" aria-label="${esc(label)}"><div class="seg">${items.map(([k, t]) =>
    `<a href="#${k}" ${k === current ? 'aria-current="page"' : ''}>${esc(t)}</a>`).join('')}</div></nav>`;
}
