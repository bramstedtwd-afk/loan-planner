// Plan: pick a strategy, try extra payments, see the whole timeline, and compare every option.
import { ym, ymLabel, MON, STRATEGIES, simulate, simulateAll, interestMoves, applyMove, extraCurve, yearlySummary, migratePlan } from '../engine.js';
import { money, dur, esc, pct } from '../format.js';
import { stackedBalance, paymentBars, raceLines, extraCurveChart, legend } from '../charts.js';
import { formSheet } from '../ui/form-sheet.js';

export function renderPlan(view, ctx) {
  const { data, start, colorOf, save, syncPill } = ctx;
  const plan = data.plan, loans = data.loans;
  const st = STRATEGIES.some(s => s.id === plan.strategy) ? plan.strategy : 'avalanche';
  const opts = { start };
  const all = simulateAll(loans, plan, opts), r = all[st], base = all.minimum;
  const grad = ym(plan.gradMonth);
  const moves = interestMoves(loans, plan, st, opts);
  const extra = +plan.extraMonthly || 0;
  const curveMax = Math.max(1000, Math.ceil(extra * 1.5 / 100) * 100);
  const curve = extraCurve(loans, plan, st, { ...opts, max: curveMax, steps: 20 });
  const best = STRATEGIES.filter(s => all[s.id].done).reduce((b, s) => !b || all[s.id].totalInterest < all[b].totalInterest - 0.5 ? s.id : b, null);
  const stratName = id => STRATEGIES.find(s => s.id === id).name;
  const customIds = (() => { const ids = (plan.customOrder || []).filter(id => loans.some(l => l.id === id)); for (const l of loans) if (!ids.includes(l.id)) ids.push(l.id); return ids; })();
  const summaryHtml = res => {
    const saved = base.totalInterest - res.totalInterest;
    return `<div class="tile"><span>Debt-free</span><b class="num">${res.done ? ymLabel(res.payoffM) : 'Not yet'}</b></div>
      <div class="tile"><span>Interest you’ll pay</span><b class="num">${money(res.totalInterest)}</b></div>
      <div class="tile accent"><span>Saved vs. minimums</span><b class="num">${st === 'minimum' ? '—' : money(saved)}</b></div>
      <div class="tile"><span>Total you’ll pay</span><b class="num">${money(res.totalPaid)}</b></div>`;
  };
  const years = yearlySummary(r.rows);
  const sc = [...(data.scenarios || [])].sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
  const maxInt = Math.max(...STRATEGIES.map(s => all[s.id].totalInterest), 1);

  view.innerHTML = `
    <header class="topbar"><div><h1>Plan</h1></div>${syncPill}</header>

    <section class="card glass rise">
      <div class="tiles" data-summary>${summaryHtml(r)}</div>
      ${r.shortfalls && st !== 'minimum' ? `<p class="err" style="margin-top:12px">Your income doesn’t cover the minimums in ${r.shortfalls} month${r.shortfalls > 1 ? 's' : ''}, starting ${ymLabel(r.firstShortfall)}. The plan assumes you pay them anyway.</p>` : ''}
    </section>

    <section class="card glass rise">
      <div class="card-h"><h2>Strategy</h2>${best && best !== st ? `<button class="badge warn" type="button" data-use="${best}">${stratName(best)} is cheaper · switch</button>` : best === st ? '<span class="badge">Cheapest option</span>' : ''}</div>
      <div class="seg scroll" role="radiogroup" aria-label="Payoff strategy">${STRATEGIES.map(s => `<label><input type="radio" name="strategy" value="${s.id}" ${s.id === st ? 'checked' : ''}><span>${s.name}</span></label>`).join('')}</div>
      <p class="muted small" style="margin:10px 0 4px">${esc(STRATEGIES.find(s => s.id === st).desc)}</p>
      ${st === 'custom' ? `<div class="order">${customIds.map((id, i) => { const l = loans.find(x => x.id === id); return `<div class="order-item"><span class="dotc" style="background:${colorOf(id)}"></span><span class="nm">${i + 1}. ${esc(l.name)} <span class="muted small">${pct(l.rate)}</span></span><button type="button" data-mv="${i}" data-d="-1" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" data-mv="${i}" data-d="1" aria-label="Move down" ${i === customIds.length - 1 ? 'disabled' : ''}>↓</button></div>`; }).join('')}</div>` : ''}
      <div class="slider" style="margin-top:12px">
        <div class="top"><b>Extra each month</b><output data-extra-out>+${money(extra)}</output></div>
        <input type="range" min="0" max="${curveMax}" step="25" value="${extra}" data-extra aria-label="Extra payment each month">
        <small>On top of your earnings plan. Drag to preview; it saves when you let go.</small>
      </div>
      <label class="switch"><span class="name"><b>Autopay discount</b><small>Most servicers take 0.25% off your rate with autopay</small></span><input type="checkbox" data-autopay ${plan.autopay ? 'checked' : ''}></label>
      <label class="switch"><span class="name"><b>What if I refinance private loans?</b><small>${plan.refi?.on ? `Private loans modeled at ${pct(plan.refi.rate)}` : 'Model a lower rate on your private loans'}</small></span><input type="checkbox" data-refi ${plan.refi?.on ? 'checked' : ''}></label>
      ${plan.refi?.on ? `<div class="field" style="max-width:220px;margin-top:4px"><span>Refinanced rate</span><span class="affix"><input type="number" inputmode="decimal" step="0.05" min="0" max="30" value="${plan.refi.rate}" data-refi-rate aria-label="Refinanced rate"><b>%</b></span></div>` : ''}
    </section>

    <section class="card glass rise">
      <div class="card-h"><h2>Balance over time</h2><span class="muted small">${r.done ? `${ymLabel(r.start)} – ${ymLabel(r.payoffM)}` : ''}</span></div>
      <div class="legend">${legend([...loans.slice(0, 8).map(l => ({ name: l.name, color: colorOf(l.id) })), ...(st !== 'minimum' ? [{ name: 'Minimums only (total)', dash: true }] : [])])}</div>
      <div class="chartbox" data-balance></div>
      ${st !== 'minimum' && r.done ? `<p class="section-note">Paying only the minimums, you’d still owe ${money(base.rows.find(x => x.m === r.payoffM)?.total ?? base.initTotal)} when this plan finishes${base.done ? `, and wouldn’t be done until ${ymLabel(base.payoffM)}` : ''}.</p>` : ''}
    </section>

    <section class="card glass rise moves">
      <div class="card-h"><h2>Fastest ways to cut interest</h2><span class="muted small">Biggest savings first</span></div>
      <div class="rows">${moves.length ? moves.map((m, i) => `
        <div class="row"><span class="rank">${i + 1}</span><div class="name"><b>${esc(m.title)}</b><small>${esc(m.detail)}</small></div>
          <div class="right"><span class="save num">${money(m.saved)}</span><small class="muted">${m.result.done ? ymLabel(m.result.payoffM) : 'Not yet'}${m.sooner > 0 ? ` · ${dur(m.sooner)} sooner` : ''}</small><button class="btn soft" type="button" data-move="${i}">Apply</button></div></div>`).join('')
        : '<p class="muted" style="margin:0">Your plan already covers every move this app can test.</p>'}</div>
    </section>

    <section class="card glass rise">
      <div class="card-h"><h2>What paying more buys you</h2><span class="muted small">Tap an amount or the chart</span></div>
      <div class="chips">${[100, 250, 500, 1000].map(a => { const p = curve.find(c => c.extra === a) || (() => { const x = simulate(loans, { ...plan, extraMonthly: a }, st === 'minimum' ? 'avalanche' : st, opts); return { interest: x.totalInterest, done: x.done, payoffM: x.payoffM, months: x.months }; })();
        return `<button class="chip-b" type="button" data-setextra="${a}" aria-pressed="${extra === a}"><span>+${money(a)} a month</span><b>saves ${money(curve[0].interest - p.interest)}</b><small>${p.done ? `Debt-free ${ymLabel(p.payoffM)}` : 'Not paid off'}${curve[0].done && p.done && curve[0].months - p.months > 0 ? ` · ${dur(curve[0].months - p.months)} sooner` : ''}</small></button>`; }).join('')}</div>
      <div class="chartbox" data-curve></div>
    </section>

    <div class="board" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr))">
      <section class="card glass rise">
        <div class="card-h"><h2>Monthly payments</h2><span class="muted small">${r.rows.length ? `Peak ${money(Math.max(...r.rows.map(x => x.paid)))}` : ''}</span></div>
        <div class="legend">${legend(loans.filter(l => r.rows.some(x => x.pay[l.id])).slice(0, 8).map(l => ({ name: l.name, color: colorOf(l.id) })))}</div>
        <div class="chartbox" data-pay></div>
      </section>
      <section class="card glass rise">
        <div class="card-h"><h2>Interest piling up</h2><span class="muted small">By strategy</span></div>
        <div class="legend">${legend([{ name: `${stratName(st)} (yours)`, color: 'var(--accent)' }, { name: 'Other strategies', color: 'var(--ink-3)' }, ...(st !== 'minimum' ? [{ name: 'Minimums only', dash: true }] : [])])}</div>
        <div class="chartbox" data-race></div>
      </section>
    </div>

    <section class="card glass rise">
      <div class="card-h"><h2>Compare strategies</h2><span class="muted small">Same income, different order</span></div>
      <div class="cmp">${STRATEGIES.map(s => { const x = all[s.id], d = base.totalInterest - x.totalInterest;
        return `<button class="cmp-row ${s.id === st ? 'on' : ''}" type="button" data-use="${s.id}" aria-pressed="${s.id === st}"><span class="nm">${s.name}${s.id === best ? ' <span class="tag fed">Cheapest</span>' : ''}</span>
          <span class="bar2"><i style="width:${(x.totalInterest / maxInt * 100).toFixed(1)}%"></i></span>
          <span class="val"><b>${money(x.totalInterest)}</b><small>${x.done ? ymLabel(x.payoffM) : 'Never'}${s.id !== 'minimum' && d > 0.5 ? ` · saves ${money(d)}` : ''}</small></span></button>`; }).join('')}</div>
    </section>

    <section class="card glass rise">
      <div class="card-h"><h2>Full timeline</h2><span class="muted small">${r.rows.length} months · tap a year</span></div>
      <div class="yr-head"><span>Year</span><span>Paid</span><span>Interest</span><span>Owed at end</span></div>
      ${years.map((y, yi) => `<details class="yr" ${yi === 0 ? 'open' : ''}><summary><span>${y.year}</span><span>${money(y.paid)}</span><span>${money(y.interestPaid)}</span><span>${money(y.endBalance)}</span></summary>
        ${y.rows.map(x => { const who = loans.filter(l => x.pay[l.id] > 0.5).sort((a, b) => x.pay[b.id] - x.pay[a.id]);
          return `<div class="mrow"><span>${MON[x.m % 12]}${x.lump ? ' <span class="tag now">+lump</span>' : ''}</span><span class="who">${who.length ? who.slice(0, 2).map(l => `<i style="background:${colorOf(l.id)}"></i>${esc(l.name.split(' · ')[0])} ${money(x.pay[l.id])}`).join(' · ') + (who.length > 2 ? ` · +${who.length - 2} more` : '') : 'Nothing due'}</span><b>${money(x.paid)}</b></div>`; }).join('')}</details>`).join('')}
      ${r.done ? '' : `<p class="err" style="margin-top:10px">Stops at 40 years with ${money(r.rows[r.rows.length - 1]?.total || 0)} still owed.</p>`}
    </section>

    <section class="card glass rise">
      <div class="card-h"><h2>Saved scenarios</h2><button class="btn soft" type="button" data-save-scn style="height:36px;font-size:13.5px">Save this plan</button></div>
      <div class="rows">${sc.length ? sc.map(s => { const p = migratePlan(s.plan || {}); const now = simulate(loans, p, p.strategy, opts);
        return `<div class="row"><div class="name"><b>${esc(s.name)}</b><small>${stratName(p.strategy) || ''} · ${p.incomes.length} income source${p.incomes.length === 1 ? '' : 's'} · +${money(+p.extraMonthly || 0)}/mo extra · saved ${esc((s.savedAt || '').slice(0, 10))}</small></div>
          <div class="right"><span class="amt num">${now.done ? ymLabel(now.payoffM) : 'Never'}</span><small class="muted">${money(now.totalInterest)} interest</small>
          <span style="display:flex;gap:4px"><button class="btn soft" type="button" data-load="${esc(s.id)}" style="height:32px;font-size:13px;padding:0 10px">Load</button><button class="btn soft danger" type="button" data-del="${esc(s.id)}" style="height:32px;font-size:13px;padding:0 10px">Delete</button></span></div></div>`; }).join('')
        : '<p class="muted small" style="margin:0">Save your plan before trying a different job offer or budget, then compare here. Each scenario is re-run against your current loans.</p>'}</div>
    </section>`;

  // charts
  const draws = [
    stackedBalance(view.querySelector('[data-balance]'), r, st === 'minimum' ? null : base, loans, colorOf, { grad }),
    paymentBars(view.querySelector('[data-pay]'), r, loans, colorOf, { grad }),
    raceLines(view.querySelector('[data-race]'), all, st, STRATEGIES),
    extraCurveChart(view.querySelector('[data-curve]'), curve, extra, a => setPlan({ extraMonthly: a }, `Extra set to ${money(a)} a month`)),
  ];

  // controls
  function setPlan(patch, message, toastMsg = message) { save({ ...data, plan: { ...plan, ...patch } }, message, toastMsg); }
  view.querySelectorAll('input[name="strategy"]').forEach(i => i.addEventListener('change', () => setPlan({ strategy: i.value }, `Strategy set to ${stratName(i.value)}`)));
  view.querySelectorAll('[data-use]').forEach(b => b.addEventListener('click', () => { if (b.dataset.use !== st) setPlan({ strategy: b.dataset.use }, `Strategy set to ${stratName(b.dataset.use)}`); }));
  view.querySelectorAll('[data-mv]').forEach(b => b.addEventListener('click', () => {
    const ids = [...customIds], i = +b.dataset.mv, j = i + +b.dataset.d; [ids[i], ids[j]] = [ids[j], ids[i]];
    setPlan({ customOrder: ids }, `Custom order: ${loans.find(l => l.id === ids[0]).name} first`, 'Order updated');
  }));
  view.querySelector('[data-autopay]').addEventListener('change', e => setPlan({ autopay: e.target.checked }, `Autopay discount ${e.target.checked ? 'on' : 'off'}`));
  view.querySelector('[data-refi]').addEventListener('change', e => setPlan({ refi: { ...(plan.refi || { rate: 5.5 }), on: e.target.checked } }, `Refinance what-if ${e.target.checked ? 'on' : 'off'}`));
  view.querySelector('[data-refi-rate]')?.addEventListener('change', e => { const v = +e.target.value; if (v >= 0 && v <= 30) setPlan({ refi: { ...plan.refi, rate: v } }, `Refinance what-if at ${pct(v)}`); });

  // extra slider: live preview of the summary and balance chart; one save on release
  const slider = view.querySelector('[data-extra]'), out = view.querySelector('[data-extra-out]'), summary = view.querySelector('[data-summary]');
  const paint = () => slider.style.setProperty('--p', `${(slider.value / curveMax * 100).toFixed(1)}%`);
  paint();
  let t;
  slider.addEventListener('input', () => {
    paint(); out.textContent = `+${money(+slider.value)}`;
    clearTimeout(t); t = setTimeout(() => {
      const draft = simulate(loans, { ...plan, extraMonthly: +slider.value }, st, opts);
      summary.innerHTML = summaryHtml(draft);
      draws[0] = stackedBalance(view.querySelector('[data-balance]'), draft, st === 'minimum' ? null : base, loans, colorOf, { grad });
    }, 40);
  });
  slider.addEventListener('change', () => { if (+slider.value !== extra) setPlan({ extraMonthly: +slider.value }, `Extra set to ${money(+slider.value)} a month`); });
  view.querySelectorAll('[data-setextra]').forEach(b => b.addEventListener('click', () => {
    const a = +b.dataset.setextra === extra ? 0 : +b.dataset.setextra;
    setPlan({ extraMonthly: a }, `Extra set to ${money(a)} a month`);
  }));
  view.querySelectorAll('[data-move]').forEach(b => b.addEventListener('click', () => {
    const m = moves[+b.dataset.move];
    save({ ...data, plan: applyMove(plan, m.apply, opts) }, `Applied: ${m.title}`, `${m.title} applied`);
  }));

  // scenarios
  view.querySelector('[data-save-scn]').addEventListener('click', () => formSheet({
    title: 'Save this plan', intro: `Debt-free ${r.done ? ymLabel(r.payoffM) : 'not yet'} · ${money(r.totalInterest)} interest`,
    fields: [{ name: 'name', label: 'Name', required: true, maxlength: 60, placeholder: 'Chicago offer, $1,150/wk' }],
    submitLabel: 'Save scenario',
    onSubmit: v => {
      const s = { id: `s${Date.now().toString(36)}`, name: v.name, plan: JSON.parse(JSON.stringify(plan)), payoffM: r.payoffM, totalInterest: Math.round(r.totalInterest), savedAt: new Date().toISOString() };
      save({ ...data, scenarios: [...(data.scenarios || []), s] }, `Saved scenario: ${v.name}`, `Saved “${v.name}”`);
    },
  }));
  view.querySelectorAll('[data-load]').forEach(b => b.addEventListener('click', () => {
    const s = data.scenarios.find(x => x.id === b.dataset.load);
    save({ ...data, plan: migratePlan(JSON.parse(JSON.stringify(s.plan))) }, `Loaded scenario: ${s.name}`, `Loaded “${s.name}”`);
  }));
  view.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Confirm'; return; }
    const s = data.scenarios.find(x => x.id === b.dataset.del);
    save({ ...data, scenarios: data.scenarios.filter(x => x.id !== s.id) }, `Deleted scenario: ${s.name}`, `Deleted “${s.name}”`);
  }));

  return { redraw: () => draws.forEach(d => d?.()) };
}
