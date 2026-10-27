// Money: what comes in, what goes out, and how much of the difference goes to loans, month by month.
import { ym, ymStr, ymLabel, cashFlow, toMonthly, activeIn, simulate } from '../engine.js';
import { money, esc } from '../format.js';
import { cashflowBars, legend } from '../charts.js';
import { makeEditors, INC_KINDS } from '../ui/editors.js';
import { header, subnav } from '../ui/layout.js';
import { WEALTH_TABS } from './wealth.js';
import { effectivePlan } from '../wealth.js';
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
      const cf = cashFlow(p, m), paid = r.rows.find(x => x.m === m)?.paid || 0, room = Math.max(0, cf.income - cf.costs);
      out.push({ m, inc: cf.inc.map(s => ({ label: s.label, monthly: toMonthly(s) })), exp: cf.exp, costs: Math.min(cf.costs, cf.income), loans: Math.min(paid, room), loansAll: paid,
        saved: Math.max(0, cf.income - cf.costs - paid), short: Math.max(0, cf.costs + paid - cf.income), income: cf.income, rawCosts: cf.costs });
    }
    return out;
  };
  const months = flowData(plan), now = months[0];
  const share = plan.share ?? 100;

  const incRow = (s, i) => `<button class="row" type="button" data-inc="${i}"><div class="name"><b>${esc(s.label || INC_KINDS[s.kind] || 'Income')}<span class="tag">${INC_KINDS[s.kind] || 'Other'}</span>${activeIn(s, start) ? '<span class="tag now">Now</span>' : ''}</b>
    <small>${money(+s.amount || 0)} a ${s.per === 'month' ? 'month' : 'week'} · ${range(s)}</small></div><span class="amt num">${money(toMonthly(s))}<small class="muted">/mo</small></span></button>`;
  const expRow = (s, i) => `<button class="row" type="button" data-exp="${i}"><div class="name"><b>${esc(s.label || 'Costs')}${activeIn(s, start) ? '<span class="tag now">Now</span>' : ''}</b><small>${range(s)}</small></div><span class="amt num">${money(+s.amount || 0)}<small class="muted">/mo</small></span></button>`;
  const lumpRow = (s, i) => `<button class="row" type="button" data-lump="${i}"><div class="name"><b>${esc(s.label || 'One-time payment')}</b><small>${s.month ? ymLabel(ym(s.month)) : 'No month set'}</small></div><span class="amt num">${money(+s.amount || 0)}</span></button>`;

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
        return `<p class="err" style="margin:10px 0 0;font-size:13.5px">In ${shortMonths.length} month${shortMonths.length > 1 ? 's' : ''}, costs plus loan payments are more than you bring in: about ${money(total)} in all, ${money(total / shortMonths.length)} a month on average, that would have to come from savings.${extraNote}</p>`;
      })()}
      <div class="slider" style="margin-top:10px">
        <div class="top"><b>Send to loans</b><output data-share-out>${share}%</output></div>
        <input type="range" min="0" max="100" step="5" value="${share}" data-share aria-label="Share of leftover cash sent to loans">
        <small>Of what’s left after costs each month. The rest counts as savings. Minimums are always paid.</small>
      </div>
    </section>
    <div class="board">
      <div class="col">
        <section class="card glass rise">
          <div class="card-h"><h2>Income</h2><span class="muted small">Take-home, after taxes</span></div>
          <div class="rows">${plan.incomes.length ? plan.incomes.map(incRow).join('') : '<p class="muted small" style="margin:0">No income yet. Add your part-time job, an internship, or your pay after graduation.</p>'}</div>
          <div class="add-row"><button class="btn soft" type="button" data-addinc="part">+ Part-time</button><button class="btn soft" type="button" data-addinc="intern">+ Internship</button><button class="btn soft" type="button" data-addinc="full">+ After graduation</button><button class="btn soft" type="button" data-addinc="other">+ Other</button></div>
        </section>
      </div>
      <div class="col">
        <section class="card glass rise">
          <div class="card-h"><h2>Monthly costs</h2><span class="muted small">Rent, food, phone…</span></div>
          <div class="rows">${plan.expenses.length ? plan.expenses.map(expRow).join('') : '<p class="muted small" style="margin:0">No costs yet. Add what you spend each month now, then what you expect after graduation.</p>'}</div>
          <div class="add-row"><button class="btn soft" type="button" data-addexp="now">+ Current costs</button><button class="btn soft" type="button" data-addexp="post">+ After graduation</button><button class="btn soft" type="button" data-addexp="other">+ Other</button></div>
        </section>
        <section class="card glass rise">
          <div class="card-h"><h2>One-time payments</h2><span class="muted small">Refunds, bonuses, gifts</span></div>
          <div class="rows">${plan.lumps.length ? plan.lumps.map(lumpRow).join('') : '<p class="muted small" style="margin:0">None planned. A tax refund or bonus put toward loans goes here.</p>'}</div>
          <div class="add-row"><button class="btn soft" type="button" data-addlump>+ One-time payment</button></div>
        </section>
      </div>
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
  const { editIncome, editCost, editLump, INC_PRESETS, COST_PRESETS } = makeEditors({ data, save, start });
  view.querySelectorAll('[data-inc]').forEach(b => b.addEventListener('click', () => editIncome(+b.dataset.inc)));
  view.querySelectorAll('[data-exp]').forEach(b => b.addEventListener('click', () => editCost(+b.dataset.exp)));
  view.querySelectorAll('[data-lump]').forEach(b => b.addEventListener('click', () => editLump(+b.dataset.lump)));
  view.querySelectorAll('[data-addinc]').forEach(b => b.addEventListener('click', () => editIncome(null, { ...INC_PRESETS[b.dataset.addinc], amount: '' })));
  view.querySelectorAll('[data-addexp]').forEach(b => b.addEventListener('click', () => editCost(null, { ...COST_PRESETS[b.dataset.addexp], amount: '' })));
  view.querySelector('[data-addlump]').addEventListener('click', () => editLump(null));

  return { redraw: () => chart.draw() };
}
