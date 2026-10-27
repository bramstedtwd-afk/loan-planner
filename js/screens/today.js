// Today: what to do this month. Debt-free date, the single best next move, and this month's to-dos.
import { ym, ymStr, ymLabel, dailyInterest, interestMoves } from '../engine.js';
import { recommendRoute, nextDollar, effectivePlan } from '../wealth.js';
import { reminders } from '../report.js';
import { money, dur, esc } from '../format.js';
import { header } from '../ui/layout.js';

const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

// The one thing most worth doing next, in priority order.
function bestMove(data, results, strategy, start) {
  const r = results[strategy];
  const rec = recommendRoute(data, { start });
  const hasBank = (data.accounts || []).some(a => a.kind === 'bank');
  const onRoute = Math.abs(r.totalInterest - rec.result.totalInterest) < 1 && r.payoffM === rec.result.payoffM;
  if (!hasBank && rec.relyOnSavings) return {
    title: 'Add your bank balance', detail: `Your plan sends ${money(rec.currentMonthly)} a month but only ${money(rec.monthly)} is left after costs. With your balance, the app can tell whether savings can safely cover the difference.`,
    action: { label: 'Add balance', href: '#accounts' },
  };
  if (!onRoute && rec.result.totalInterest < r.totalInterest - 1) return {
    title: `Switch to the best route (${rec.name})`, detail: `${rec.lumpNow ? `Put ${money(rec.lumpNow)} of savings in now and send` : 'Send'} ${money(rec.monthly)} a month.`,
    gain: { saved: r.totalInterest - rec.result.totalInterest, payoffM: rec.result.payoffM, sooner: (r.months ?? 480) - (rec.result.months ?? 480) },
    action: { label: 'See the route', href: '#plan' },
  };
  const step = nextDollar(data, { start }).find(s => s.status === 'now');
  if (step && hasBank && (step.key === 'emergency' || step.key.startsWith('debt-'))) return { title: step.title, detail: step.detail, action: { label: 'Open Wealth', href: '#wealth' } };
  const m = interestMoves(data.loans, effectivePlan(data, start), strategy, { start })[0];
  if (m) return { title: m.title, detail: m.detail, gain: { saved: m.saved, payoffM: m.result.payoffM, sooner: m.sooner }, apply: m };
  return { title: 'You’re on track', detail: 'Your plan already uses every move this app can test. Keep logging payments as you make them.' };
}

export function renderToday(view, ctx) {
  const { data, results, start, strategy, strategyName, hasHistory, save, onApplyMove } = ctx;
  const plan = data.plan, r = results[strategy];
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const grad = ym(plan.gradMonth);

  // hero
  const orig = data.loans.reduce((s, l) => s + (+l.origBalance || (+l.balance || 0) + (+l.unpaid || 0)), 0);
  const paidPct = orig ? Math.max(0, Math.min(1, 1 - r.initTotal / orig)) : 0;
  const end = r.done ? r.payoffM + 1 : null;
  const pin = r.done && grad != null && grad > start && grad < end ? (grad - start) / (end - start) : null;

  // best move and to-dos
  const move = bestMove(data, results, strategy, start);
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
      <section class="card glass move rise" aria-label="Best next move">
        <div class="card-h" style="margin:0"><span class="spark" aria-hidden="true"><svg class="i"><use href="#i-spark"/></svg></span><span class="badge warn">Best next move</span></div>
        <h3>${esc(move.title)}</h3>
        <p class="muted small" style="margin:0">${esc(move.detail)}</p>
        ${move.gain ? `<div class="gain">
          <div><span>Interest saved</span><b class="num pos">${money(move.gain.saved)}</b></div>
          <div><span>Debt-free</span><b class="num">${move.gain.payoffM != null ? ymLabel(move.gain.payoffM) : 'Not yet'}</b></div>
          ${move.gain.sooner > 0 ? `<div><span>Sooner by</span><b class="num">${dur(move.gain.sooner)}</b></div>` : ''}</div>` : '<div style="height:14px"></div>'}
        <div class="actions">${move.apply ? '<a class="btn soft" href="#plan">See the plan</a><button class="btn primary" type="button" data-try>Try it</button>' : move.action ? `<a class="btn primary" href="${move.action.href}">${esc(move.action.label)}</a>` : ''}</div>
      </section>

      <section class="card glass rise" aria-label="To-dos">
        <div class="card-h"><h2>This month’s to-dos</h2><span class="muted small">${open.length ? `${open.length} open` : todos.length ? 'All done' : ''}</span></div>
        ${todos.length ? `<div class="todos">${[...open, ...closed].map(t => `
          <label class="todo ${done.has(t.key) ? 'done' : ''}"><input type="checkbox" data-todo="${esc(t.key)}" ${done.has(t.key) ? 'checked' : ''}><span>${md(t.text)}</span></label>`).join('')}</div>`
          : '<p class="muted small" style="margin:0">Nothing needs your attention this month. Reminders show up here when a rate needs checking, repayment is about to start, or a balance is getting old.</p>'}
      </section>
    </div>`;

  view.querySelector('[data-try]')?.addEventListener('click', () => onApplyMove(move.apply));
  view.querySelectorAll('[data-todo]').forEach(cb => cb.addEventListener('change', () => {
    const keys = new Set(plan.dismissed?.[monthKey] || []);
    cb.checked ? keys.add(cb.dataset.todo) : keys.delete(cb.dataset.todo);
    const t = todos.find(x => x.key === cb.dataset.todo);
    const dismissed = { [monthKey]: [...keys] }; // keep only this month; older months no longer matter
    save({ ...data, plan: { ...plan, dismissed } }, `${cb.checked ? 'Checked off' : 'Reopened'}: ${t.text.replace(/\*\*/g, '').slice(0, 80)}`, cb.checked ? 'Checked off' : 'Reopened');
  }));
  return {};
}
