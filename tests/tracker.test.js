// Real money tracker tests. Made-up data only.
import { test, eq, near, ok } from './harness.js';
import { ledger, balances, monthSummary, applyCheckin, lastSunday, checkinDue, UNLOGGED } from '../js/tracker.js';
import { defaultPlan } from '../js/engine.js';

const bank = (id, balance, updatedAt) => ({ id, name: id, kind: 'bank', balance, updatedAt, history: [{ date: updatedAt, balance }] });
const tx = (date, amount, dir, category = 'Food', extra = {}) => ({ id: `t${date}${amount}${dir}`, date, amount, dir, category, note: '', kind: 'logged', createdAt: `${date}T12:00:00Z`, ...extra });
const base = () => ({
  loans: [], scenarios: [], checkins: [],
  accounts: [bank('chk', 1000, '2026-11-01'), bank('sav', 2000, '2026-11-01'), { id: 'rh', name: 'Robinhood', kind: 'brokerage', balance: 500, updatedAt: '2026-11-03' }],
  payments: [{ id: 'p1', loanId: 'x', loanName: 'Private A', date: '2026-11-05', amount: 100 }],
  plan: { ...defaultPlan(), planned: [{ id: 'tu', label: 'Spring tuition', amount: 3000, month: '2027-01', paidOn: '' }] },
  transactions: [tx('2026-10-30', 40, 'out'), tx('2026-11-02', 60, 'out'), tx('2026-11-03', 250, 'in', 'Paycheck'), tx('2026-11-01', 20, 'out')],
});

test('the ledger merges logs, loan payments and paid planned costs, newest first', () => {
  const d = base(); d.plan.planned[0].paidOn = '2026-11-04';
  const l = ledger(d);
  eq(l.length, 6); eq(l[0].source, 'payment'); eq(l[1].source, 'planned'); eq(l[1].category, 'Planned cost');
});

test('estimated = last confirmed bank balance + what was logged after that date', () => {
  const b = balances(base());
  eq(b.real, 3000, 'banks only, not Robinhood;'); eq(b.asOf, '2026-11-01');
  eq(b.inSince, 250); eq(b.outSince, 160, 'Nov 2 food + Nov 5 loan payment; the Nov 1 entry is already in the balance;');
  eq(b.estimated, 3090);
});

test('month summary totals in, out and spending by category', () => {
  const s = monthSummary(base(), '2026-11');
  eq(s.in, 250); eq(s.out, 180); eq(s.net, 70);
  eq(s.byCategory[0].category, 'Loan payment'); eq(s.byCategory[1].category, 'Food'); eq(s.byCategory[1].amount, 80);
});

test('a check-in confirms balances and turns the gap into one Unlogged entry', () => {
  const d = base();
  const r = applyCheckin(d, { chk: 940, sav: 2000 }, '2026-11-08', { now: new Date('2026-11-08T16:00:00Z') });
  eq(r.estimated, 3090); eq(r.real, 2940); eq(r.gap, -150);
  const u = r.data.transactions.find(t => t.kind === 'unlogged');
  eq(u.category, UNLOGGED); eq(u.dir, 'out'); eq(u.amount, 150); eq(u.date, '2026-11-08');
  eq(r.data.checkins.length, 1); eq(r.data.accounts.find(a => a.id === 'chk').history.length, 2);
  const after = balances(r.data);
  eq(after.real, 2940); eq(after.estimated, 2940, 'nothing logged since the check-in;');
  eq(monthSummary(r.data, '2026-11').unloggedOut, 150);
});

test('a matching check-in adds no Unlogged entry, and the first ever check-in has nothing to compare', () => {
  const d = base();
  eq(applyCheckin(d, { chk: 1090, sav: 2000 }, '2026-11-08').gap, 0);
  const fresh = { ...d, accounts: [{ id: 'chk', name: 'chk', kind: 'bank', balance: 0, updatedAt: '', history: [] }] };
  const r = applyCheckin(fresh, { chk: 1200 }, '2026-11-08');
  eq(r.gap, 0); eq(r.data.transactions.filter(t => t.kind === 'unlogged').length, 0);
});

test('a check-in is due once the real balance is older than the most recent Sunday', () => {
  eq(lastSunday(new Date('2026-11-04T12:00:00')), '2026-11-01');
  eq(lastSunday(new Date('2026-11-08T09:00:00')), '2026-11-08');
  eq(checkinDue(base(), new Date('2026-11-04T12:00:00')), false);
  eq(checkinDue(base(), new Date('2026-11-08T12:00:00')), true);
  eq(checkinDue({ accounts: [] }, new Date('2026-11-08T12:00:00')), false, 'no bank account, nothing to check;');
});
