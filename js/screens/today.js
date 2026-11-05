// Today: what to do this month. Debt-free date, the verdict with this month's action, the cash runway, and to-dos.
// Ways to cut more interest live on Plan.
import { ym, ymStr, ymLabel, dailyInterest, isPending } from '../engine.js';
import { monthAction } from '../wealth.js';
import { reminders } from '../report.js';
import { money, dur, esc } from '../format.js';
import { header } from '../ui/layout.js';
import { runwayChart, legend } from '../charts.js';

const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

export function renderToday(view, ctx) {
  const { data, results, start, strategy, strategyName, hasHistory, save, onLogPayment } = ctx;
  const plan = data.plan, r = results[strategy];
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const grad = ym(plan.gradMonth);

  // hero
  const orig = data.loans.filter(l => !isPending(l, start)).reduce((s, l) => s + (+l.origBalance || (+l.balance || 0) + (+l.unpaid || 0)), 0);
  const paidPct = orig ? Math.max(0, Math.min(1, 1 - r.initTotal / orig)) : 0;
  const end = r.done ? r.payoffM + 1 : null;
  const pin = r.done && grad != null && grad > start && grad < end ? (grad - start) / (end - start) : null;

  // best move and to-dos
  const act = monthAction(data, start), st = act.stability;
  const verdict = { stable: ['Stable', 'good'], watch: ['Watch', 'warn'], tight: ['Tight', 'crit'] }[st.level];
  // the reasons behind the verdict, a few plain numbers
  const h = st.habits, pctOf = x => `${Math.round(x * 100)}%`;
  const reasons = st.hasBank ? [
    ['Runway', st.runwayMonths != null ? `<b>${st.runwayMonths.toFixed(1)} months</b> of costs in the bank (${money(st.cash)})` : `${money(st.cash)} in the bank`],
    ['Lowest point', `<b>${money(Math.max(0, st.normal.lowSaved.cash))}</b> in ${ymLabel(Math.max(start, st.normal.lowSaved.m))}; bad stretch <b>${money(Math.max(0, st.bad.lowSaved.cash))}</b> (cushion ${money(st.target)}${st.cushion.mode === 'starter' ? ' while in school' : ''})`],
    ['Real vs plan', h.months ? `Last ${h.months} month${h.months > 1 ? 's' : ''}: income <b>${pctOf(h.incomeRatio)}</b> of plan, spending <b>${pctOf(h.costsRatio)}</b>` : 'No full month tracked yet, so this uses your plan. Keep logging in Spending.'],
    ...(st.level !== 'stable' && st.backstop > 0 ? [['Backstop', `${money(st.backstop)} in Robinhood (not the IRA), if ever needed`]] : []),
  ] : [];
  const monthKey = ymStr(start);
  const done = new Set(plan.dismissed?.[monthKey] || []);
  const todos = reminders(data, { hasHistory });
  const open = todos.filter(t => !done.has(t.key)), closed = todos.filter(t => done.has(t.key));

  view.innerHTML = `
    ${header({ title: 'Today', eyebrow: today })}
    <section class="hero rise" aria-label="Debt-free date">
      <div class="k"><span>Debt-free</span><span class="chip">${esc(strategyName)}</span></div>
      <div class="when num">${r.done ? ymLabel(r.payoffM) : 'Not yet'}</div>
      <p class="sub">${r.done ? `${r.payoffM > start ? `${dur(r.payoffM - start)} away · ` : ''}${r.months} monthly payment${r.months === 1 ? '' : 's'}` : 'Your payments don’t cover the interest yet. Add income on the Wealth tab.'}</p>
      <div class="timeline">
        <div class="track" role="img" aria-label="${Math.round(paidPct * 100)}% of your original balance paid off"><div class="fill" style="width:${(paidPct * 100).toFixed(1)}%"></div>${pin != null ? `<span class="pin" style="left:${(pin * 100).toFixed(1)}%"></span>` : ''}</div>
        <div class="ticks"><span>${paidPct >= 0.01 ? `${Math.round(paidPct * 100)}% paid` : 'Now'}</span>${pin != null ? `<span class="at" style="left:${(pin * 100).toFixed(1)}%">Graduate ${ymLabel(grad).replace(/ 20(\d\d)$/, ' ’$1')}</span>` : ''}<span>Free</span></div>
      </div>
      <div class="stats">
        <div class="stat"><span>Owed</span><b class="num">${money(r.initTotal)}</b></div>
        <div class="stat"><span>Interest left</span><b class="num">${money(r.totalInterest)}</b></div>
        <div class="stat"><span>Interest / day</span><b class="num">${money(dailyInterest(data.loans, start), true)}</b></div>
      </div>
    </section>

    <div class="board">
      <section class="card glass move rise" aria-label="This month">
        <div class="card-h" style="margin:0"><span class="spark" aria-hidden="true"><svg class="i"><use href="#i-send"/></svg></span>${verdict ? `<span class="badge ${verdict[1]}">${verdict[0]}</span>` : ''}<span class="badge" style="background:var(--hairline);color:var(--ink-2)">This month</span></div>
        <h3>${esc(act.title)}</h3>
        <p class="muted small" style="margin:0">${esc(act.detail)}</p>
        ${act.kind !== 'no-bank' ? `<ul class="reasons">${reasons.map(([k, v]) => `<li><span>${k}</span><div>${v}</div></li>`).join('')}</ul>` : ''}
        <div class="actions" style="margin-top:14px">${act.action ? act.action.prefill ? `<button class="btn primary" type="button" data-prefill>${esc(act.action.label)}</button>` : act.action.log ? '<button class="btn primary" type="button" data-log>Log a payment</button>' : `<a class="btn primary" href="${act.action.href}">${esc(act.action.label)}</a>` : ''}</div>
      </section>
      ${st.hasBank ? `<section class="card glass rise" aria-label="Cash runway">
        <div class="card-h"><h2>Cash runway</h2><span class="muted small">${ymLabel(start)} – ${ymLabel(st.normal.horizonEnd - 1)}</span></div>
        <div class="legend">${legend([{ name: 'Cash as planned', color: 'var(--accent)' }, { name: 'Bad stretch (extras paused)', color: 'var(--warn)' }, { name: 'Cushion', color: 'var(--crit)' }, ...((data.checkins || []).length ? [{ name: 'Real check-ins', color: 'var(--ink)' }] : [])])}</div>
        <div class="chartbox" data-runway></div>
      </section>` : ''}

      <section class="card glass rise" aria-label="To-dos">
        <div class="card-h"><h2>This month’s to-dos</h2><span class="muted small">${open.length ? `${open.length} open` : todos.length ? 'All done' : ''}</span></div>
        ${todos.length ? `<div class="todos">${[...open, ...closed].map(t => `
          <label class="todo ${done.has(t.key) ? 'done' : ''}"><input type="checkbox" data-todo="${esc(t.key)}" ${done.has(t.key) ? 'checked' : ''}><span>${md(t.text)}</span></label>`).join('')}</div>`
          : '<p class="muted small" style="margin:0">Nothing needs your attention this month. Reminders show up here when a rate needs checking, repayment is about to start, or a balance is getting old.</p>'}
      </section>
    </div>`;

  view.querySelector('[data-log]')?.addEventListener('click', () => onLogPayment());
  view.querySelector('[data-prefill]')?.addEventListener('click', () => onLogPayment(act.action.prefill));
  view.querySelectorAll('[data-todo]').forEach(cb => cb.addEventListener('change', () => {
    const keys = new Set(plan.dismissed?.[monthKey] || []);
    cb.checked ? keys.add(cb.dataset.todo) : keys.delete(cb.dataset.todo);
    const t = todos.find(x => x.key === cb.dataset.todo);
    const dismissed = { [monthKey]: [...keys] }; // keep only this month; older months no longer matter
    save({ ...data, plan: { ...plan, dismissed } }, `${cb.checked ? 'Checked off' : 'Reopened'}: ${t.text.replace(/\*\*/g, '').slice(0, 80)}`, cb.checked ? 'Checked off' : 'Reopened');
  }));
  const box = view.querySelector('[data-runway]');
  const redraw = box ? runwayChart(box, { stability: st, checkins: data.checkins || [], start }) : null;
  return { redraw };
}
