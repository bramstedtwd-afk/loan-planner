// Spending: real money in and out. Real vs estimated bank balance, this month's totals by category, and every entry.
import { ym, ymStr, ymLabel, cashFlow } from '../engine.js';
import { money, esc } from '../format.js';
import { header, subnav } from '../ui/layout.js';
import { WEALTH_TABS } from './wealth.js';
import { balances, monthSummary, ledger, checkinDue, actualVsPlan, UNLOGGED } from '../tracker.js';
import { actualPlanBars, legend } from '../charts.js';
import { openLogMoney, openCheckin } from '../ui/log-money.js';
import { formSheet } from '../ui/form-sheet.js';

const dayLabel = d => new Date(`${d}T12:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

export function renderSpending(view, ctx, { month: shown, openCheck = false } = {}) {
  const { data, start, save, onMonth } = ctx;
  const month = shown || ymStr(start), m = ym(month);
  const b = balances(data), s = monthSummary(data, month), due = checkinDue(data);
  const plan = cashFlow(data.plan, m);
  const firstMonth = ledger(data).reduce((x, e) => (e.date || '') < x ? e.date : x, ymStr(start)).slice(0, 7);
  const maxCat = Math.max(1, ...s.byCategory.map(c => c.amount));
  const days = [...new Set(s.entries.map(e => e.date))];
  const trend = actualVsPlan(data, ymStr(start), k => cashFlow(data.plan, ym(k)), 6);
  const tagFor = e => e.source === 'payment' ? 'Loan' : e.source === 'planned' ? 'Planned' : e.kind === 'unlogged' ? 'Check-in' : '';

  view.innerHTML = `${header({ title: 'Wealth' })}${subnav(WEALTH_TABS, 'spending', 'Wealth views')}
    ${b.hasBank ? `<section class="card glass rise" aria-label="Bank balance">
      <div class="card-h"><h2>Bank cash</h2>${due ? '<span class="badge warn">Check-in due</span>' : '<span class="muted small">Checked in this week</span>'}</div>
      <div class="tiles">
        <div class="tile"><span>Real · ${b.asOf ? new Date(`${b.asOf}T12:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'not set'}</span><b class="num">${money(b.real, true)}</b></div>
        <div class="tile accent"><span>Estimated now</span><b class="num">${money(b.estimated, true)}</b></div>
      </div>
      <p class="muted small" style="margin:10px 0 0">${b.count ? `Since then you logged <b>+${money(b.inSince, true)}</b> in and <b>−${money(b.outSince, true)}</b> out.` : 'Nothing logged since your last confirmed balance.'} Logging never changes the real number; Sunday’s check-in does.</p>
      <div class="add-row"><button class="btn ${due ? 'primary' : 'soft'}" type="button" data-checkin>Update balances</button></div>
    </section>` : `<section class="card glass rise"><div class="card-h"><h2>Add your bank account</h2></div>
      <p class="muted small" style="margin:0 0 12px">Spending tracking compares what you log with your real bank balance each Sunday. Add checking (and savings) first.</p>
      <div class="add-row"><a class="btn primary" href="#accounts">Add bank account</a></div></section>`}

    <section class="card glass rise" aria-label="Month">
      <div class="card-h"><h2>${new Date(Math.floor(m / 12), m % 12, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h2>
        <span class="month-nav"><button class="icon-btn" type="button" data-month="${ymStr(m - 1)}" ${month <= firstMonth ? 'disabled' : ''} aria-label="Previous month">‹</button><button class="icon-btn" type="button" data-month="${ymStr(m + 1)}" ${m >= start ? 'disabled' : ''} aria-label="Next month">›</button></span></div>
      <div class="tiles three">
        <div class="tile"><span>In</span><b class="num pos">${money(s.in)}</b><small class="muted">plan ${money(plan.income)}</small></div>
        <div class="tile"><span>Out</span><b class="num">${money(s.out)}</b><small class="muted">plan ${money(plan.costs + plan.oneTime)}</small></div>
        <div class="tile ${s.net < 0 ? 'crit' : 'accent'}"><span>Net</span><b class="num">${s.net < 0 ? '−' : '+'}${money(Math.abs(s.net))}</b><small class="muted">plan ${money(plan.left)}</small></div>
      </div>
      ${m === start ? '<p class="muted small" style="margin:10px 0 0">This month so far. Plan numbers are the whole month, and “plan out” leaves out loan payments.</p>' : ''}
      ${s.byCategory.length ? `<div class="cats">${s.byCategory.map(c => `<div class="cat"><span>${esc(c.category)}</span><div class="bar"><i style="width:${(c.amount / maxCat * 100).toFixed(1)}%;background:${c.category === UNLOGGED ? 'var(--warn)' : c.category === 'Loan payment' ? 'var(--accent)' : 'var(--s1)'}"></i></div><b class="num">${money(c.amount)}</b></div>`).join('')}</div>` : ''}
      <div class="add-row"><button class="btn primary" type="button" data-log="out">− Money out</button><button class="btn soft" type="button" data-log="in">+ Money in</button></div>
    </section>

    ${trend.length ? `<section class="card glass rise" aria-label="Actual vs plan">
      <div class="card-h"><h2>Actual vs plan</h2><span class="muted small">${trend.length < 2 ? 'Fills in as you log' : `Last ${trend.length} months`}</span></div>
      <div class="legend">${legend([{ name: 'Spent', color: 'var(--s1)' }, { name: 'Came in', color: 'var(--good)' }, { name: 'Plan (outline / line)', color: 'var(--ink-3)' }])}</div>
      <div class="chartbox" data-trend></div>
      ${trend.some(d => d.partial) ? '<p class="muted small" style="margin:6px 0 0">* This month so far.</p>' : ''}
    </section>` : ''}

    <section class="card glass rise" aria-label="Entries">
      <div class="card-h"><h2>Entries</h2><span class="muted small">${s.entries.length || 'None yet'}</span></div>
      ${days.length ? days.map(d => `<div class="day"><small class="muted">${dayLabel(d)}</small><div class="rows">${s.entries.filter(e => e.date === d).map(e => `
        <button class="row" type="button" data-entry="${esc(e.id)}"><div class="name"><b>${esc(e.category)}${tagFor(e) ? `<span class="tag">${tagFor(e)}</span>` : ''}</b>${e.note ? `<small>${esc(e.note)}</small>` : ''}</div>
          <span class="amt num" style="${e.dir === 'in' ? 'color:var(--good)' : ''}">${e.dir === 'in' ? '+' : '−'}${money(e.amount, true)}</span></button>`).join('')}</div></div>`).join('')
        : '<p class="muted small" style="margin:0">Log money in or out with the buttons above or the + button. Loan payments and planned costs you mark paid show up here on their own.</p>'}
    </section>

    <section class="card glass rise"><div class="card-h"><h2>Categories</h2><button class="btn soft" type="button" data-cats style="height:34px;font-size:13px">Edit</button></div>
      <p class="muted small" style="margin:0"><b>Out:</b> ${esc((data.plan.categories?.out || []).join(', '))}<br><b>In:</b> ${esc((data.plan.categories?.in || []).join(', '))}</p></section>`;

  view.querySelector('[data-checkin]')?.addEventListener('click', () => openCheckin({ data, save }));
  view.querySelectorAll('[data-log]').forEach(btn => btn.addEventListener('click', () => openLogMoney({ data, save, dir: btn.dataset.log })));
  view.querySelectorAll('[data-month]').forEach(btn => btn.addEventListener('click', () => onMonth(btn.dataset.month)));
  view.querySelectorAll('[data-entry]').forEach(btn => btn.addEventListener('click', () => {
    const e = s.entries.find(x => x.id === btn.dataset.entry);
    if (e.source === 'log') openLogMoney({ data, save, entry: data.transactions.find(t => t.id === e.id) });
    else location.hash = e.source === 'payment' ? '#activity' : '#cashflow';
  }));
  view.querySelector('[data-cats]').addEventListener('click', () => {
    const c = data.plan.categories || { out: [], in: [] };
    formSheet({
      title: 'Categories', intro: 'Separate with commas. Renaming one doesn’t change entries you already logged.',
      fields: [
        { name: 'out', label: 'Money out', value: c.out.join(', '), required: true, maxlength: 400 },
        { name: 'in', label: 'Money in', value: c.in.join(', '), required: true, maxlength: 400 },
      ],
      onSubmit: v => {
        const list = x => [...new Set(x.split(',').map(t => t.trim()).filter(Boolean))].slice(0, 30);
        const next = { out: list(v.out), in: list(v.in) };
        if (!next.out.length || !next.in.length) return 'Keep at least one category on each side.';
        save({ ...data, plan: { ...data.plan, categories: next } }, 'Updated categories', 'Categories saved');
      },
    });
  });
  if (openCheck && b.hasBank) setTimeout(() => openCheckin({ data, save }), 150);
  const box = view.querySelector('[data-trend]');
  return { redraw: box ? actualPlanBars(box, trend) : null };
}
