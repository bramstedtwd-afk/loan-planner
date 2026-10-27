// Wealth math tests. Made-up data only.
import { test, eq, near, ok } from './harness.js';
import { netWorth, emergencyFund, recommendRoute, nextDollar, spareCash, effectivePlan } from '../js/wealth.js';
import { defaultPlan, ym, simulate } from '../js/engine.js';

const START = ym('2026-10');
const opts = { start: START };
const loan = o => ({ unpaid: 0, minPayment: 0, repayStart: '', asOf: '2026-10-01', termMonths: 120, ...o });
const loans = () => [
  loan({ id: 'priv', name: 'Private 10%', kind: 'private', balance: 8000, rate: 10 }),
  loan({ id: 'small', name: 'Small fed', kind: 'fed_unsub', balance: 900, rate: 5 }),
  loan({ id: 'fed', name: 'Federal 6.5%', kind: 'fed_unsub', balance: 6000, rate: 6.5 }),
];
const plan = (o = {}) => ({ ...defaultPlan(), incomes: [{ amount: 2000, per: 'month', start: '2026-01' }], expenses: [{ amount: 1200, start: '2026-01' }], ...o });
const acct = (id, kind, balance, extra = {}) => ({ id, name: id, kind, balance, ...extra });

test('net worth adds assets and subtracts every debt, student loans included', () => {
  const n = netWorth([acct('c', 'bank', 3000), acct('b', 'brokerage', 1500), acct('r', 'retirement', 500), acct('cc', 'debt', 700)], loans());
  eq(n.cash, 3000); eq(n.assets, 5000); eq(n.studentLoans, 14900); eq(n.debts, 15600); eq(n.net, -10600);
});

test('the emergency fund uses the highest costs in the next 12 months', () => {
  const p = plan({ expenses: [{ amount: 1000, start: '2026-01', end: '2027-03' }, { amount: 1500, start: '2027-04' }] });
  const e = emergencyFund([acct('c', 'bank', 5000)], p, START);
  eq(e.monthlyCosts, 1500); eq(e.target, 4500); eq(e.surplus, 500); eq(e.funded, true); near(e.runwayMonths, 5000 / 1500, 1e-9);
  const short = emergencyFund([acct('c', 'bank', 1000)], p, START);
  eq(short.gap, 3500); eq(short.funded, false);
});

test('the best route uses what is left after costs plus cash above the emergency fund', () => {
  const rec = recommendRoute({ loans: loans(), plan: plan(), accounts: [acct('c', 'bank', 5730)] }, opts);
  eq(rec.monthly, 800, 'income − costs;');
  eq(rec.emergency.target, 3600); eq(rec.lumpNow, 2100, 'surplus 2,130 rounded down to $50;');
  eq(rec.plan.extraMonthly, 0); eq(rec.plan.share, 100);
  ok(effectivePlan({ loans: loans(), plan: rec.plan, accounts: [acct('c', 'bank', 5730)] }, START).lumps.some(l => l.amount === 2100 && l.month === '2026-10'), 'cash goes in this month');
  ok(rec.result.done, 'pays off');
  for (const id of Object.keys(rec.results)) if (id !== 'minimum' && rec.results[id].done) ok(rec.result.totalInterest <= rec.results[id].totalInterest + 1, `best beats ${id}`);
});

test('ties go to the option that keeps federal loans longest', () => {
  // One private loan at the top rate: avalanche and private-first make identical choices.
  const ls = [loan({ id: 'p', name: 'P', kind: 'private', balance: 5000, rate: 9 }), loan({ id: 'f', name: 'F', kind: 'fed_unsub', balance: 5000, rate: 5 })];
  const rec = recommendRoute({ loans: ls, plan: plan(), accounts: [] }, opts);
  near(rec.results.avalanche.totalInterest, rec.results.private.totalInterest, 1);
  eq(rec.best, 'private');
});

test('every alternative says why you might pick it and what it costs', () => {
  const rec = recommendRoute({ loans: loans(), plan: plan(), accounts: [] }, opts);
  ok(rec.alternatives.length >= 3);
  for (const a of rec.alternatives) { ok(a.why.length > 20, `${a.id} has a reason`); ok(a.cost.length > 5, `${a.id} has a cost`); ok(a.deltaInterest >= -1, `${a.id} is not cheaper than the best`); }
  const snow = rec.alternatives.find(a => a.id === 'snowball');
  ok(/Small fed is fully paid off by/.test(snow.why), snow.why);
  ok(/keeping about \$\d/.test(rec.alternatives.find(a => a.id === 'minimum').why));
});

test('a plan that spends more than is left after costs is flagged as relying on savings', () => {
  const rec = recommendRoute({ loans: loans(), plan: plan({ extraMonthly: 500 }), accounts: [] }, opts);
  eq(rec.relyOnSavings, true);
  const ok2 = recommendRoute({ loans: loans(), plan: plan(), accounts: [] }, opts);
  eq(ok2.relyOnSavings, false);
});

test('no spare cash means no lump sum, and cash is never more than what is owed', () => {
  eq(recommendRoute({ loans: loans(), plan: plan(), accounts: [acct('c', 'bank', 3600)] }, opts).lumpNow, 0);
  const rich = recommendRoute({ loans: [loan({ id: 'x', name: 'X', kind: 'private', balance: 1000, rate: 8 })], plan: plan(), accounts: [acct('c', 'bank', 50000)] }, opts);
  eq(rich.lumpNow, 1000);
});

test('applying the route uses spare cash live, so it is never counted twice', () => {
  const d = { loans: loans(), plan: plan(), accounts: [acct('c', 'bank', 5730)] };
  const first = recommendRoute(d, opts);
  eq(first.plan.useSpareCash, true); eq(first.plan.lumps.length, 0, 'no stored payment;');
  const applied = { ...d, plan: first.plan };
  eq(effectivePlan(applied, START).lumps[0].amount, 2100, 'spare cash goes in this month;');
  const again = recommendRoute(applied, opts);
  near(again.result.totalInterest, first.result.totalInterest, 1e-6, 'same route after applying;');
  near(again.current.totalInterest, first.result.totalInterest, 1e-6, 'your plan now matches it;');
  // You pay the $2,100 and your bank balance drops: spare cash is gone, nothing is counted twice.
  const paid = { ...applied, accounts: [acct('c', 'bank', 3630)] };
  eq(spareCash(paid, START), 0); eq(effectivePlan(paid, START).lumps.length, 0);
});

test('the recommended plan reproduces the projected result', () => {
  const d = { loans: loans(), plan: plan(), accounts: [acct('c', 'bank', 5000)] };
  const rec = recommendRoute(d, opts);
  near(simulate(d.loans, effectivePlan({ ...d, plan: rec.plan }, START), rec.best, opts).totalInterest, rec.result.totalInterest, 1e-6);
});

test('next dollar: emergency fund first when it is short', () => {
  const steps = nextDollar({ loans: loans(), plan: plan(), accounts: [acct('c', 'bank', 1000)] }, opts);
  eq(steps[0].key, 'emergency'); eq(steps[0].status, 'now'); eq(steps[0].amount, 2600);
});

test('next dollar: high-rate debt, then loans above the assumed return; match waits until known', () => {
  const steps = nextDollar({ loans: loans(), plan: plan(), accounts: [acct('c', 'bank', 9000), acct('cc', 'debt', 700, { rate: 24 })] }, opts);
  eq(steps[0].status, 'done');
  eq(steps[1].key, 'debt-cc'); eq(steps[1].status, 'now');
  eq(steps.find(s => s.key === 'match').status, 'later');
  const l = steps.find(s => s.key === 'loans');
  ok(/Private 10%/.test(l.detail) && /Federal 6.5%/.test(l.detail) && !/Small fed/.test(l.detail), l.detail);
  ok(/Small fed/.test(steps.find(s => s.key === 'invest').detail));
});

test('next dollar: a known employer match ranks before extra loan payments', () => {
  const steps = nextDollar({ loans: loans(), plan: plan({ employerMatch: { percent: 4 } }), accounts: [acct('c', 'bank', 9000)] }, opts);
  const keys = steps.map(s => s.key);
  ok(keys.indexOf('match') < keys.indexOf('loans'));
  eq(steps.find(s => s.key === 'match').status, 'now');
});
