// A bottom sheet on phones, a centered panel on desktop. Closes on backdrop click, Escape, or [data-close].
export function openSheet(html, { label = 'Dialog', onOpen } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet-backdrop" data-close></div><div class="sheet glass" role="dialog" aria-modal="true" aria-label="${label}"><div class="grab" aria-hidden="true"></div>${html}</div>`;
  const prevFocus = document.activeElement;
  const close = () => { wrap.classList.add('out'); setTimeout(() => wrap.remove(), 180); removeEventListener('keydown', onKey); prevFocus?.focus?.(); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  wrap.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });
  addEventListener('keydown', onKey);
  document.body.appendChild(wrap);
  const sheet = wrap.querySelector('.sheet');
  onOpen?.(sheet, close);
  (sheet.querySelector('[autofocus]') || sheet.querySelector('input, select, button'))?.focus();
  return close;
}
