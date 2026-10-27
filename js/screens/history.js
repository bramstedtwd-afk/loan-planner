// History: every logged payment, newest first, grouped by month.
import { money, esc } from '../format.js';

export function renderHistory(view, ctx) {
  const { data, colorOf } = ctx;
  const ps = [...data.payments].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''));
  const sum = k => ps.reduce((s, p) => s + (+p[k] || 0), 0);
  const groups = {};
  for (const p of ps) (groups[p.date.slice(0, 7)] ||= []).push(p);
  const monthName = k => new Date(`${k}-15`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  view.innerHTML = `
    <header class="topbar"><div><h1>History</h1></div><button class="btn primary" type="button" data-log style="height:40px">Log a payment</button></header>
    ${ps.length ? `
    <section class="card glass rise">
      <div class="totals">
        <div><span>Paid so far</span><b class="num">${money(sum('amount'), true)}</b></div>
        <div><span>To principal</span><b class="num">${money(sum('principal'), true)}</b></div>
        <div><span>To interest</span><b class="num">${money(sum('interest'), true)}</b></div>
      </div>
    </section>
    ${Object.entries(groups).map(([k, list]) => `
      <section class="card glass rise">
        <div class="card-h"><h2>${monthName(k)}</h2><span class="muted small num">${money(list.reduce((s, p) => s + p.amount, 0), true)}</span></div>
        <div class="rows">${list.map(p => `
          <div class="row"><span class="dotc" style="background:${colorOf(p.loanId)}"></span>
            <div class="name"><b>${esc(data.loans.find(l => l.id === p.loanId)?.name || p.loanName || 'Removed loan')}</b>
              <small>${new Date(p.date + 'T12:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${money(p.interest, true)} interest · ${money(p.principal, true)} principal${p.note ? ` · ${esc(p.note)}` : ''}</small></div>
            <div class="right"><span class="amt num">${money(p.amount, true)}</span><button class="link danger" type="button" data-remove="${esc(p.id)}">Remove</button></div>
          </div>`).join('')}</div>
      </section>`).join('')}`
    : `<section class="card glass empty"><h2>No payments logged yet</h2><p>Log each payment as you make it. Your balances update, and the plan moves forward.</p></section>`}`;
  view.querySelector('[data-log]').addEventListener('click', ctx.onLogPayment);
  view.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => {
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Tap to confirm'; return; }
    ctx.onRemovePayment(data.payments.find(p => p.id === b.dataset.remove));
  }));
}
