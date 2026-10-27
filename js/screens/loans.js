// Loans: every loan with its balance, rate, minimum and payoff month; tap one to edit; add new ones; set graduation.
import { ym, ymStr, ymLabel, isFed, KINDS, dailyInterest, cashFlow } from '../engine.js';
import { money, esc, pct, todayISO } from '../format.js';
import { formSheet } from '../ui/form-sheet.js';
import { header, subnav } from '../ui/layout.js';

const owedOf = l => (+l.balance || 0) + (+l.unpaid || 0);

// What to send each servicer this month, and why the extra goes where it does.
const WHY = { avalanche: 'Highest rate, so extra goes here first', snowball: 'Smallest balance, so extra goes here first', private: 'Private loan, cleared before federal', custom: 'First in your custom order' };
function thisMonthCard(data, r, start, colorOf) {
  const row = r?.rows[0];
  if (!row) return '';
  const plan = data.plan, st = r.strategy, cf = cashFlow(plan, start), extra = +plan.extraMonthly || 0;
  const minOf = id => r.loans.find(l => l.id === id)?.min || 0;
  const paying = data.loans.filter(l => row.pay[l.id] > 0.005);
  const idle = data.loans.filter(l => (row.bal[l.id] ?? 0) > 0.005 && !(row.pay[l.id] > 0.005));
  const idleRepay = idle.map(l => ym(l.repayStart)).filter(m => m != null && m > start);
  const how = cf.inc.length ? `${money(cf.income)} in − ${money(cf.costs)} costs${cf.share < 100 ? ` × ${cf.share}%` : ''}${extra ? `, plus ${money(extra)} extra` : ''}${row.lump ? `, plus ${money(row.lump)} one-time` : ''}` : extra ? `Your ${money(extra)} monthly extra` : 'Only the minimums are due';
  const monthName = new Date(Math.floor(start / 12), start % 12, 1).toLocaleDateString('en-US', { month: 'long' });
  const logged = (data.payments || []).filter(p => String(p.date).startsWith(ymStr(start))).reduce((s, p) => s + (+p.amount || 0), 0);
  const left = Math.max(0, row.paid - logged);
  return `<section class="card glass rise" aria-label="This month">
    <div class="card-h"><h2>${monthName} payment</h2><span class="badge">${logged ? `${money(logged)} logged` : `${paying.length} loan${paying.length === 1 ? '' : 's'}`}</span></div>
    <div class="big num">${logged && left < 0.5 ? '✓ Sent' : money(logged ? left : row.paid)}</div>
    ${logged ? `<p class="small" style="margin:6px 0 0;color:var(--good);font-weight:600">${left < 0.5 ? `You’ve logged ${money(logged)} this month, which covers the plan.` : `${money(logged)} logged so far; ${money(left)} still to send.`}</p>` : ''}
    <p class="muted small" style="margin:6px 0 6px">${how}</p>
    <div class="rows">
      ${paying.map(l => { const p = row.pay[l.id], gotExtra = p > Math.min(minOf(l.id), p) + 0.005 && st !== 'minimum';
        return `<div class="row"><span class="dotc" style="background:${colorOf(l.id)}"></span><div class="name"><b>${esc(l.name)}</b><small>${gotExtra ? WHY[st] : 'Minimum payment'}</small></div><span class="amt num">${money(p, p % 1 > 0.004)}</span></div>`; }).join('')}
      ${idle.length ? `<div class="row"><span class="dotc" style="background:var(--s-other)"></span><div class="name"><b>${idle.length} other loan${idle.length === 1 ? '' : 's'}</b><small>${idleRepay.length === idle.length ? `In school or grace until ${ymLabel(Math.min(...idleRepay))}, nothing due` : 'Nothing due this month'}</small></div><span class="amt num muted">$0</span></div>` : ''}
    </div>
    <button class="btn primary block" type="button" data-log style="margin-top:12px"><svg class="i"><use href="#i-send"/></svg>Log a payment</button>
  </section>`;
}

export function renderLoans(view, ctx) {
  const { data, result: r, start, colorOf, save, onLogPayment } = ctx;
  const loans = data.loans;
  const total = loans.reduce((s, l) => s + owedOf(l), 0);
  const orig = loans.reduce((s, l) => s + (+l.origBalance || owedOf(l)), 0);
  const avgRate = total ? loans.reduce((s, l) => s + owedOf(l) * (+l.rate || 0), 0) / total : 0;
  const grad = data.plan.gradMonth;
  const rowFor = l => {
    const sl = r?.loans.find(x => x.id === l.id), owed = owedOf(l), o = +l.origBalance || owed;
    const repay = ym(l.repayStart);
    const status = owed < 0.005 ? 'Paid off ✓'
      : repay != null && repay > start ? `${l.kind === 'fed_sub' ? 'No interest' : 'Interest building'} until ${ymLabel(repay)}`
      : sl?.paidOff != null && sl.paidOff >= start ? `On track to finish ${ymLabel(sl.paidOff)}` : 'Not paid off within 40 years';
    const min = +l.minPayment || (sl?.min ? sl.min : 0);
    return `<button class="row" type="button" data-edit="${esc(l.id)}">
      <span class="dotc" style="background:${colorOf(l.id)}"></span>
      <div class="name"><b>${esc(l.name)}<span class="tag ${isFed(l.kind) ? 'fed' : ''}">${esc(KINDS[l.kind]?.short || l.kind)}</span></b>
        <small>${esc([l.servicer, status].filter(Boolean).join(' · '))}${min ? ` · ${money(min, true)}/mo${l.minPayment ? '' : ' est.'}` : ''}</small>
        <div class="bar"><i style="width:${(o ? Math.max(0, 1 - owed / o) * 100 : 100).toFixed(1)}%;background:${colorOf(l.id)}"></i></div></div>
      <div class="right"><span class="amt num">${money(owed, true)}</span><span class="badge ${+l.rate >= 9 ? 'warn' : ''}">${pct(l.rate)}</span></div>
      <svg class="i chev" aria-hidden="true"><use href="#i-send"/></svg></button>`;
  };
  const priv = loans.filter(l => !isFed(l.kind)), fed = loans.filter(l => isFed(l.kind));
  view.innerHTML = `
    ${header({ title: 'Loans' })}
    ${subnav([['loans', 'Loans'], ['activity', 'Activity']], 'loans', 'Loans views')}
    ${thisMonthCard(data, r, start, colorOf)}
    <section class="card glass rise">
      <div class="tiles">
        <div class="tile"><span>Total owed</span><b class="num">${money(total)}</b></div>
        <div class="tile accent"><span>Paid down</span><b class="num">${money(Math.max(0, orig - total))}</b></div>
        <div class="tile"><span>Average rate</span><b class="num">${avgRate.toFixed(2)}%</b></div>
        <div class="tile"><span>Interest / day</span><b class="num">${money(dailyInterest(loans, start), true)}</b></div>
      </div>
    </section>
    ${[['Private loans', priv], ['Federal loans', fed]].filter(([, ls]) => ls.length).map(([t, ls]) => `
      <section class="card glass rise">
        <div class="card-h"><h2>${t}</h2><span class="muted small num">${money(ls.reduce((s, l) => s + owedOf(l), 0))}</span></div>
        <div class="rows">${ls.map(rowFor).join('')}</div>
      </section>`).join('')}
    <section class="card glass rise">
      <div class="card-h"><h2>Add or update</h2></div>
      <p class="muted small" style="margin:0 0 12px">Copy balances from your servicer: studentaid.gov for federal loans, your lender’s site for private ones. Logging a payment updates the balance for you.</p>
      <div class="add-row"><button class="btn primary" type="button" data-add>Add a loan</button><button class="btn soft" type="button" data-grad>${grad ? `Graduation: ${ymLabel(ym(grad))}` : 'Set graduation month'}</button></div>
    </section>`;

  view.querySelector('[data-add]').addEventListener('click', () => editLoan(null));
  view.querySelector('[data-log]')?.addEventListener('click', onLogPayment);
  view.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editLoan(loans.find(l => l.id === b.dataset.edit))));
  view.querySelector('[data-grad]').addEventListener('click', () => {
    formSheet({
      title: 'Graduation month',
      intro: 'Federal Direct loans start repayment 6 months after you leave school. This sets that start on every federal loan.',
      fields: [{ name: 'grad', label: 'Graduating', type: 'month', value: grad, required: true }],
      submitLabel: 'Update federal loans',
      onSubmit: v => {
        const repay = ymStr(ym(v.grad) + 6);
        const next = { ...data, plan: { ...data.plan, gradMonth: v.grad }, loans: data.loans.map(l => isFed(l.kind) ? { ...l, repayStart: repay } : l) };
        save(next, `Graduation set to ${ymLabel(ym(v.grad))}; federal repayment starts ${ymLabel(ym(repay))}`, `Federal repayment now starts ${ymLabel(ym(repay))}`);
      },
    });
  });

  function editLoan(l) {
    const isNew = !l;
    l = l || { kind: 'fed_unsub', asOf: todayISO(), repayStart: grad ? ymStr(ym(grad) + 6) : '' };
    formSheet({
      title: isNew ? 'Add a loan' : 'Edit loan',
      fields: [
        { name: 'name', label: 'Name', value: l.name, required: true, maxlength: 60, placeholder: 'Direct Unsub 2025' },
        { name: 'servicer', label: 'Servicer or lender', value: l.servicer, half: true, maxlength: 60, placeholder: 'MOHELA' },
        { name: 'kind', label: 'Type', type: 'select', value: l.kind, half: true, options: Object.entries(KINDS).map(([k, v]) => [k, v.label]) },
        { name: 'balance', label: 'Principal', type: 'number', value: l.balance, prefix: '$', min: 0, step: 0.01, required: true, half: true },
        { name: 'unpaid', label: 'Unpaid interest', type: 'number', value: l.unpaid || 0, prefix: '$', min: 0, step: 0.01, half: true },
        { name: 'rate', label: 'Interest rate', type: 'number', value: l.rate, suffix: '%', min: 0, max: 40, step: 0.001, required: true, half: true },
        { name: 'minPayment', label: 'Monthly minimum', hint: 'blank = estimate', type: 'number', value: l.minPayment || '', prefix: '$', min: 0, step: 0.01, half: true },
        { name: 'termMonths', label: 'Repayment term', hint: 'months', type: 'number', value: l.termMonths || '', min: 1, max: 360, step: 1, placeholder: '120', half: true },
        { name: 'repayStart', label: 'Repayment starts', type: 'month', value: l.repayStart, half: true },
        { name: 'asOf', label: 'Balance as of', type: 'date', value: l.asOf, half: true, required: true },
        { name: 'notes', label: 'Notes', value: l.notes, maxlength: 160, placeholder: 'Variable rate, autopay on…' },
      ],
      submitLabel: isNew ? 'Add loan' : 'Save',
      onSubmit: v => {
        const loan = { ...l, ...v, balance: +v.balance || 0, unpaid: +v.unpaid || 0, rate: +v.rate || 0, minPayment: +v.minPayment || 0, termMonths: Math.round(+v.termMonths || 0) };
        if (isNew) { loan.id = `l${Date.now().toString(36)}`; loan.order = Math.max(0, ...data.loans.map(x => x.order ?? 0)) + 1; }
        loan.origBalance = Math.max(+l.origBalance || 0, loan.balance + loan.unpaid);
        const next = { ...data, loans: isNew ? [...data.loans, loan] : data.loans.map(x => x.id === loan.id ? loan : x) };
        save(next, isNew ? `Added loan ${loan.name}` : `Updated ${loan.name}`, isNew ? `${loan.name} added` : `${loan.name} saved`);
      },
      onDelete: isNew ? null : () => {
        const next = { ...data, loans: data.loans.filter(x => x.id !== l.id), plan: { ...data.plan, customOrder: (data.plan.customOrder || []).filter(id => id !== l.id) } };
        save(next, `Deleted loan ${l.name}`, `${l.name} deleted`);
      },
      deleteLabel: 'Delete loan',
    });
  }
}
