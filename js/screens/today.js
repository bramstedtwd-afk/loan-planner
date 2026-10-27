// Today: when you'll be debt-free, what to pay this month, the best next move, and where each loan stands.
import { ym, ymLabel, cashFlow, dailyInterest, isFed } from '../engine.js';
import { money, dur, esc, pct } from '../format.js';
import { balanceArea } from '../charts.js';

const WHY = {
  avalanche: 'Highest rate, so extra goes here first',
  snowball: 'Smallest balance, so extra goes here first',
  private: 'Private loan, cleared before federal',
  custom: 'First in your custom order',
};

export function renderToday(view, ctx) {
  const { data, results, moves, start, colorOf, syncLabel } = ctx;
  const plan = data.plan, st = plan.strategy, r = results[st];
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const grad = ym(plan.gradMonth);

  // hero
  const orig = data.loans.reduce((s, l) => s + (+l.origBalance || (+l.balance || 0) + (+l.unpaid || 0)), 0);
  const paidPct = orig ? Math.max(0, Math.min(1, 1 - r.initTotal / orig)) : 0;
  const end = r.done ? r.payoffM + 1 : null;
  const pin = r.done && grad != null && grad > start && grad < end ? (grad - start) / (end - start) : null;
  const hero = `
    <section class="hero rise" aria-label="Debt-free date">
      <div class="k"><span>Debt-free</span><span class="chip">${esc(ctx.strategyName)}</span></div>
      <div class="when num">${r.done ? ymLabel(r.payoffM) : 'Not yet'}</div>
      <p class="sub">${r.done ? `${r.payoffM > start ? `${dur(r.payoffM - start)} away · ` : ''}${r.months} monthly payment${r.months === 1 ? '' : 's'}` : 'Your payments don’t cover the interest yet. Add income or an extra amount.'}</p>
      <div class="timeline">
        <div class="track" role="img" aria-label="${Math.round(paidPct * 100)}% of your original balance paid off"><div class="fill" style="width:${(paidPct * 100).toFixed(1)}%"></div>${pin != null ? `<span class="pin" style="left:${(pin * 100).toFixed(1)}%"></span>` : ''}</div>
        <div class="ticks"><span>${paidPct >= 0.01 ? `${Math.round(paidPct * 100)}% paid` : 'Now'}</span>${pin != null ? `<span class="at" style="left:${(pin * 100).toFixed(1)}%">Graduate ${ymLabel(grad).replace(/ 20(\d\d)$/, ' ’$1')}</span>` : ''}<span>Free</span></div>
      </div>
      <div class="stats">
        <div class="stat"><span>Owed</span><b class="num">${money(r.initTotal)}</b></div>
        <div class="stat"><span>Interest left</span><b class="num">${money(r.totalInterest)}</b></div>
        <div class="stat"><span>Interest / day</span><b class="num">${money(dailyInterest(data.loans, start), true)}</b></div>
      </div>
    </section>`;

  // this month
  const row = r.rows[0];
  const cf = cashFlow(plan, start), extra = +plan.extraMonthly || 0;
  const how = cf.inc.length
    ? `${money(cf.income)} in − ${money(cf.costs)} costs${cf.share < 100 ? ` × ${cf.share}%` : ''}${extra ? `, plus your ${money(extra)} extra` : ''}`
    : extra ? `Your ${money(extra)} monthly extra` : 'Only the minimums are due';
  const minOf = id => r.loans.find(l => l.id === id)?.min || 0;
  const paying = data.loans.filter(l => row?.pay[l.id] > 0.005);
  const idle = data.loans.filter(l => (row?.bal[l.id] ?? 0) > 0.005 && !(row?.pay[l.id] > 0.005));
  const idleRepay = idle.map(l => ym(l.repayStart)).filter(m => m != null && m > start);
  const month = row ? ymLabel(row.m).split(' ')[0] : '';
  const monthMonths = { Jan: 'January', Feb: 'February', Mar: 'March', Apr: 'April', May: 'May', Jun: 'June', Jul: 'July', Aug: 'August', Sep: 'September', Oct: 'October', Nov: 'November', Dec: 'December' };
  const thisMonth = row ? `
    <section class="card glass rise" aria-label="This month">
      <div class="card-h"><h2>${monthMonths[month]} payment</h2><span class="badge">${paying.length} loan${paying.length === 1 ? '' : 's'}</span></div>
      <div class="big num">${money(row.paid)}</div>
      <p class="muted small" style="margin:6px 0 6px">${how}</p>
      <div class="rows">
        ${paying.map(l => {
          const p = row.pay[l.id], gotExtra = p > Math.min(minOf(l.id), p) + 0.005 && st !== 'minimum';
          return `<div class="row"><span class="dotc" style="background:${colorOf(l.id)}"></span><div class="name"><b>${esc(l.name)}</b><small>${gotExtra ? WHY[st] : 'Minimum payment'}</small></div><span class="amt num">${money(p, p % 1 > 0.004)}</span></div>`;
        }).join('')}
        ${idle.length ? `<div class="row"><span class="dotc" style="background:var(--s-other)"></span><div class="name"><b>${idle.length} other loan${idle.length === 1 ? '' : 's'}</b><small>${idleRepay.length === idle.length ? `In school or grace until ${ymLabel(Math.min(...idleRepay))}, nothing due` : 'Nothing due this month'}</small></div><span class="amt num muted">$0</span></div>` : ''}
      </div>
      <button class="btn primary block" type="button" data-log style="margin-top:12px"><svg class="i"><use href="#i-send"/></svg>Log this payment</button>
    </section>` : '';

  // best next move
  const m = moves[0];
  const move = m ? `
    <section class="card glass move rise" aria-label="Best next move">
      <div class="card-h" style="margin:0"><span class="spark" aria-hidden="true"><svg class="i"><use href="#i-spark"/></svg></span><span class="badge warn">Best next move</span></div>
      <h3>${esc(m.title)}</h3>
      <p class="muted small" style="margin:0">${esc(m.detail)}</p>
      <div class="gain">
        <div><span>Interest saved</span><b class="num pos">${money(m.saved)}</b></div>
        <div><span>Debt-free</span><b class="num">${m.result.done ? ymLabel(m.result.payoffM) : 'Not yet'}</b></div>
        ${m.sooner > 0 ? `<div><span>Sooner by</span><b class="num">${dur(m.sooner)}</b></div>` : ''}
      </div>
      <div class="actions"><a class="btn soft" href="#plan">See all moves</a><button class="btn primary" type="button" data-try>Try it</button></div>
    </section>` : `
    <section class="card glass rise"><div class="card-h"><h2>Best next move</h2></div><p class="muted" style="margin:0">You’re already on the fastest plan this app can test. Add income in Money to see more options.</p></section>`;

  // loans, highest rate first; several federal loans collapse into one row
  const fed = data.loans.filter(l => isFed(l.kind)), groupFed = fed.length > 2;
  const items = [...data.loans.filter(l => !groupFed || !isFed(l.kind)).map(l => ({ ids: [l.id], name: l.name, loans: [l] })),
    ...(groupFed ? [{ ids: fed.map(l => l.id), name: `${fed.length} federal Direct loans`, loans: fed }] : [])];
  const owedOf = ls => ls.reduce((s, l) => s + (+l.balance || 0) + (+l.unpaid || 0), 0);
  const rates = ls => { const rs = ls.map(l => +l.rate); const lo = Math.min(...rs), hi = Math.max(...rs); return lo === hi ? pct(lo) : `${pct(lo)}–${pct(hi)}`; };
  items.sort((a, b) => Math.max(...b.loans.map(l => +l.rate)) - Math.max(...a.loans.map(l => +l.rate)));
  const loans = `
    <section class="card glass rise" aria-label="Loans">
      <div class="card-h"><h2>Loans</h2><a class="more" href="#loans">All ${data.loans.length}</a></div>
      <div class="rows">${items.map(it => {
        const owed = owedOf(it.loans), o = it.loans.reduce((s, l) => s + (+l.origBalance || (+l.balance || 0) + (+l.unpaid || 0)), 0);
        const done = Math.max(...it.ids.map(id => r.loans.find(x => x.id === id)?.paidOff ?? -1));
        const firstRepay = Math.min(...it.loans.map(l => ym(l.repayStart) ?? start));
        const note = owed < 0.005 ? 'Paid off' : firstRepay > start && it.loans.length > 1 ? `Repayment starts ${ymLabel(firstRepay)}` : done >= start ? `Paid off ${ymLabel(done)}` : 'Not paid off within 40 years';
        const hi = Math.max(...it.loans.map(l => +l.rate));
        return `<div class="row"><span class="dotc" style="background:${colorOf(it.ids[0])}"></span><div class="name"><b>${esc(it.name)}</b><small>${note}</small><div class="bar"><i style="width:${(o ? Math.max(0, 1 - owed / o) * 100 : 100).toFixed(1)}%;background:${colorOf(it.ids[0])}"></i></div></div>
          <div class="right"><span class="amt num">${money(owed)}</span><span class="badge ${hi >= 9 ? 'warn' : ''}">${rates(it.loans)}</span></div></div>`;
      }).join('')}</div>
    </section>`;

  view.innerHTML = `
    <header class="topbar"><div><div class="date">${today}</div><h1>Today</h1></div><a class="sync glass" href="#settings" data-sync><span class="dot"></span><span data-sync-text>${esc(syncLabel)}</span></a></header>
    ${hero}
    <div class="board">
      <div class="col">${thisMonth}
        <section class="card glass rise" aria-label="Balance"><div class="card-h"><h2>Balance</h2><a class="more" href="#plan">Full timeline</a></div><div class="chartbox" data-chart></div></section>
      </div>
      <div class="col">${move}${loans}</div>
    </div>`;

  const redraw = balanceArea(view.querySelector('[data-chart]'), r, { grad });
  view.querySelector('[data-try]')?.addEventListener('click', () => ctx.onApplyMove(m));
  view.querySelector('[data-log]')?.addEventListener('click', ctx.onLogPayment);
  return { redraw };
}
