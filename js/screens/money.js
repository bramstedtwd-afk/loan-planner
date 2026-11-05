// Money plan: what comes in, what goes out, how much goes to loans month by month, and every item the plan counts on.
import { ym, ymStr, ymLabel, cashFlow, toMonthly, activeIn, simulate, isPending, KINDS } from '../engine.js';
import { nextDue, budgetTotal } from '../tracker.js';
import { money, esc, pct, todayISO } from '../format.js';
import { cashflowBars, legend } from '../charts.js';
import { makeEditors, INC_KINDS } from '../ui/editors.js';
import { header, subnav } from '../ui/layout.js';
import { WEALTH_TABS } from './wealth.js';
import { effectivePlan } from '../wealth.js';
const CADENCE = { biweekly: 'Every 2 weeks', weekly: 'Every week', monthly: 'Monthly', 'monthly-last': 'Last day of each month' };
const dayLabel = d => new Date(`${d}T12:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const range = s => `${s.start ? ymLabel(ym(s.start)) : '—'} – ${s.end ? ymLabel(ym(s.end)) : 'ongoing'}`;

export function renderMoney(view, ctx) {
  const { data, start, save } = ctx;
  const plan = data.plan, st = plan.strategy;
  const g = ym(plan.gradMonth) ?? start + 12;

  const flowData = (p) => {
    const r = simulate(data.loans, effectivePlan({ ...data, plan: p }, start), st, { start });
    const end = Math.min(start + 72, Math.max(start + 36, g + 24, r.done ? r.payoffM + 3 : 0));
    const out = [];
    for (let m = start; m <= end; m++) {
      const cf = cashFlow(p, m), paid = r.rows.find(x => x.m === m)?.paid || 0, allCosts = cf.costs + cf.oneTime, room = Math.max(0, cf.income - allCosts);
      out.push({ m, inc: cf.inc.map(s => ({ label: s.label, monthly: toMonthly(s) })), exp: [...cf.exp, ...cf.planned], costs: Math.min(allCosts, cf.income), loans: Math.min(paid, room), loansAll: paid,
        saved: Math.max(0, cf.income - allCosts - paid), short: Math.max(0, allCosts + paid - cf.income), income: cf.income, rawCosts: allCosts, oneTime: cf.oneTime });
    }
    return out;
  };
  const months = flowData(plan), now = months[0];
  const share = plan.share ?? 100;

  // ---------- the money plan timeline: every income, cost, bill, planned cost and future loan in one list ----------
  const GROUPS = [['now', 'Now'], ['upcoming', 'Next 12 months'], ['later', 'Later'], ['past', 'Done or ended']];
  const groupOf = (from, to) => to != null && to < start ? 'past' : from == null || from <= start ? 'now' : from - start <= 12 ? 'upcoming' : 'later';
  const today = todayISO();
  const items = [
    ...plan.incomes.map((x, i) => ({ type: 'income', tag: INC_KINDS[x.kind] || 'Income', label: x.label || 'Income', amount: `${money(toMonthly(x))}/mo`, sub: `${money(+x.amount || 0)} a ${x.per === 'month' ? 'month' : 'week'} · ${range(x)}`, g: groupOf(ym(x.start), ym(x.end)), sort: ym(x.start) ?? 0, edit: ['inc', i] })),
    ...plan.expenses.map((x, i) => ({ type: 'cost', tag: 'Monthly costs', label: x.label || 'Costs', amount: `${money(+x.amount || 0)}/mo`, sub: `${range(x)}${activeIn(x, start) && budgetTotal(data) > 0 ? ' · split into budgets below' : ''}`, g: groupOf(ym(x.start), ym(x.end)), sort: ym(x.start) ?? 0, edit: ['exp', i] })),
    ...(budgetTotal(data) > 0 ? [{ type: 'cost', tag: 'Budgets', label: 'Monthly budgets', amount: `${money(budgetTotal(data))}/mo`, sub: Object.entries(plan.spendBudgets).filter(([, v]) => +v > 0).map(([k, v]) => `${k} ${money(+v)}`).join(' · '), g: 'now', sort: start, edit: ['budgets', 0] }] : []),
    ...(data.recurring || []).map((r, i) => { const nd = nextDue(r, today); return { type: 'recurring', tag: r.dir === 'in' ? 'Recurring in' : 'Recurring out', label: r.label, amount: `${r.dir === 'in' ? '+' : '−'}${money(+r.amount || 0)}${r.variable ? ' ~' : ''}`, sub: `${CADENCE[r.cadence] || r.cadence}${nd ? ` · next ${dayLabel(nd)}` : ''}`, g: r.active === false ? 'past' : 'now', sort: start, edit: ['rec', i] }; }),
    ...(plan.planned || []).map((x, i) => ({ type: 'school', tag: 'Planned cost', est: x.estimate, label: x.label, amount: money(+x.amount || 0), sub: x.paidOn ? `Paid ${x.paidOn}` : `Due ${ymLabel(ym(x.month))}`, g: x.paidOn ? 'past' : groupOf(ym(x.month), ym(x.month) < start ? start : null), sort: ym(x.month) ?? 0, edit: ['planned', i], paid: x.paidOn ? null : i })),
    ...data.loans.filter(l => isPending(l, start)).map(l => ({ type: 'school', tag: 'Future loan', est: l.estimate, label: l.name, amount: `+${money(+l.balance || 0)}`, sub: `${KINDS[l.kind]?.short || ''} · arrives ${ymLabel(ym(l.disburseMonth))} · ${pct(l.rate)}`, g: groupOf(ym(l.disburseMonth), null), sort: ym(l.disburseMonth), edit: ['loan', l.id] })),
    ...plan.lumps.map((x, i) => ({ type: 'school', tag: 'One-time payment', label: x.label || 'One-time payment', amount: money(+x.amount || 0), sub: `To loans · ${x.month ? ymLabel(ym(x.month)) : 'no month'}`, g: groupOf(ym(x.month), ym(x.month)), sort: ym(x.month) ?? 0, edit: ['lump', i] })),
  ];
  const FILTERS = [['all', 'All'], ['income', 'Income'], ['cost', 'Costs'], ['school', 'School & loans'], ['recurring', 'Recurring']];
  const filter = ctx.filter || 'all';
  const shown = items.filter(x => filter === 'all' || x.type === filter);
  const itemRow = x => `<div class="row acct tl-row"><button class="name" type="button" data-edit-item="${x.edit[0]}:${x.edit[1]}"><b>${esc(x.label)}<span class="tag ${x.type === 'income' ? 'fed' : ''}">${esc(x.tag)}</span>${x.est ? '<span class="tag warn-tag">Estimate</span>' : ''}</b><small>${esc(x.sub)}</small></button>
    <div class="right"><span class="amt num ${x.g === 'past' ? 'muted' : ''}">${x.amount}</span></div>${x.paid != null ? `<button class="btn soft edit" type="button" data-paid="${x.paid}">Mark paid</button>` : ''}</div>`;

  view.innerHTML = `
    ${header({ title: 'Wealth' })}
    ${subnav(WEALTH_TABS, 'cashflow', 'Wealth views')}
    <section class="card glass rise">
      <div class="card-h"><h2>${new Date(Math.floor(start / 12), start % 12, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h2><span class="muted small">This month</span></div>
      <div class="tiles">
        <div class="tile"><span>Coming in</span><b class="num">${money(now.income)}</b></div>
        <div class="tile"><span>Costs</span><b class="num">${money(now.rawCosts)}</b></div>
        <div class="tile ${now.income - now.rawCosts < 0 ? 'crit' : ''}"><span>Left over</span><b class="num">${money(now.income - now.rawCosts)}</b></div>
        <div class="tile accent"><span>To loans</span><b class="num">${money(now.loansAll)}</b></div>
      </div>
    </section>
    <section class="card glass rise">
      <div class="card-h"><h2>Cash flow</h2><span class="muted small">${ymLabel(months[0].m)} – ${ymLabel(months[months.length - 1].m)}</span></div>
      <div class="legend" data-legend></div>
      <div class="chartbox" data-flow></div>
      ${(() => {
        const shortMonths = months.filter(d => d.short > 0.5);
        if (!shortMonths.length) return '';
        const total = shortMonths.reduce((s, d) => s + d.short, 0), extraNote = +plan.extraMonthly > 0 ? ` Your ${money(+plan.extraMonthly)} extra each month is part of this; it’s set on the Plan screen.` : '';
        const plannedNote = shortMonths.some(d => d.oneTime > 0.5) ? ' Planned one-time costs are part of this; the app keeps that cash aside before suggesting extra loan payments.' : '';
        return `<p class="${plannedNote && !extraNote ? 'muted small' : 'err'}" style="margin:10px 0 0;font-size:13.5px">In ${shortMonths.length} month${shortMonths.length > 1 ? 's' : ''}, costs plus loan payments are more than you bring in: about ${money(total)} in all, which comes from savings.${plannedNote}${extraNote}</p>`;
      })()}
      <div class="slider" style="margin-top:10px">
        <div class="top"><b>Send to loans</b><output data-share-out>${share}%</output></div>
        <input type="range" min="0" max="100" step="5" value="${share}" data-share aria-label="Share of leftover cash sent to loans">
        <small>Of what’s left after costs each month. The rest counts as savings. Minimums are always paid.</small>
      </div>
    </section>
    <section class="card glass rise" aria-label="Money plan">
      <div class="card-h"><h2>Money plan</h2><button class="btn primary" type="button" data-add-item style="height:36px;font-size:13.5px">+ Add</button></div>
      <p class="muted small" style="margin:0 0 10px">Everything the plan counts on, in one place. Tap any line to change it; <b>Estimate</b> means a placeholder to confirm later.</p>
      <div class="seg scroll" role="tablist" aria-label="Show">${FILTERS.map(([k, t]) => `<label><input type="radio" name="tl-filter" value="${k}" ${k === filter ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>
      ${GROUPS.map(([g, title]) => { const list = shown.filter(x => x.g === g).sort((p, q) => p.sort - q.sort); return list.length ? `<details class="tl-group" ${g === 'past' ? '' : 'open'}><summary>${title} <span class="muted small">${list.length}</span></summary><div class="rows">${list.map(itemRow).join('')}</div></details>` : ''; }).join('') || '<p class="muted small" style="margin:12px 0 0">Nothing here yet.</p>'}
    </section>
    </div>`;

  // cash flow chart, redrawn live while the slider moves
  const box = view.querySelector('[data-flow]');
  let chart = cashflowBars(box, months, { grad: ym(plan.gradMonth) });
  view.querySelector('[data-legend]').innerHTML = legend([...chart.legend, ...(months.some(d => d.short > 0.5) ? [{ name: 'Short: costs + loan payments over income', color: 'var(--crit)' }] : [])]);
  const slider = view.querySelector('[data-share]'), out = view.querySelector('[data-share-out]');
  const paint = () => slider.style.setProperty('--p', `${slider.value}%`);
  paint();
  let t;
  slider.addEventListener('input', () => {
    paint(); out.textContent = `${slider.value}%`;
    clearTimeout(t); t = setTimeout(() => { chart = cashflowBars(box, flowData({ ...plan, share: +slider.value }), { grad: ym(plan.gradMonth) }); }, 60);
  });
  slider.addEventListener('change', () => { if (+slider.value !== share) save({ ...data, plan: { ...plan, share: +slider.value } }, `Send ${slider.value}% of leftover cash to loans`, `Sending ${slider.value}% of leftover cash to loans`); });

  // editors (shared with the + quick actions)
  const ed = makeEditors({ data, save, start });
  const open = (kind, key) => ({
    inc: () => ed.editIncome(+key), exp: () => ed.editCost(+key), budgets: () => ed.editBudgets(), rec: () => ed.editRecurring(+key),
    planned: () => ed.editPlanned(+key), lump: () => ed.editLump(+key), loan: () => { location.hash = '#loans'; },
  })[kind]();
  view.querySelectorAll('[data-edit-item]').forEach(b => b.addEventListener('click', () => { const [k, key] = b.dataset.editItem.split(':'); open(k, key); }));
  view.querySelectorAll('[data-paid]').forEach(b => b.addEventListener('click', () => ed.markPlannedPaid(+b.dataset.paid)));
  view.querySelectorAll('input[name="tl-filter"]').forEach(r => r.addEventListener('change', () => ctx.onFilter(r.value)));
  view.querySelector('[data-add-item]').addEventListener('click', () => ed.addAnything());

  return { redraw: () => chart.draw() };
}
