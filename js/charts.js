// SVG charts. Colors come from CSS tokens so both themes work; every chart has a hover/tap readout.
import { ymLabel } from './engine.js';
import { money, esc } from './format.js';

export function niceMax(v) { if (!(v > 0)) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); return [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10].find(s => v / p <= s) * p; }
const tickCount = v => ({ 3: 3, 6: 3, 5: 5, 10: 5 })[Math.round(v / Math.pow(10, Math.floor(Math.log10(v))) * 10) / 10] || 4;
export const kfmt = v => Math.abs(v) >= 1000 ? `$${(v / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k` : `$${Math.round(v)}`;
const short = m => ymLabel(m).replace(/ 20(\d\d)$/, ' ’$1');

// Shared plumbing: y gridlines, year ticks, graduation line, and a hover layer that maps pointer x → index.
function gridY(top, Y, W, P, bottom = 0) {
  const n = tickCount(top); let s = '';
  for (let i = 0; i <= n; i++) { const v = top * i / n; s += `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}" style="stroke:var(--hairline)"/><text x="${P.l - 8}" y="${Y(v) + 4}" text-anchor="end">${kfmt(v)}</text>`; }
  if (bottom && Y(-bottom) - Y(0) >= 14) s += `<text x="${P.l - 8}" y="${Y(-bottom) + 4}" text-anchor="end">−${kfmt(bottom)}</text>`;
  return s;
}
function yearTicks(m0, m1, X, H) {
  const span = (m1 - m0) / 12, step = span > 24 ? 5 : span > 10 ? 2 : 1; let s = '';
  for (let y = Math.ceil(m0 / 12); y * 12 <= m1; y++) if ((y - Math.ceil(m0 / 12)) % step === 0) s += `<text x="${X(y * 12)}" y="${H - 6}" text-anchor="middle">${y}</text>`;
  return s;
}
const gradLine = (gx, P, H) => `<line x1="${gx}" x2="${gx}" y1="${P.t}" y2="${H - P.b}" style="stroke:var(--ink-3)" stroke-dasharray="3 4"/><text x="${gx + 5}" y="${P.t + 9}">Graduate</text>`;

function hover(box, { W, P, H, count, xAt, html, onClick }) {
  box.insertAdjacentHTML('beforeend', '<div class="tip" hidden></div>');
  const svg = box.querySelector('svg'), tip = box.querySelector('.tip');
  svg.insertAdjacentHTML('beforeend', `<line data-x y1="${P.t}" y2="${H - P.b}" style="stroke:var(--ink-2)" visibility="hidden"/><rect data-hit x="${P.l}" y="0" width="${W - P.l - P.r}" height="${H}" fill="transparent" ${onClick ? 'style="cursor:pointer"' : ''}/>`);
  const hit = svg.querySelector('[data-hit]'), xl = svg.querySelector('[data-x]');
  const idx = ev => { const r = svg.getBoundingClientRect(); const x = (ev.clientX - r.left) * W / r.width; let best = 0, d = Infinity; for (let i = 0; i < count; i++) { const dd = Math.abs(xAt(i) - x); if (dd < d) { d = dd; best = i; } } return best; };
  const show = ev => {
    const i = idx(ev), r = svg.getBoundingClientRect(), x = xAt(i);
    xl.setAttribute('x1', x); xl.setAttribute('x2', x); xl.setAttribute('visibility', 'visible');
    tip.innerHTML = html(i); tip.hidden = false;
    const px = x * r.width / W, tw = tip.offsetWidth;
    tip.style.left = Math.max(0, Math.min(box.clientWidth - tw, px + (px > box.clientWidth / 2 ? -tw - 14 : 14))) + 'px';
  };
  hit.addEventListener('pointermove', show); hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', () => { tip.hidden = true; xl.setAttribute('visibility', 'hidden'); });
  if (onClick) hit.addEventListener('click', ev => onClick(idx(ev)));
}
const tipRow = (label, value, color) => `<div class="trow"><span>${color ? `<i style="background:${color}"></i>` : ''}${esc(label)}</span><b class="num">${value}</b></div>`;

// Loans grouped for stacking: first 8 keep their color, the rest fold into "Other".
function groups(loans, colorOf) {
  const g = loans.slice(0, 8).map(l => ({ ids: [l.id], name: l.name, color: colorOf(l.id) }));
  if (loans.length > 8) g.push({ ids: loans.slice(8).map(l => l.id), name: `${loans.length - 8} other loans`, color: 'var(--s-other)' });
  return g;
}
export const legend = items => items.map(i => `<span class="lg"><i class="${i.dash ? 'dash' : ''}" style="${i.dash ? '' : `background:${i.color}`}"></i>${esc(i.name)}</span>`).join('');

// Today: total balance falling to zero.
export function balanceArea(box, result, { grad = null } = {}) {
  const pts = [{ m: result.start, v: result.initTotal }, ...result.rows.map(x => ({ m: x.m + 1, v: x.total }))];
  const draw = () => {
    const W = Math.max(280, box.clientWidth || 600), H = 160, P = { l: 4, r: 4, t: 16, b: 22 };
    const m0 = pts[0].m, m1 = pts[pts.length - 1].m, span = Math.max(1, m1 - m0), top = Math.max(...pts.map(p => p.v)) * 1.05 || 1;
    const X = m => P.l + (m - m0) / span * (W - P.l - P.r), Y = v => P.t + (1 - v / top) * (H - P.t - P.b);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.m).toFixed(1)},${Y(p.v).toFixed(1)}`).join('');
    const end = pts[pts.length - 1];
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Balance falls from ${money(pts[0].v)} to ${money(end.v)} by ${ymLabel(end.m)}">
      <defs><linearGradient id="balfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--accent);stop-opacity:.35"/><stop offset="1" style="stop-color:var(--accent);stop-opacity:0"/></linearGradient></defs>
      ${grad != null && grad > m0 && grad < m1 ? gradLine(X(grad + 1), P, H) : ''}
      <path d="${line}L${X(m1)},${H - P.b}L${X(m0)},${H - P.b}Z" fill="url(#balfill)"/>
      <path d="${line}" fill="none" style="stroke:var(--accent)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${X(m0)}" cy="${Y(pts[0].v)}" r="5" style="fill:var(--accent);stroke:var(--glass-strong)" stroke-width="2"/>
      <circle cx="${X(m1)}" cy="${Y(end.v)}" r="6" style="fill:${result.done ? 'var(--good)' : 'var(--crit)'};stroke:var(--glass-strong)" stroke-width="2.5"/>
      <text x="${X(m0)}" y="${H - 5}">${ymLabel(m0)}</text><text x="${X(m1)}" y="${H - 5}" text-anchor="end">${money(end.v)} · ${ymLabel(end.m)}</text></svg>`;
    hover(box, { W, P, H, count: pts.length, xAt: i => X(pts[i].m), html: i => `<span class="muted">Start of ${ymLabel(pts[i].m)}</span><b class="num big-tip">${money(pts[i].v)}</b>` });
  };
  draw(); return draw;
}

// Plan: balance by loan (stacked) with the minimums-only total as a dashed line.
export function stackedBalance(box, r, base, loans, colorOf, { grad = null } = {}) {
  const gs = groups(loans, colorOf);
  const pts = [{ m: r.start, bal: r.init, total: r.initTotal }, ...r.rows.map(x => ({ m: x.m + 1, bal: x.bal, total: x.total }))];
  const bpts = base ? [{ m: base.start, total: base.initTotal }, ...base.rows.map(x => ({ m: x.m + 1, total: x.total }))] : [];
  const draw = () => {
    const W = Math.max(300, box.clientWidth || 700), H = W < 560 ? 230 : 290, P = { l: 48, r: 10, t: 14, b: 24 };
    const m0 = r.start, last = pts[pts.length - 1].m;
    const m1 = Math.max(last + (base ? 18 : 0), m0 + 12);
    const top = niceMax(Math.max(...pts.map(p => p.total), ...bpts.filter(p => p.m <= m1).map(p => p.total)) * 1.03);
    const X = m => P.l + (m - m0) / (m1 - m0) * (W - P.l - P.r), Y = v => P.t + (1 - v / top) * (H - P.t - P.b);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Balance by loan over time"><defs>${gs.map((g, i) => `<linearGradient id="sb${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${g.color};stop-opacity:.95"/><stop offset="1" style="stop-color:${g.color};stop-opacity:.7"/></linearGradient>`).join('')}<clipPath id="sbclip"><rect x="${P.l}" y="0" width="${W - P.l - P.r}" height="${H}"/></clipPath></defs>`;
    s += gridY(top, Y, W, P) + yearTicks(m0, m1, X, H);
    const cum = pts.map(() => 0);
    gs.forEach((g, gi) => {
      const lower = cum.slice();
      pts.forEach((p, k) => { cum[k] += g.ids.reduce((a, id) => a + (p.bal[id] || 0), 0); });
      if (cum.every((c, k) => c - lower[k] < 0.5)) return;
      let d = pts.map((p, k) => `${k ? 'L' : 'M'}${X(p.m).toFixed(1)},${Y(cum[k]).toFixed(1)}`).join('');
      for (let k = pts.length - 1; k >= 0; k--) d += `L${X(pts[k].m).toFixed(1)},${Y(lower[k]).toFixed(1)}`;
      s += `<path d="${d}Z" fill="url(#sb${gi})" style="stroke:var(--glass-strong)" stroke-width="1.2" stroke-linejoin="round"/>`;
    });
    if (base) s += `<path clip-path="url(#sbclip)" d="${bpts.map((p, k) => `${k ? 'L' : 'M'}${X(p.m).toFixed(1)},${Y(p.total).toFixed(1)}`).join('')}" fill="none" style="stroke:var(--ink-2)" stroke-width="2" stroke-dasharray="6 5"/>`;
    if (grad != null && grad > m0 && grad < m1) s += gradLine(X(grad + 1), P, H);
    if (r.done) s += `<circle cx="${X(last)}" cy="${Y(0)}" r="6" style="fill:var(--good);stroke:var(--glass-strong)" stroke-width="2.5"/>`;
    box.innerHTML = s + `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(0)}" y2="${Y(0)}" style="stroke:var(--ink-3)"/></svg>`;
    const months = []; for (let m = m0; m <= m1; m++) months.push(m);
    hover(box, { W, P, H, count: months.length, xAt: i => X(months[i]), html: i => {
      const m = months[i], p = pts.find(q => q.m === m) || { bal: {}, total: 0 }, b = bpts.find(q => q.m === m);
      return `<span class="muted">Start of ${ymLabel(m)}</span>${gs.map(g => ({ g, v: g.ids.reduce((a, id) => a + (p.bal[id] || 0), 0) })).filter(o => o.v >= 0.5).map(o => tipRow(o.g.name, money(o.v), o.g.color)).join('')}
        <div class="trow total"><span>${p.total < 0.5 ? 'Debt-free' : 'Total owed'}</span><b class="num">${money(p.total)}</b></div>${b ? tipRow('Minimums only', money(b.total)) : ''}`;
    } });
  };
  draw(); return draw;
}

// Plan: what you send each month, stacked by loan.
export function paymentBars(box, r, loans, colorOf, { grad = null } = {}) {
  const gs = groups(loans, colorOf), rows = r.rows;
  const draw = () => {
    if (!rows.length) { box.innerHTML = ''; return; }
    const W = Math.max(280, box.clientWidth || 480), H = 210, P = { l: 44, r: 6, t: 12, b: 24 };
    const top = niceMax(Math.max(1, ...rows.map(x => x.paid))), m0 = rows[0].m, m1 = rows[rows.length - 1].m + 1;
    const bw = (W - P.l - P.r) / rows.length, X = m => P.l + (m - m0) * bw, Y = v => P.t + (1 - v / top) * (H - P.t - P.b);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly loan payments by loan">` + gridY(top, Y, W, P) + yearTicks(m0, m1, X, H);
    rows.forEach(x => {
      let acc = 0; const bx = X(x.m) + (bw > 4 ? 0.6 : 0), w = Math.max(0.7, bw - (bw > 4 ? 1.2 : 0));
      for (const g of gs) { const v = g.ids.reduce((a, id) => a + (x.pay[id] || 0), 0); if (v < 0.5) continue; s += `<rect x="${bx.toFixed(2)}" y="${Y(acc + v).toFixed(1)}" width="${w.toFixed(2)}" height="${(Y(acc) - Y(acc + v)).toFixed(1)}" fill="${g.color}" rx="${Math.min(2, w / 3)}"/>`; acc += v; }
    });
    if (grad != null && grad >= m0 && grad < m1) s += gradLine(X(grad + 1), P, H);
    box.innerHTML = s + `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(0)}" y2="${Y(0)}" style="stroke:var(--ink-3)"/></svg>`;
    hover(box, { W, P, H, count: rows.length, xAt: i => X(rows[i].m) + bw / 2, html: i => {
      const x = rows[i];
      return `<span class="muted">${ymLabel(x.m)}</span>${gs.map(g => ({ g, v: g.ids.reduce((a, id) => a + (x.pay[id] || 0), 0) })).filter(o => o.v >= 0.5).map(o => tipRow(o.g.name, money(o.v), o.g.color)).join('')}
        <div class="trow total"><span>Total</span><b class="num">${money(x.paid)}</b></div>${tipRow('Of that, interest', money(x.interestPaid))}`;
    } });
  };
  draw(); return draw;
}

// Plan: cumulative interest per strategy; the current one is bold, minimums-only dashed.
export function raceLines(box, results, current, strategies) {
  const series = strategies.map(s => { let c = 0; return { s, r: results[s.id], cum: [0, ...results[s.id].rows.map(x => (c += x.interest))] }; });
  const draw = () => {
    const start = results[current].start, nonMin = series.filter(o => o.s.id !== 'minimum');
    const span = Math.max(24, ...nonMin.map(o => o.cum.length + 6));
    const at = (o, k) => o.cum[Math.min(k, o.cum.length - 1)];
    const W = Math.max(280, box.clientWidth || 480), H = 210, P = { l: 44, r: 8, t: 14, b: 24 };
    const top = niceMax(Math.max(...series.map(o => at(o, span))) * 1.05);
    const X = k => P.l + k / span * (W - P.l - P.r), Y = v => P.t + (1 - v / top) * (H - P.t - P.b);
    const path = o => { let d = ''; for (let k = 0; k <= span; k++) d += `${k ? 'L' : 'M'}${X(k).toFixed(1)},${Y(at(o, k)).toFixed(1)}`; return d; };
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Interest paid over time by strategy">` + gridY(top, Y, W, P) + yearTicks(start, start + span, k => X(k - start), H);
    for (const o of series) if (o.s.id !== current) s += `<path d="${path(o)}" fill="none" style="stroke:var(--ink-3)" stroke-width="${o.s.id === 'minimum' ? 2 : 1.5}" ${o.s.id === 'minimum' ? 'stroke-dasharray="6 5"' : 'stroke-opacity=".55"'}/>`;
    const cur = series.find(o => o.s.id === current), endK = Math.min(cur.cum.length - 1, span);
    s += `<path d="${path(cur)}" fill="none" style="stroke:var(--accent)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${X(endK)}" cy="${Y(at(cur, endK))}" r="5" style="fill:var(--accent);stroke:var(--glass-strong)" stroke-width="2"/>
      <text x="${X(endK) - 6}" y="${Y(at(cur, endK)) - 10}" text-anchor="end" style="fill:var(--ink);font-weight:650">${esc(cur.s.name)} ${money(cur.r.totalInterest)}</text>`;
    if (current !== 'minimum') { const mo = series.find(o => o.s.id === 'minimum'); s += `<text x="${W - P.r}" y="${Math.max(P.t + 10, Y(at(mo, span)) - 7)}" text-anchor="end">Minimums only → ${money(mo.r.totalInterest)}</text>`; }
    box.innerHTML = s + '</svg>';
    hover(box, { W, P, H, count: span + 1, xAt: k => X(k), html: k => `<span class="muted">Interest paid by ${ymLabel(start + k)}</span>${[...series].sort((a, b) => at(a, k) - at(b, k)).map(o => tipRow(o.s.name + (o.s.id === current ? ' (yours)' : ''), money(at(o, k)))).join('')}` });
  };
  draw(); return draw;
}

// Plan: total interest at each extra monthly amount. Clicking picks that amount.
export function extraCurveChart(box, points, current, onPick) {
  const draw = () => {
    const W = Math.max(280, box.clientWidth || 600), H = 200, P = { l: 48, r: 14, t: 18, b: 26 };
    const max = points[points.length - 1].extra, top = niceMax(Math.max(...points.map(p => p.interest)) * 1.05);
    const X = a => P.l + a / max * (W - P.l - P.r), Y = v => P.t + (1 - v / top) * (H - P.t - P.b);
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${X(p.extra).toFixed(1)},${Y(p.interest).toFixed(1)}`).join('');
    const curPt = points.reduce((b, p) => Math.abs(p.extra - current) < Math.abs(b.extra - current) ? p : b, points[0]);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Total interest at each extra monthly payment"><defs><linearGradient id="exf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--accent);stop-opacity:.28"/><stop offset="1" style="stop-color:var(--accent);stop-opacity:0"/></linearGradient></defs>` + gridY(top, Y, W, P);
    for (let i = 0; i <= 4; i++) s += `<text x="${X(max * i / 4)}" y="${H - 6}" text-anchor="middle">+${kfmt(max * i / 4)}</text>`;
    s += `<path d="${line}L${X(max)},${Y(0)}L${X(0)},${Y(0)}Z" fill="url(#exf)"/><path d="${line}" fill="none" style="stroke:var(--accent)" stroke-width="3" stroke-linejoin="round"/>
      <circle cx="${X(Math.min(current, max))}" cy="${Y(curPt.interest)}" r="6" style="fill:var(--accent);stroke:var(--glass-strong)" stroke-width="2.5"/>
      <text x="${X(Math.min(current, max)) + (X(current) > W * 0.65 ? -10 : 10)}" y="${Y(curPt.interest) - 10}" text-anchor="${X(current) > W * 0.65 ? 'end' : 'start'}" style="fill:var(--ink);font-weight:650">You: +${money(current)}/mo</text>`;
    box.innerHTML = s + `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(0)}" y2="${Y(0)}" style="stroke:var(--ink-3)"/></svg>`;
    hover(box, { W, P, H, count: points.length, xAt: i => X(points[i].extra), onClick: i => onPick(points[i].extra), html: i => {
      const p = points[i];
      return `<span class="muted">+${money(p.extra)} a month</span>${tipRow('Total interest', money(p.interest))}${tipRow('Saved vs. +$0', money(points[0].interest - p.interest))}${tipRow('Debt-free', p.done ? ymLabel(p.payoffM) : 'Not yet')}<span class="muted small">Tap to use this amount</span>`;
    } });
  };
  draw(); return draw;
}

// Money: each month's income split into costs, loans and savings; shortfalls dip below zero.
export function cashflowBars(box, months, { grad = null } = {}) {
  const SER = [{ k: 'costs', name: 'Costs', color: 'var(--s-other)' }, { k: 'loans', name: 'To loans', color: 'var(--accent)' }, { k: 'saved', name: 'Saved', color: 'var(--s1)' }];
  const draw = () => {
    const W = Math.max(280, box.clientWidth || 600), H = W < 560 ? 190 : 230, P = { l: 48, r: 6, t: 12, b: 24 };
    const top = niceMax(Math.max(1, ...months.map(d => d.costs + d.loans + d.saved)));
    const shortMax = Math.max(0, ...months.map(d => d.short)), bot = shortMax > 0.5 ? niceMax(shortMax) : 0;
    const m0 = months[0].m, bw = (W - P.l - P.r) / months.length, X = m => P.l + (m - m0) * bw;
    const Y = v => P.t + (top - v) / (top + bot) * (H - P.t - P.b);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly income split into costs, loan payments and savings">` + gridY(top, Y, W, P, bot) + yearTicks(m0, m0 + months.length, X, H);
    months.forEach(d => {
      const x = X(d.m) + 1, w = Math.max(1, bw - 2); let acc = 0;
      for (const sr of SER) { const v = d[sr.k]; if (v < 0.5) continue; s += `<rect x="${x.toFixed(1)}" y="${Y(acc + v).toFixed(1)}" width="${w.toFixed(1)}" height="${(Y(acc) - Y(acc + v)).toFixed(1)}" fill="${sr.color}" rx="${Math.min(3, w / 3)}"/>`; acc += v; }
      if (d.short > 0.5) s += `<rect x="${x.toFixed(1)}" y="${Y(0).toFixed(1)}" width="${w.toFixed(1)}" height="${(Y(-d.short) - Y(0)).toFixed(1)}" style="fill:var(--crit)" rx="${Math.min(3, w / 3)}"/>`;
    });
    if (grad != null && grad >= m0 && grad < m0 + months.length) s += gradLine(X(grad + 1), P, H);
    box.innerHTML = s + `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(0)}" y2="${Y(0)}" style="stroke:var(--ink-3)"/></svg>`;
    hover(box, { W, P, H, count: months.length, xAt: i => X(months[i].m) + bw / 2, html: i => {
      const d = months[i];
      return `<span class="muted">${ymLabel(d.m)}</span>${d.inc.map(s => tipRow(s.label || 'Income', `+${money(s.monthly)}`)).join('') || tipRow('No income', '$0')}${d.exp.map(s => tipRow(s.label || 'Costs', `−${money(+s.amount || 0)}`)).join('')}
        <div class="trow total"><span>To loans</span><b class="num">${money(d.loansAll)}</b></div>${tipRow('Saved', money(d.saved), 'var(--s1)')}${d.short > 0.5 ? `<div class="trow"><span style="color:var(--crit)">Short</span><b class="num">−${money(d.short)}</b></div>` : ''}`;
    } });
  };
  draw(); return { draw, legend: SER };
}

// A y-scale that can go below zero, with gridlines at nice steps on both sides.
function signedScale(lo, hi, H, P) {
  const top = niceMax(Math.max(1, hi) * 1.05), bot = lo < 0 ? niceMax(-lo * 1.05) : 0;
  return { top, bot, Y: v => P.t + (top - v) / (top + bot) * (H - P.t - P.b) };
}
const pathOf = (pts, X, Y, key) => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.m).toFixed(1)},${Y(p[key]).toFixed(1)}`).join('');

// Today: cash month by month (the plan), a bad-stretch line, the cushion, planned costs, and real check-ins.
export function runwayChart(box, { stability: st, checkins = [], start }) {
  const n = st.normal.view, b = st.bad.view;
  if (!n.length) { box.innerHTML = ''; return () => {}; }
  const pts = [{ m: start, cash: st.cash, bad: st.cash, target: st.target, planned: [] },
    // bad stretch: lower income and higher costs, with extra still going out only when the cushion allows
    ...n.map((x, i) => ({ m: x.m + 1, cash: x.cash, bad: b[i] ? b[i].cash : x.cash, target: x.target, x, planned: st.normal.upcoming.filter(p => p.month === `${Math.floor(x.m / 12)}-${String(x.m % 12 + 1).padStart(2, '0')}`) }))];
  const real = checkins.map(c => { const [y, mo, d] = c.date.split('-').map(Number); return { m: y * 12 + mo - 1 + (d - 1) / 30, v: c.real }; }).filter(p => p.m >= start - 3);
  const draw = () => {
    const W = Math.max(280, box.clientWidth || 600), H = W < 560 ? 200 : 240, P = { l: 48, r: 10, t: 14, b: 24 };
    const m0 = Math.min(start, ...real.map(p => Math.floor(p.m))), m1 = pts[pts.length - 1].m;
    const all = [...pts.flatMap(p => [p.cash, p.bad, p.target]), ...real.map(p => p.v)];
    const { top, bot, Y } = signedScale(Math.min(0, ...all), Math.max(...all), H, P);
    const X = m => P.l + (m - m0) / Math.max(1, m1 - m0) * (W - P.l - P.r);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Projected bank cash with your cushion"><defs><linearGradient id="rwf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--accent);stop-opacity:.3"/><stop offset="1" style="stop-color:var(--accent);stop-opacity:0"/></linearGradient></defs>`;
    s += gridY(top, Y, W, P, bot);
    for (let m = m0; m <= m1; m += Math.max(1, Math.round((m1 - m0) / 6))) s += `<text x="${X(m)}" y="${H - 6}" text-anchor="middle">${short(m)}</text>`;
    // the gap between the plan and a bad stretch, then the plan's cash as a filled area
    s += `<path d="${pathOf(pts, X, Y, 'cash')}${[...pts].reverse().map(p => `L${X(p.m).toFixed(1)},${Y(p.bad).toFixed(1)}`).join('')}Z" style="fill:var(--warn);opacity:.13"/>`;
    s += `<path d="${pathOf(pts, X, Y, 'cash')}L${X(m1)},${Y(0)}L${X(start)},${Y(0)}Z" fill="url(#rwf)"/>`;
    s += `<path d="${pts.map((p, i) => `${i ? 'H' + X(p.m).toFixed(1) + 'V' : 'M' + X(p.m).toFixed(1) + ','}${Y(p.target).toFixed(1)}`).join('')}" fill="none" style="stroke:var(--crit)" stroke-width="1.6" stroke-dasharray="5 4"/>`;
    s += `<path d="${pathOf(pts, X, Y, 'bad')}" fill="none" style="stroke:var(--warn)" stroke-width="1.8" stroke-dasharray="2 4" stroke-linecap="round"/>`;
    s += `<path d="${pathOf(pts, X, Y, 'cash')}" fill="none" style="stroke:var(--accent)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`;
    // planned costs: a dotted line and the amount near the top (names are in the readout); close labels alternate rows
    let lastX = -Infinity, row = 0;
    for (const p of pts) if (p.planned.length) {
      const x = X(p.m), amt = p.planned.reduce((t, q) => t + (+q.amount || 0), 0);
      row = x - lastX < 40 ? 1 - row : 0; lastX = x;
      s += `<line x1="${x}" x2="${x}" y1="${P.t}" y2="${H - P.b}" style="stroke:var(--ink-3)" stroke-dasharray="1 3"/><text x="${x + 4}" y="${P.t + 8 + row * 12}" style="font-weight:650">−${kfmt(amt)}</text>`;
    }
    const low = pts.reduce((a, p) => p.cash - p.target < a.cash - a.target ? p : a, pts[0]);
    s += `<circle cx="${X(low.m)}" cy="${Y(low.cash)}" r="5" style="fill:${low.cash < low.target - 0.5 ? 'var(--crit)' : 'var(--accent)'};stroke:var(--glass-strong)" stroke-width="2"/>`;
    for (const p of real) s += `<circle cx="${X(p.m)}" cy="${Y(p.v)}" r="4.5" style="fill:var(--glass-strong);stroke:var(--ink)" stroke-width="2"/>`;
    box.innerHTML = s + `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(0)}" y2="${Y(0)}" style="stroke:var(--ink-3)"/></svg>`;
    hover(box, { W, P, H, count: pts.length, xAt: i => X(pts[i].m), html: i => {
      const p = pts[i], x = p.x;
      return `<span class="muted">${i ? `End of ${ymLabel(p.m - 1)}` : 'Now'}</span>${tipRow('Cash as planned', money(p.cash), 'var(--accent)')}${tipRow('Bad stretch', money(p.bad), 'var(--warn)')}${tipRow('Cushion', money(p.target), 'var(--crit)')}
        ${x ? `${tipRow('Came in', `+${money(x.income)}`)}${tipRow('Costs', `−${money(x.costs + x.oneTime)}`)}${x.mins + x.send > 0.5 ? tipRow('To loans', `−${money(x.mins + x.send)}`) : ''}` : ''}${p.planned.map(q => tipRow(q.label, `−${money(+q.amount)}`)).join('')}`;
    } });
  };
  draw(); return draw;
}

// Spending: what you really spent and earned each month next to the plan (outlined bars and tick marks are the plan).
export function actualPlanBars(box, months) {
  const draw = () => {
    if (!months.length) { box.innerHTML = ''; return; }
    const W = Math.max(280, box.clientWidth || 600), H = 190, P = { l: 48, r: 8, t: 12, b: 24 };
    const top = niceMax(Math.max(1, ...months.flatMap(d => [d.in, d.spent, d.planIn, d.planSpent])) * 1.05);
    const slot = (W - P.l - P.r) / Math.max(months.length, 3), bw = Math.min(26, slot / 2.8), Y = v => P.t + (1 - v / top) * (H - P.t - P.b);
    const cx = i => P.l + slot * (i + 0.5);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Actual spending and income against the plan">` + gridY(top, Y, W, P);
    months.forEach((d, i) => {
      const x = cx(i);
      s += `<rect x="${x - bw - 2}" y="${Y(d.planSpent)}" width="${bw}" height="${Y(0) - Y(d.planSpent)}" fill="none" style="stroke:var(--ink-3)" stroke-dasharray="3 3" rx="3"/>`;
      s += `<rect x="${x - bw - 2}" y="${Y(d.spent)}" width="${bw}" height="${Y(0) - Y(d.spent)}" style="fill:${d.spent > d.planSpent + 1 && !d.partial ? 'var(--crit)' : 'var(--s1)'}" rx="3"/>`;
      s += `<rect x="${x + 2}" y="${Y(d.in)}" width="${bw}" height="${Y(0) - Y(d.in)}" style="fill:var(--good)" rx="3"/>`;
      s += `<line x1="${x + 2}" x2="${x + 2 + bw}" y1="${Y(d.planIn)}" y2="${Y(d.planIn)}" style="stroke:var(--ink)" stroke-width="2"/>`;
      const [yy, mm] = d.month.split('-').map(Number);
      s += `<text x="${x}" y="${H - 6}" text-anchor="middle">${short(yy * 12 + mm - 1)}${d.partial ? '*' : ''}</text>`;
    });
    box.innerHTML = s + `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(0)}" y2="${Y(0)}" style="stroke:var(--ink-3)"/></svg>`;
    hover(box, { W, P, H, count: months.length, xAt: cx, html: i => {
      const d = months[i], [yy, mm] = d.month.split('-').map(Number);
      return `<span class="muted">${ymLabel(yy * 12 + mm - 1)}${d.partial ? ' so far' : ''}</span>${tipRow('Spent', money(d.spent), 'var(--s1)')}${tipRow('Plan', money(d.planSpent))}${tipRow('Came in', money(d.in), 'var(--good)')}${tipRow('Plan', money(d.planIn))}
        ${d.loans > 0.5 ? tipRow('Loan payments', money(d.loans)) : ''}${d.planned > 0.5 ? tipRow('Planned costs', money(d.planned)) : ''}`;
    } });
  };
  draw(); return draw;
}

// Wealth: net worth climbing and total owed falling. Solid = real, dashed = projected.
export function netWorthChart(box, { past, future, payoffM }) {
  const draw = () => {
    const W = Math.max(280, box.clientWidth || 600), H = W < 560 ? 200 : 240, P = { l: 52, r: 10, t: 14, b: 24 };
    const pts = [...past, ...future], m0 = pts[0].m, m1 = pts[pts.length - 1].m;
    const { top, bot, Y } = signedScale(Math.min(0, ...pts.map(p => p.net)), Math.max(...pts.map(p => Math.max(p.owed, p.net))), H, P);
    const X = m => P.l + (m - m0) / Math.max(1, m1 - m0) * (W - P.l - P.r);
    const proj = [past[past.length - 1], ...future];
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Net worth and total owed over time">` + gridY(top, Y, W, P, bot) + yearTicks(m0, m1, X, H);
    s += `<path d="${pathOf(proj, X, Y, 'owed')}" fill="none" style="stroke:var(--s2)" stroke-width="2.2" stroke-dasharray="6 5"/>`;
    s += `<path d="${pathOf(proj, X, Y, 'net')}" fill="none" style="stroke:var(--accent)" stroke-width="2.6" stroke-dasharray="6 5"/>`;
    if (past.length > 1) s += `<path d="${pathOf(past, X, Y, 'owed')}" fill="none" style="stroke:var(--s2)" stroke-width="3"/><path d="${pathOf(past, X, Y, 'net')}" fill="none" style="stroke:var(--accent)" stroke-width="3.2"/>`;
    const now = past[past.length - 1];
    s += `<circle cx="${X(now.m)}" cy="${Y(now.net)}" r="5" style="fill:var(--accent);stroke:var(--glass-strong)" stroke-width="2"/><circle cx="${X(now.m)}" cy="${Y(now.owed)}" r="5" style="fill:var(--s2);stroke:var(--glass-strong)" stroke-width="2"/>`;
    const cross = future.find(p => p.net >= 0);
    if (cross && now.net < 0) s += `<circle cx="${X(cross.m)}" cy="${Y(0)}" r="5" style="fill:var(--good);stroke:var(--glass-strong)" stroke-width="2"/><text x="${X(cross.m)}" y="${Y(0) - 9}" text-anchor="middle" style="fill:var(--ink);font-weight:650">$0 · ${short(cross.m)}</text>`;
    if (payoffM != null) s += `<text x="${Math.min(W - P.r, X(payoffM + 1))}" y="${Y(0) + 15}" text-anchor="end">Debt-free ${short(payoffM)}</text>`;
    box.innerHTML = s + `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(0)}" y2="${Y(0)}" style="stroke:var(--ink-3)"/></svg>`;
    hover(box, { W, P, H, count: pts.length, xAt: i => X(pts[i].m), html: i => {
      const p = pts[i];
      return `<span class="muted">${i < past.length ? (p.real ? (i === past.length - 1 ? 'Now' : `End of ${ymLabel(p.m)}`) : '') : `Start of ${ymLabel(p.m)} · projected`}</span>${tipRow('Net worth', money(p.net), 'var(--accent)')}${tipRow('Owed on loans', money(p.owed), 'var(--s2)')}${tipRow('Assets', money(p.assets))}`;
    } });
  };
  draw(); return draw;
}

export { short as shortMonth };
