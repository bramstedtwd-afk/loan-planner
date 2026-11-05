// Real money tracker tests. Made-up data only.
import { test, eq, near, ok } from './harness.js';
import { ledger, balances, monthSummary, applyCheckin, lastSunday, checkinDue, actualVsPlan, UNLOGGED, occurrences, recurringDue, nextDue, confirmRecurring, budgetStatus, budgetTotal, oddThreshold, unexplained, explainGap } from '../js/tracker.js';
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

test('actual vs plan starts at the first tracked month and keeps loan payments apart', () => {
  const planOf = () => ({ income: 1000, costs: 700 });
  const rows = actualVsPlan(base(), '2026-11', planOf, 6);
  eq(rows.map(r => r.month).join(), '2026-10,2026-11', 'nothing before the first entry;');
  const nov = rows[1];
  eq(nov.spent, 80, 'food only;'); eq(nov.loans, 100); eq(nov.in, 250); eq(nov.planSpent, 700); eq(nov.partial, true);
  eq(actualVsPlan({ accounts: [], plan: {} }, '2026-11', planOf).length, 0);
});

test('recurring: biweekly paycheck and rent on the last day of each month', () => {
  const pay = { id: 'pay', label: 'Paycheck', dir: 'in', amount: 480, cadence: 'biweekly', anchor: '2026-11-13', category: 'Paycheck', variable: true };
  const rent = { id: 'rent', label: 'Rent', dir: 'out', amount: 750, cadence: 'monthly-last', anchor: '2026-11-01', category: 'Housing' };
  eq(occurrences(pay, '2026-11-01', '2026-12-31').join(), '2026-11-13,2026-11-27,2026-12-11,2026-12-25');
  eq(occurrences(rent, '2026-11-01', '2027-03-01').join(), '2026-11-30,2026-12-31,2027-01-31,2027-02-28');
  const d = { ...base(), recurring: [pay, rent] };
  eq(recurringDue(d, '2026-11-12').length, 0, 'nothing before the first payday;');
  const due = recurringDue(d, '2026-11-30');
  eq(due.map(x => `${x.r.id}@${x.due}`).join(), 'pay@2026-11-13,pay@2026-11-27,rent@2026-11-30');
  const d2 = confirmRecurring(d, pay, '2026-11-13', { amount: 512.4 });
  const t = d2.transactions.find(x => x.recurringId === 'pay');
  eq(t.amount, 512.4); eq(t.dir, 'in'); eq(t.category, 'Paycheck'); eq(t.date, '2026-11-13');
  const d3 = confirmRecurring(d2, rent, '2026-11-30', { skip: true });
  eq(recurringDue(d3, '2026-11-30').map(x => x.due).join(), '2026-11-27', 'confirmed and skipped ones are gone;');
  eq(ledger(d3).some(e => e.kind === 'skipped'), false, 'a skip never shows as money;');
  eq(nextDue(pay, '2026-11-14'), '2026-11-27');
});

test('budgets: spent, left, and running hot early in the month', () => {
  const d = base(); d.plan.spendBudgets = { Food: 100, Fun: 50 };
  const s = budgetStatus(d, '2026-11', '2026-11-10');
  const food = s.find(x => x.category === 'Food');
  eq(food.spent, 80); eq(food.left, 20); eq(food.hot, true, '80% spent with a third of the month gone;');
  eq(budgetStatus(d, '2026-11', '2026-11-28').find(x => x.category === 'Food').hot, false);
  eq(budgetTotal(d), 150);
});

test('odd balance: a big gap can be explained by category, the rest stays or is accepted', () => {
  eq(oddThreshold(240, 230), 75); eq(oddThreshold(2000, 1500), 350);
  const r = applyCheckin(base(), { chk: 940, sav: 2000 }, '2026-11-08');
  const u = r.data.transactions.find(t => t.kind === 'unlogged');
  eq(unexplained(r.data).length, 1);
  const e1 = explainGap(r.data, u.id, { Food: 60, Fun: 40 });
  eq(e1.transactions.find(t => t.kind === 'unlogged').amount, 50); eq(e1.transactions.filter(t => t.note === 'Explained at check-in').length, 2);
  eq(monthSummary(e1, '2026-11').out, monthSummary(r.data, '2026-11').out, 'explaining moves money between categories, never changes the total;');
  const e2 = explainGap(e1, u.id, {}, { accept: true });
  eq(unexplained(e2).length, 0); eq(e2.transactions.find(t => t.id === u.id).kind, 'unlogged-ok');
  eq(balances(e2).estimated, balances(r.data).estimated);
});
