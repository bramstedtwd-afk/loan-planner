// SVG charts. Colors come from CSS tokens so both themes work.
import { ymLabel } from './engine.js';
import { money } from './format.js';

// Total balance from the start month to payoff, with an optional graduation marker and a hover readout.
export function balanceArea(box, result, { grad = null } = {}) {
  const pts = [{ m: result.start, v: result.initTotal }, ...result.rows.map(x => ({ m: x.m + 1, v: x.total }))];
  const draw = () => {
    const W = Math.max(280, box.clientWidth || 600), H = 160, P = { l: 4, r: 4, t: 16, b: 22 };
    const m0 = pts[0].m, m1 = pts[pts.length - 1].m, span = Math.max(1, m1 - m0);
    const top = Math.max(...pts.map(p => p.v)) * 1.05 || 1;
    const X = m => P.l + (m - m0) / span * (W - P.l - P.r), Y = v => P.t + (1 - v / top) * (H - P.t - P.b);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.m).toFixed(1)},${Y(p.v).toFixed(1)}`).join('');
    const end = pts[pts.length - 1];
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Balance falls from ${money(pts[0].v)} to ${money(end.v)} by ${ymLabel(end.m)}">
      <defs><linearGradient id="balfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--accent);stop-opacity:.35"/><stop offset="1" style="stop-color:var(--accent);stop-opacity:0"/></linearGradient></defs>`;
    if (grad != null && grad > m0 && grad < m1) {
      const gx = X(grad + 1);
      svg += `<line x1="${gx}" x2="${gx}" y1="${P.t}" y2="${H - P.b}" style="stroke:var(--ink-3)" stroke-dasharray="3 4"/><text x="${gx + 6}" y="${P.t + 8}">Graduate</text>`;
    }
    svg += `<path d="${line}L${X(m1)},${H - P.b}L${X(m0)},${H - P.b}Z" fill="url(#balfill)"/>
      <path d="${line}" fill="none" style="stroke:var(--accent)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${X(m0)}" cy="${Y(pts[0].v)}" r="5" style="fill:var(--accent);stroke:var(--glass-strong)" stroke-width="2"/>
      <circle cx="${X(m1)}" cy="${Y(end.v)}" r="6" style="fill:${result.done ? 'var(--good)' : 'var(--crit)'};stroke:var(--glass-strong)" stroke-width="2.5"/>
      <text x="${X(m0)}" y="${H - 5}">${ymLabel(m0)}</text><text x="${X(m1)}" y="${H - 5}" text-anchor="end">${money(end.v)} · ${ymLabel(end.m)}</text>
      <line data-x y1="${P.t}" y2="${H - P.b}" style="stroke:var(--ink-2)" visibility="hidden"/><circle data-dot r="5" style="fill:var(--accent);stroke:var(--glass-strong)" stroke-width="2" visibility="hidden"/>
      <rect data-hit x="0" y="0" width="${W}" height="${H}" fill="transparent"/></svg><div class="tip" hidden></div>`;
    box.innerHTML = svg;
    const hit = box.querySelector('[data-hit]'), tip = box.querySelector('.tip'), xl = box.querySelector('[data-x]'), dot = box.querySelector('[data-dot]');
    const show = ev => {
      const r = box.querySelector('svg').getBoundingClientRect();
      const m = Math.round(m0 + ((ev.clientX - r.left) * W / r.width - P.l) / (W - P.l - P.r) * span);
      const p = pts.reduce((b, q) => Math.abs(q.m - m) < Math.abs(b.m - m) ? q : b, pts[0]);
      xl.setAttribute('x1', X(p.m)); xl.setAttribute('x2', X(p.m)); xl.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', X(p.m)); dot.setAttribute('cy', Y(p.v)); dot.setAttribute('visibility', 'visible');
      tip.innerHTML = `<span class="muted">Start of ${ymLabel(p.m)}</span><b class="num">${money(p.v)}</b>`;
      tip.hidden = false;
      const px = X(p.m) * r.width / W, tw = tip.offsetWidth;
      tip.style.left = Math.max(0, Math.min(box.clientWidth - tw, px + (px > box.clientWidth / 2 ? -tw - 12 : 12))) + 'px';
    };
    hit.addEventListener('pointermove', show); hit.addEventListener('pointerdown', show);
    hit.addEventListener('pointerleave', () => { tip.hidden = true; xl.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); });
  };
  draw();
  return draw;
}
