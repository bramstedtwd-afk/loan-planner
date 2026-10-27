// Plan: the best route to debt-free given your income, costs and cash, why it wins, and what would change it.
import { ym, ymLabel, MON, STRATEGIES, simulate, simulateAll, interestMoves, applyMove, extraCurve, yearlySummary, migratePlan, cashFlow } from '../engine.js';
import { recommendRoute, effectivePlan } from '../wealth.js';
import { money, dur, esc, pct } from '../format.js';
import { stackedBalance, paymentBars, raceLines, extraCurveChart, legend } from '../charts.js';
import { formSheet } from '../ui/form-sheet.js';
import { header } from '../ui/layout.js';

const VIEWS = [['balance', 'Balance'], ['payments', 'Payments'], ['interest', 'Interest'], ['extra', 'Extra']];
let chartView = 'balance'; // remembered while the app is open

export function renderPlan(view, ctx) {
  const { data, start, colorOf, save } = ctx;
  const plan = data.plan, loans = data.loans, opts = { start };
  const rec = recommendRoute(data, opts);
  const st = STRATEGIES.some(s => s.id === plan.strategy) ? plan.strategy : 'avalanche';
  const ep = effectivePlan(data, start); // the stored plan as simulated, with spare cash when it's on
  const all = simulateAll(loans, ep, opts), r = all[st], base = all.minimum;
  const best = rec.result, name = id => STRATEGIES.find(s => s.id === id)?.name || id;
  const override = plan.strategyOverride && plan.strategyOverride !== rec.best ? plan.strategyOverride : null;
  const onRoute = Math.abs(r.totalInterest - best.totalInterest) < 1 && r.payoffM === best.payoffM;
  const grad = ym(plan.gradMonth);
  const cf = cashFlow(plan, start);
  const focus = loans.find(l => l.id === rec.focusLoanId);
  const nextUp = rec.order.filter(o => o.id !== rec.focusLoanId)[0];
  const ef = rec.emergency, hasCash = (data.accounts || []).some(a => a.kind === 'bank');

  const steps = [
    focus ? { t: `${esc(focus.name)} first`, s: `${pct(focus.rate)}${+focus.rate >= Math.max(...loans.map(l => +l.rate)) ? ', your highest rate' : ''}. Extra money goes here until it’s gone${nextUp ? `, then to ${esc(nextUp.name)}` : ''}.` } : null,
    { t: `Send ${money(rec.monthly)} a month`, s: cf.inc.length ? `Everything left after costs: ${money(cf.income)} in − ${money(cf.costs)} costs.` : 'Add your income and costs on the Wealth tab to size this.' },
    rec.lumpNow > 0 ? { t: `Put ${money(rec.lumpNow)} of savings in now`, s: `${plan.useSpareCash ? 'Part of your plan this month. When you pay it, log it and take it out of your bank balance. ' : ''}You keep ${money(ef.target)} (${ef.months} months of costs) as your emergency fund.` }
      : hasCash ? { t: 'Keep your savings where they are', s: ef.target ? `Your ${money(ef.cash)} in cash is ${ef.funded ? 'at' : 'under'} your ${money(ef.target)} emergency fund${ef.funded ? ', with nothing extra to spare yet' : ''}.` : 'Add monthly costs to size your emergency fund.' }
      : { t: 'Add your bank balance', s: 'Cash above your emergency fund could go in now. <a href="#accounts">Add it on the Wealth tab</a>.', html: true },
  ].filter(Boolean);

  const curveMax = Math.max(1000, Math.ceil((+plan.extraMonthly || 0) * 1.5 / 100) * 100);
  const moves = interestMoves(loans, ep, st, opts);
  const years = yearlySummary(r.rows);
  const sc = [...(data.scenarios || [])].sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));

  view.innerHTML = `
    ${header({ title: 'Plan' })}
    ${override ? `<div class="banner glass"><p>You’re using <b>${name(override)}</b> instead of the recommended <b>${name(rec.best)}</b>.</p><button class="btn soft" type="button" data-use-best>Back to recommended</button></div>` : ''}

    <section class="hero rise" aria-label="Best route">
      <div class="k"><span>Best route</span><span class="chip">${esc(rec.name)}</span>${onRoute ? '<span class="chip">✓ You’re on it</span>' : ''}</div>
      <div class="when num">${best.done ? ymLabel(best.payoffM) : 'Not yet'}</div>
      <p class="sub">${best.done ? `${dur(best.payoffM - start)} away · ${money(best.totalInterest)} interest` : 'Payments don’t cover the interest yet. Add income on the Wealth tab.'}</p>
      <ol class="route">${steps.map((x, i) => `<li><span class="n">${i + 1}</span><div><b>${x.t}</b><small>${x.html ? x.s : x.s}</small></div></li>`).join('')}</ol>
      ${onRoute ? '' : `<div class="route-cta"><button class="btn primary" type="button" data-use-route>Use this route</button>
        <small>Your settings now: ${r.done ? `debt-free ${ymLabel(r.payoffM)} · ${money(r.totalInterest)} interest` : 'not paid off'}${rec.relyOnSavings ? ` · sends ${money(rec.currentMonthly)}/mo, ${money(rec.currentMonthly - rec.monthly)} more than is left after costs` : ''}</small></div>`}
    </section>

    ${!onRoute && rec.relyOnSavings && r.payoffM != null && best.payoffM != null && r.payoffM < best.payoffM ? `
    <section class="card glass rise"><div class="card-h"><h2>Why your settings finish sooner</h2></div>
      <p class="muted" style="margin:0">They send ${money(rec.currentMonthly)} a month, but only ${money(rec.monthly)} is left after costs, so about ${money(rec.currentMonthly - rec.monthly)} a month would have to come from savings. The best route only uses money it can see.${hasCash ? '' : ' Add your bank balance so it can count spare cash above your emergency fund.'}</p>
      ${hasCash ? '' : '<div class="add-row"><a class="btn soft" href="#accounts">Add bank balance</a></div>'}</section>` : ''}

    <details class="card glass rise why" ${override ? 'open' : ''}>
      <summary><h2>Why this route</h2><span class="muted small">Compare ${rec.alternatives.length} other options</span></summary>
      <div class="alts">${rec.alternatives.map(a => `
        <div class="alt"><div class="alt-h"><b>${esc(a.name)}</b><span class="${a.deltaInterest > 1 ? 'neg' : 'pos'} num">${a.deltaInterest > 1 ? `+${money(a.deltaInterest)}` : a.deltaInterest < -1 ? `−${money(-a.deltaInterest)}` : 'Same cost'}</span></div>
          <p>${esc(a.why)}</p><small>${esc(a.cost)} ${a.result.done ? `Debt-free ${ymLabel(a.result.payoffM)}.` : ''}</small>
          ${a.id !== 'minimum' ? `<button class="btn soft" type="button" data-use-alt="${a.id}">Use ${esc(a.name)} instead</button>` : ''}</div>`).join('')}</div>
    </details>

    <section class="card glass rise">
      <div class="card-h"><h2>Your plan over time</h2><span class="muted small">${r.done ? `${ymLabel(r.start)} – ${ymLabel(r.payoffM)}` : ''}</span></div>
      <div class="seg chart-switch" role="tablist" aria-label="Chart">${VIEWS.map(([k, t]) => `<button type="button" role="tab" data-view="${k}" aria-selected="${k === chartView}">${t}</button>`).join('')}</div>
      <div class="legend" data-legend></div>
      <div class="chips" data-chips hidden></div>
      <div class="chartbox" data-chart></div>
      <p class="section-note" data-note></p>
    </section>

    <section class="card glass rise moves">
      <div class="card-h"><h2>Ways to cut more interest</h2><span class="muted small">On top of your current settings</span></div>
      <div class="rows">${moves.length ? moves.map((m, i) => `
        <div class="row"><span class="rank">${i + 1}</span><div class="name"><b>${esc(m.title)}</b><small>${esc(m.detail)}</small></div>
          <div class="right"><span class="save num">${money(m.saved)}</span><small class="muted">${m.result.done ? ymLabel(m.result.payoffM) : 'Not yet'}${m.sooner > 0 ? ` · ${dur(m.sooner)} sooner` : ''}</small><button class="btn soft" type="button" data-move="${i}">Apply</button></div></div>`).join('')
        : '<p class="muted" style="margin:0">Your plan already covers every move this app can test.</p>'}</div>
    </section>

    <details class="card glass rise">
      <summary><h2>Assumptions</h2><span class="muted small">${plan.autopay ? 'Autopay on' : 'Autopay off'}${plan.refi?.on ? ` · refinance at ${pct(plan.refi.rate)}` : ''}</span></summary>
      <label class="switch"><span class="name"><b>Autopay discount</b><small>Most servicers take 0.25% off your rate with autopay</small></span><input type="checkbox" data-autopay ${plan.autopay ? 'checked' : ''}></label>
      <label class="switch"><span class="name"><b>What if I refinance private loans?</b><small>${plan.refi?.on ? `Private loans modeled at ${pct(plan.refi.rate)}` : 'Model a lower rate on your private loans'}</small></span><input type="checkbox" data-refi ${plan.refi?.on ? 'checked' : ''}></label>
      ${plan.refi?.on ? `<div class="field" style="max-width:220px;margin-top:4px"><span>Refinanced rate</span><span class="affix"><input type="number" inputmode="decimal" step="0.05" min="0" max="30" value="${plan.refi.rate}" data-refi-rate aria-label="Refinanced rate"><b>%</b></span></div>` : ''}
    </details>

    <section class="card glass rise">
      <div class="card-h"><h2>Saved scenarios</h2><button class="btn soft" type="button" data-save-scn style="height:36px;font-size:13.5px">Save this plan</button></div>
      <div class="rows">${sc.length ? sc.map(s => { const p = migratePlan(s.plan || {}); const now = simulate(loans, effectivePlan({ ...data, plan: p }, start), p.strategy, opts);
        return `<div class="row"><div class="name"><b>${esc(s.name)}</b><small>${name(p.strategy)} · ${p.incomes.length} income source${p.incomes.length === 1 ? '' : 's'}${+p.extraMonthly ? ` · +${money(+p.extraMonthly)}/mo` : ''} · saved ${esc((s.savedAt || '').slice(0, 10))}</small></div>
          <div class="right"><span class="amt num">${now.done ? ymLabel(now.payoffM) : 'Never'}</span><small class="muted">${money(now.totalInterest)} interest</small>
          <span style="display:flex;gap:4px"><button class="btn soft" type="button" data-load="${esc(s.id)}" style="height:32px;font-size:13px;padding:0 10px">Load</button><button class="btn soft danger" type="button" data-del="${esc(s.id)}" style="height:32px;font-size:13px;padding:0 10px">Delete</button></span></div></div>`; }).join('')
        : '<p class="muted small" style="margin:0">Save your plan before trying a different job offer or budget, then compare here. Each scenario is re-run against your current loans.</p>'}</div>
    </section>

    <details class="card glass rise">
      <summary><h2>Full timeline</h2><span class="muted small">${r.rows.length} months, year by year</span></summary>
      <div class="yr-head"><span>Year</span><span>Paid</span><span>Interest</span><span>Owed at end</span></div>
      ${years.map(y => `<details class="yr"><summary><span>${y.year}</span><span>${money(y.paid)}</span><span>${money(y.interestPaid)}</span><span>${money(y.endBalance)}</span></summary>
        ${y.rows.map(x => { const who = loans.filter(l => x.pay[l.id] > 0.5).sort((a, b) => x.pay[b.id] - x.pay[a.id]);
          return `<div class="mrow"><span>${MON[x.m % 12]}${x.lump ? ' <span class="tag now">+lump</span>' : ''}</span><span class="who">${who.length ? who.slice(0, 2).map(l => `<i style="background:${colorOf(l.id)}"></i>${esc(l.name.split(' · ')[0])} ${money(x.pay[l.id])}`).join(' · ') + (who.length > 2 ? ` · +${who.length - 2} more` : '') : 'Nothing due'}</span><b>${money(x.paid)}</b></div>`; }).join('')}</details>`).join('')}
    </details>`;

  // chart card: one chart, four views
  const box = view.querySelector('[data-chart]'), leg = view.querySelector('[data-legend]'), note = view.querySelector('[data-note]'), chips = view.querySelector('[data-chips]');
  let redraw = () => {};
  const drawView = () => {
    view.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === chartView)));
    chips.hidden = chartView !== 'extra'; note.textContent = '';
    if (chartView === 'balance') {
      leg.innerHTML = legend([...loans.slice(0, 8).map(l => ({ name: l.name, color: colorOf(l.id) })), ...(st !== 'minimum' ? [{ name: 'Minimums only (total)', dash: true }] : [])]);
      redraw = stackedBalance(box, r, st === 'minimum' ? null : base, loans, colorOf, { grad });
      if (st !== 'minimum' && r.done) note.textContent = `Paying only the minimums, you’d still owe ${money(base.rows.find(x => x.m === r.payoffM)?.total ?? base.initTotal)} when this plan finishes${base.done ? `, and wouldn’t be done until ${ymLabel(base.payoffM)}` : ''}.`;
    } else if (chartView === 'payments') {
      leg.innerHTML = legend(loans.filter(l => r.rows.some(x => x.pay[l.id])).slice(0, 8).map(l => ({ name: l.name, color: colorOf(l.id) })));
      redraw = paymentBars(box, r, loans, colorOf, { grad });
      if (r.rows.length) note.textContent = `Peak month: ${money(Math.max(...r.rows.map(x => x.paid)))}. Tap a bar to see where it goes.`;
    } else if (chartView === 'interest') {
      leg.innerHTML = legend([{ name: `${name(st)} (yours)`, color: 'var(--accent)' }, { name: 'Other strategies', color: 'var(--ink-3)' }, ...(st !== 'minimum' ? [{ name: 'Minimums only', dash: true }] : [])]);
      redraw = raceLines(box, all, st, STRATEGIES);
    } else {
      const extra = +plan.extraMonthly || 0, curve = extraCurve(loans, ep, st, { ...opts, max: curveMax, steps: 20 });
      leg.innerHTML = '';
      chips.innerHTML = [100, 250, 500, 1000].map(a => { const p = curve.find(c => c.extra === a) || (() => { const x = simulate(loans, { ...ep, extraMonthly: a }, st === 'minimum' ? 'avalanche' : st, opts); return { interest: x.totalInterest, done: x.done, payoffM: x.payoffM, months: x.months }; })();
        return `<button class="chip-b" type="button" data-setextra="${a}" aria-pressed="${extra === a}"><span>+${money(a)} a month</span><b>saves ${money(curve[0].interest - p.interest)}</b><small>${p.done ? `Debt-free ${ymLabel(p.payoffM)}` : 'Not paid off'}</small></button>`; }).join('');
      chips.querySelectorAll('[data-setextra]').forEach(b => b.addEventListener('click', () => { const a = +b.dataset.setextra === extra ? 0 : +b.dataset.setextra; setPlan({ extraMonthly: a }, `Extra set to ${money(a)} a month`); }));
      redraw = extraCurveChart(box, curve, extra, a => setPlan({ extraMonthly: a }, `Extra set to ${money(a)} a month`));
      note.textContent = 'What finding more each month would do. Extra beyond what’s left after costs comes from savings. Tap the chart to try an amount.';
    }
  };
  view.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { chartView = b.dataset.view; drawView(); }));
  drawView();

  // actions
  function setPlan(patch, message, toastMsg = message) { save({ ...data, plan: { ...plan, ...patch } }, message, toastMsg); }
  view.querySelector('[data-use-route]')?.addEventListener('click', () => save({ ...data, plan: { ...rec.plan, strategyOverride: null } }, `Using the best route: ${rec.name}, ${money(rec.monthly)}/mo${rec.lumpNow ? `, ${money(rec.lumpNow)} of savings now` : ''}`, `Now on the best route: debt-free ${ymLabel(best.payoffM)}`));
  view.querySelector('[data-use-best]')?.addEventListener('click', () => save({ ...data, plan: { ...rec.plan, strategyOverride: null } }, `Back to the recommended route: ${rec.name}`, `Back on ${rec.name}`));
  view.querySelectorAll('[data-use-alt]').forEach(b => b.addEventListener('click', () => {
    const a = rec.alternatives.find(x => x.id === b.dataset.useAlt);
    save({ ...data, plan: { ...rec.plan, strategy: a.id, strategyOverride: a.id } }, `Chose ${a.name} instead of ${rec.name}`, `Using ${a.name}`);
  }));
  view.querySelectorAll('[data-move]').forEach(b => b.addEventListener('click', () => {
    const m = moves[+b.dataset.move];
    save({ ...data, plan: applyMove(plan, m.apply, opts) }, `Applied: ${m.title}`, `${m.title} applied`);
  }));
  view.querySelector('[data-autopay]').addEventListener('change', e => setPlan({ autopay: e.target.checked }, `Autopay discount ${e.target.checked ? 'on' : 'off'}`));
  view.querySelector('[data-refi]').addEventListener('change', e => setPlan({ refi: { ...(plan.refi || { rate: 5.5 }), on: e.target.checked } }, `Refinance what-if ${e.target.checked ? 'on' : 'off'}`));
  view.querySelector('[data-refi-rate]')?.addEventListener('change', e => { const v = +e.target.value; if (v >= 0 && v <= 30) setPlan({ refi: { ...plan.refi, rate: v } }, `Refinance what-if at ${pct(v)}`); });

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

  return { redraw: () => redraw?.() };
}
