// History: monthly check-ins (from the check-in workflow), then every logged payment, newest first, grouped by month.
import { money, esc } from '../format.js';
import { ym, ymLabel } from '../engine.js';
import { header, subnav } from '../ui/layout.js';

function checkinsCard({ checkins }) {
  if (!checkins || checkins.status === 'off') return '';
  const head = `<div class="card-h"><h2>Monthly check-ins</h2>${checkins.issuesUrl ? `<a class="more" href="${esc(checkins.issuesUrl)}" target="_blank" rel="noopener">On GitHub</a>` : ''}</div>`;
  if (checkins.status === 'loading') return `<section class="card glass rise">${head}<p class="muted small" style="margin:0">Loading…</p></section>`;
  const list = [...(checkins.snapshots || [])].reverse();
  if (!list.length) return `<section class="card glass rise">${head}<p class="muted small" style="margin:0">${checkins.status === 'error' ? 'Couldn’t load check-ins right now.' : 'The first check-in arrives on the 1st of the month. It records where you stand and opens a reminder on GitHub.'}</p></section>`;
  return `<section class="card glass rise">${head}<div class="rows">${list.map((s, i) => {
    const prev = list[i + 1], d = prev ? s.owed - prev.owed : 0;
    const mv = prev && prev.payoffMonth && s.payoffMonth ? ym(s.payoffMonth) - ym(prev.payoffMonth) : 0;
    return `<div class="row"><div class="name"><b>${ymLabel(ym(s.month))}</b><small>${s.payoffMonth ? `Debt-free ${ymLabel(ym(s.payoffMonth))}` : 'Not on track'}${mv ? ` · ${Math.abs(mv)} mo ${mv < 0 ? 'sooner' : 'later'}` : ''} · ${money(s.totalInterest)} interest left</small></div>
      <div class="right"><span class="amt num">${money(s.owed)}</span>${prev && Math.abs(d) >= 1 ? `<small class="num" style="color:${d < 0 ? 'var(--good)' : 'var(--crit)'}">${d < 0 ? '↓' : '↑'} ${money(Math.abs(d))}</small>` : ''}</div></div>`;
  }).join('')}</div></section>`;
}

export function renderHistory(view, ctx) {
  const { data, colorOf } = ctx;
  const ps = [...data.payments].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''));
  const sum = k => ps.reduce((s, p) => s + (+p[k] || 0), 0);
  const groups = {};
  for (const p of ps) (groups[p.date.slice(0, 7)] ||= []).push(p);
  const monthName = k => new Date(`${k}-15`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  view.innerHTML = `
    ${header({ title: 'Loans', actions: '<button class="btn primary" type="button" data-log style="height:38px;font-size:14px">Log a payment</button>' })}
    ${subnav([['loans', 'Loans'], ['activity', 'Activity']], 'activity', 'Loans views')}
    ${checkinsCard(ctx)}
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
