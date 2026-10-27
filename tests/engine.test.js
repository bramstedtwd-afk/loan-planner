// Engine tests. Fixtures are made-up loans; real data never goes in this public repo.
import { test, eq, near, ok } from './harness.js';
import {
  ym, ymStr, ymLabel, amort, cashFlow, toMonthly, simulate, simulateAll, migratePlan, splitPayment,
  interestMoves, applyMove, defaultPlan, dailyInterest, WEEKS_PER_MONTH, extraCurve, yearlySummary,
} from '../js/engine.js';

const START = ym('2026-10');
const loan = (o) => ({ id: o.id, name: o.id, kind: 'fed_unsub', balance: 0, unpaid: 0, rate: 0, minPayment: 0, repayStart: '', asOf: '2026-10-01', ...o });
const plan = (o = {}) => ({ ...defaultPlan(), ...o });
const opts = { start: START };

test('month helpers round-trip', () => {
  eq(ym('2026-10'), 2026 * 12 + 9);
  eq(ymStr(ym('2028-05')), '2028-05');
  eq(ymLabel(ym('2029-01')), 'Jan 2029');
  eq(ym(''), null);
});

test('amortization matches the standard formula', () => {
  near(amort(10000, 0.06, 120), 111.02, 0.01);
  near(amort(1200, 0, 12), 100, 1e-9);
  eq(amort(0, 0.05, 120), 0);
});

test('weekly pay converts to monthly at 52/12 weeks', () => {
  near(toMonthly({ amount: 300, per: 'week' }), 300 * WEEKS_PER_MONTH, 1e-9);
  eq(toMonthly({ amount: 900, per: 'month' }), 900);
});

test('cash flow adds overlapping income and counts end months inclusively', () => {
  const p = plan({
    incomes: [
      { amount: 200, per: 'week', start: '2026-10', end: '2027-05' },
      { amount: 1000, per: 'month', start: '2027-05', end: '2027-08' },
    ],
    expenses: [{ amount: 500, start: '2026-10', end: '' }],
    share: 50,
  });
  const may = cashFlow(p, ym('2027-05'));
  near(may.income, 200 * WEEKS_PER_MONTH + 1000, 1e-9);
  near(may.toLoans, (may.income - 500) / 2, 1e-9);
  eq(cashFlow(p, ym('2027-06')).inc.length, 1, 'part-time ended in May;');
  eq(cashFlow(p, ym('2027-09')).income, 0);
  eq(cashFlow(p, ym('2027-09')).toLoans, 0, 'never negative;');
});

test('subsidized loans accrue nothing before repayment; unsubsidized do', () => {
  const r = simulate([
    loan({ id: 'sub', kind: 'fed_sub', balance: 5000, rate: 6, repayStart: '2027-10' }),
    loan({ id: 'uns', kind: 'fed_unsub', balance: 5000, rate: 6, repayStart: '2027-10' }),
  ], plan(), 'minimum', opts);
  near(r.rows[0].interest, 25, 1e-9, 'only the unsubsidized loan accrues (5000 × 6% / 12);');
  eq(r.rows[0].paid, 0, 'nothing due during school/grace;');
});

test('unpaid interest capitalizes when repayment starts, and the minimum uses the loan term', () => {
  const r = simulate([loan({ id: 'p', kind: 'private', balance: 10000, unpaid: 500, rate: 12, repayStart: '2026-12', termMonths: 180 })], plan(), 'minimum', opts);
  const oct = 10000 * 0.01, nov = 10000 * 0.01;
  const capitalized = 10000 + 500 + oct + nov;
  near(r.loans[0].min, amort(capitalized, 0.12, 180), 0.01);
  eq(r.rows[0].paid, 0); eq(r.rows[1].paid, 0);
  near(r.rows[2].interest, capitalized * 0.01, 1e-6, 'December interest is on the capitalized balance;');
});

test('every dollar is accounted for: paid = starting balance + interest', () => {
  const r = simulate([
    loan({ id: 'a', kind: 'private', balance: 8000, unpaid: 300, rate: 9, termMonths: 120 }),
    loan({ id: 'b', kind: 'fed_sub', balance: 4000, rate: 5, repayStart: '2027-06' }),
  ], plan({ incomes: [{ amount: 900, per: 'month', start: '2026-10' }] }), 'avalanche', opts);
  ok(r.done, 'should pay off');
  near(r.totalPaid, r.initTotal + r.totalInterest, 0.05);
});

test('avalanche sends extra to the highest rate; snowball to the smallest balance', () => {
  const loans = [
    loan({ id: 'hi', kind: 'private', balance: 9000, rate: 10, termMonths: 120 }),
    loan({ id: 'lo', kind: 'private', balance: 1000, rate: 4, termMonths: 120 }),
  ];
  const p = plan({ extraMonthly: 500 });
  const av = simulate(loans, p, 'avalanche', opts), sb = simulate(loans, p, 'snowball', opts);
  ok(av.rows[0].pay.hi > av.rows[0].pay.lo, 'avalanche pays the 10% loan most');
  ok(sb.rows[0].pay.lo > sb.rows[0].pay.hi, 'snowball pays the small loan most');
  ok(av.totalInterest < sb.totalInterest, 'avalanche costs less interest');
});

test('avalanche skips a subsidized loan while it is still interest-free', () => {
  const loans = [
    loan({ id: 'sub', kind: 'fed_sub', balance: 3000, rate: 6.5, repayStart: '2028-05' }),
    loan({ id: 'uns', kind: 'fed_unsub', balance: 3000, rate: 5, repayStart: '2028-05' }),
  ];
  const r = simulate(loans, plan({ extraMonthly: 200 }), 'avalanche', opts);
  eq(r.rows[0].pay.sub, undefined, 'subsidized loan gets nothing yet;');
  near(r.rows[0].pay.uns, 200, 1e-9);
});

test('private-first clears private loans before federal', () => {
  const loans = [
    loan({ id: 'fed', kind: 'fed_unsub', balance: 3000, rate: 8 }),
    loan({ id: 'priv', kind: 'private', balance: 3000, rate: 6, termMonths: 120 }),
  ];
  const r = simulate(loans, plan({ extraMonthly: 400 }), 'private', opts);
  ok(r.loans.find(l => l.id === 'priv').paidOff < r.loans.find(l => l.id === 'fed').paidOff);
});

test('minimums only ignores extra money and lump sums', () => {
  const loans = [loan({ id: 'a', kind: 'private', balance: 5000, rate: 7, termMonths: 60 })];
  const p = plan({ extraMonthly: 1000, lumps: [{ month: '2026-10', amount: 2000 }] });
  const r = simulate(loans, p, 'minimum', opts);
  near(r.rows[0].paid, amort(5000, 0.07, 60), 0.01);
  eq(r.months, 60);
});

test('a lump sum lands in its month', () => {
  const loans = [loan({ id: 'a', kind: 'private', balance: 5000, rate: 7, termMonths: 60 })];
  const r = simulate(loans, plan({ lumps: [{ month: '2026-12', amount: 1500 }] }), 'avalanche', opts);
  near(r.rows[2].paid - r.rows[1].paid, 1500, 0.01);
});

test('autopay takes 0.25% off; refinancing only touches private loans', () => {
  const loans = [
    loan({ id: 'fed', kind: 'fed_unsub', balance: 1000, rate: 6, repayStart: '2030-01' }),
    loan({ id: 'priv', kind: 'private', balance: 1000, rate: 10, repayStart: '2030-01' }),
  ];
  const r = simulate(loans, plan({ autopay: true, refi: { on: true, rate: 5 } }), 'minimum', opts);
  near(r.loans.find(l => l.id === 'fed').rate, 0.0575, 1e-12);
  near(r.loans.find(l => l.id === 'priv').rate, 0.0475, 1e-12);
});

test('shortfalls are flagged only in months with income', () => {
  const loans = [loan({ id: 'a', kind: 'private', balance: 20000, rate: 8, termMonths: 60 })];
  const r = simulate(loans, plan({ incomes: [{ amount: 100, per: 'month', start: '2027-01', end: '2027-03' }] }), 'avalanche', opts);
  eq(r.shortfalls, 3); eq(r.firstShortfall, ym('2027-01'));
});

test('a plan that never covers interest is reported as not paid off', () => {
  const r = simulate([loan({ id: 'a', kind: 'private', balance: 50000, rate: 10, minPayment: 50 })], plan(), 'minimum', opts);
  eq(r.done, false); eq(r.payoffM, null); eq(r.rows.length, 480);
});

test('old weekly phases convert to income sources and monthly costs', () => {
  const p = migratePlan({ phases: [
    { start: '2027-06', end: '', label: 'Job', income: 1000, expenses: 600, share: 80 },
    { start: '2029-01', end: '', label: 'Raise', income: 1300, expenses: 700, share: 80 },
  ] });
  eq(p.phases, undefined);
  eq(p.incomes.length, 2); eq(p.incomes[0].end, '2028-12', 'first phase ends the month before the next;');
  eq(p.expenses[0].amount, Math.round(600 * 52 / 12));
  eq(p.share, 80);
});

test('payment split uses simple daily interest, then principal', () => {
  const s = splitPayment({ kind: 'private', balance: 12000, unpaid: 0, rate: 9.25, asOf: '2026-10-27' }, 500, '2026-11-27');
  eq(s.interest, 94.27); eq(s.principal, 405.73); eq(s.loan.balance, 11594.27); eq(s.loan.asOf, '2026-11-27');
});

test('payment split charges no interest on a subsidized loan in grace', () => {
  const s = splitPayment({ kind: 'fed_sub', balance: 3000, unpaid: 0, rate: 6, asOf: '2026-10-01', repayStart: '2028-05' }, 100, '2026-12-01');
  eq(s.interest, 0); eq(s.principal, 100);
});

test('daily interest ignores subsidized loans before repayment', () => {
  const d = dailyInterest([
    loan({ id: 's', kind: 'fed_sub', balance: 3650, rate: 10, repayStart: '2028-05' }),
    loan({ id: 'p', kind: 'private', balance: 3650, rate: 10 }),
  ], START);
  near(d, 1, 1e-9);
});

test('interest moves are ranked by savings and apply cleanly', () => {
  const loans = [
    loan({ id: 'p', kind: 'private', balance: 15000, unpaid: 2000, rate: 10, repayStart: '2028-11', termMonths: 180 }),
    loan({ id: 'f', kind: 'fed_unsub', balance: 5000, unpaid: 200, rate: 6.5, repayStart: '2028-11' }),
  ];
  const p = plan({ incomes: [{ amount: 900, per: 'month', start: '2026-10' }] });
  const moves = interestMoves(loans, p, 'avalanche', opts);
  ok(moves.length >= 3, 'several moves');
  for (let i = 1; i < moves.length; i++) ok(moves[i - 1].saved >= moves[i].saved, 'sorted by savings');
  ok(moves.every(m => m.saved > 0), 'only moves that help');
  const extra = moves.find(m => m.key === 'extra250');
  const after = simulate(loans, applyMove(p, extra.apply, opts), 'avalanche', opts);
  near(after.totalInterest, extra.result.totalInterest, 1e-6, 'applying a move reproduces its projection;');
});

test('paying more each month never costs more interest or takes longer', () => {
  const loans = [
    loan({ id: 'a', kind: 'private', balance: 12000, rate: 9, termMonths: 120 }),
    loan({ id: 'b', kind: 'fed_unsub', balance: 6000, rate: 6, repayStart: '2027-06' }),
  ];
  const c = extraCurve(loans, plan({ incomes: [{ amount: 600, per: 'month', start: '2026-10' }] }), 'avalanche', { ...opts, max: 1000, steps: 10 });
  eq(c.length, 11); eq(c[0].extra, 0); eq(c[10].extra, 1000);
  for (let i = 1; i < c.length; i++) {
    ok(c[i].interest <= c[i - 1].interest + 1e-6, `interest rose at +$${c[i].extra}`);
    ok(c[i].months <= c[i - 1].months, `took longer at +$${c[i].extra}`);
  }
});

test('the yearly schedule adds up to the monthly rows', () => {
  const r = simulate([loan({ id: 'a', kind: 'private', balance: 10000, rate: 8, termMonths: 36 })], plan(), 'minimum', opts);
  const ys = yearlySummary(r.rows);
  eq(ys[0].year, 2026); eq(ys[0].rows.length, 3, 'Oct–Dec 2026;');
  near(ys.reduce((s, y) => s + y.paid, 0), r.totalPaid, 1e-6);
  near(ys.reduce((s, y) => s + y.interestPaid + y.principalPaid, 0), r.totalPaid, 1e-6);
  near(ys[ys.length - 1].endBalance, 0, 0.005);
});

test('all strategies run and minimums-only is never cheaper than avalanche', () => {
  const loans = [
    loan({ id: 'a', kind: 'private', balance: 9000, rate: 9, termMonths: 120 }),
    loan({ id: 'b', kind: 'fed_unsub', balance: 6000, rate: 6, repayStart: '2027-06' }),
  ];
  const all = simulateAll(loans, plan({ incomes: [{ amount: 1200, per: 'month', start: '2026-10' }] }), opts);
  eq(Object.keys(all).length, 5);
  ok(all.avalanche.totalInterest <= all.minimum.totalInterest);
  ok(all.avalanche.totalInterest <= all.snowball.totalInterest + 0.01);
});

test('a planned one-time cost counts only in its month, and not once it is paid', () => {
  const p = plan({ incomes: [{ amount: 2000, per: 'month', start: '2026-01' }], expenses: [{ amount: 1200, start: '2026-01' }],
    planned: [{ id: 't', label: 'Spring tuition', amount: 3000, month: '2027-01' }] });
  const jan = cashFlow(p, ym('2027-01')), dec = cashFlow(p, ym('2026-12'));
  eq(jan.costs, 1200, 'recurring costs stay recurring;'); eq(jan.oneTime, 3000); eq(jan.left, -2200); eq(jan.toLoans, 0);
  eq(dec.oneTime, 0); eq(dec.toLoans, 800);
  eq(cashFlow({ ...p, planned: [{ ...p.planned[0], paidOn: '2026-12-20' }] }, ym('2027-01')).oneTime, 0);
});

test('a future loan owes nothing until it arrives, then joins the plan', () => {
  const now = loan({ id: 'now', balance: 4000, rate: 6 });
  const later = loan({ id: 'later', balance: 3000, rate: 6, disburseMonth: '2027-01' });
  const r = simulate([now, later], plan({ extraMonthly: 200 }), 'avalanche', opts);
  eq(r.initTotal, 4000, 'not owed yet;');
  eq(r.rows.find(x => x.m === ym('2026-12')).bal.later, 0);
  eq(r.rows.find(x => x.m === ym('2027-01')).disbursed, 3000);
  const grace = simulate([{ ...later, repayStart: '2028-11' }], plan(), 'minimum', opts);
  near(grace.rows.find(x => x.m === ym('2027-01')).bal.later, 3015, 1e-6, 'unsubsidized interest starts when it arrives;');
  eq(grace.rows.find(x => x.m === ym('2026-12')).interest, 0);
  ok(r.done, 'still pays off');
  near(r.totalPaid, r.initTotal + r.totalInterest + r.totalDisbursed, 0.01, 'every dollar accounted for;');
  eq(dailyInterest([later], START), 0);
});

test('a future subsidized loan stays interest-free until repayment starts', () => {
  const sub = loan({ id: 'sub', kind: 'fed_sub', balance: 3500, rate: 6, disburseMonth: '2027-01', repayStart: '2028-11' });
  const r = simulate([sub], plan(), 'minimum', opts);
  near(r.rows.find(x => x.m === ym('2028-10')).bal.sub, 3500, 1e-9);
  eq(r.rows.find(x => x.m === ym('2028-10')).paid, 0);
});
