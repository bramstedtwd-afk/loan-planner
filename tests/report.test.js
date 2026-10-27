// Monthly check-in tests. Made-up data only.
import { test, eq, ok } from './harness.js';
import { monthlyCheckin, reminders } from '../js/report.js';
import { defaultPlan } from '../js/engine.js';

const NOW = new Date('2026-11-01T14:00:00Z');
const data = () => ({
  loans: [
    { id: 'p', name: 'Private A', servicer: 'Lender A', kind: 'private', balance: 9000, unpaid: 300, rate: 9.5, termMonths: 120, repayStart: '', asOf: '2026-10-20', notes: 'variable rate' },
    { id: 'f', name: 'Direct Unsub', servicer: 'MOHELA', kind: 'fed_unsub', balance: 4000, unpaid: 50, rate: 6.5, repayStart: '2026-12', asOf: '2026-06-01' },
  ],
  payments: [{ id: 'x', loanId: 'p', date: '2026-10-15', amount: 300, interest: 70, principal: 230 }],
  plan: { ...defaultPlan(), gradMonth: '2026-06', incomes: [{ amount: 1200, per: 'month', start: '2026-01' }], expenses: [{ amount: 700, start: '2026-01' }] },
});

test('the first check-in records a snapshot and a readable report', () => {
  const c = monthlyCheckin(data(), [], { now: NOW, appUrl: 'https://example.test/app/', mention: '@me' });
  eq(c.month, '2026-11');
  eq(c.snapshot.owed, 13350); eq(c.snapshot.loggedLastMonth, 300);
  ok(c.snapshot.payoffMonth, 'has a payoff month');
  ok(c.title.startsWith('November 2026 check-in: $13,350 owed · debt-free '), c.title);
  ok(c.body.includes('@me'), 'mentions the owner');
  ok(c.body.includes('First check-in'), 'says it is the first');
  ok(c.body.includes('[Open Loan Payoff](https://example.test/app/)'));
});

test('reminders cover repayment starting soon, variable rates and stale balances', () => {
  const c = monthlyCheckin(data(), [], { now: NOW });
  ok(/Repayment on \*\*Direct Unsub\*\* starts in December 2026/.test(c.body), 'repayment soon');
  ok(/Private A\*\* has a variable rate/.test(c.body), 'variable rate');
  ok(/not updated in over 60 days: Direct Unsub \(2026-06-01\)/.test(c.body), 'stale balance');
});

test('changes since last month are reported against the previous snapshot', () => {
  const first = monthlyCheckin(data(), [], { now: new Date('2026-10-01T14:00:00Z') }).snapshot;
  const older = { ...first, owed: first.owed + 500, payoffMonth: '2031-01', totalInterest: first.totalInterest + 400 };
  const c = monthlyCheckin(data(), [older], { now: NOW });
  ok(/Owed \*\*\$500 less\*\*/.test(c.body), 'owed delta');
  ok(/Debt-free date moved \*\*\d+ months? sooner\*\*/.test(c.body), 'payoff moved');
  ok(/Projected interest down/.test(c.body), 'interest delta');
});

test('a month with nothing logged gets a reminder once there is history', () => {
  const d = data(); d.payments = [];
  const prev = monthlyCheckin(d, [], { now: new Date('2026-10-01T14:00:00Z') }).snapshot;
  const c = monthlyCheckin(d, [prev], { now: NOW });
  ok(/No payments were logged in October 2026/.test(c.body));
});

test('reminders have stable keys that match the report text', () => {
  const r = reminders(data(), { now: NOW });
  const keys = r.map(x => x.key);
  ok(keys.includes('repay-f') && keys.includes('variable-p') && keys.includes('stale'), keys.join(','));
  const body = monthlyCheckin(data(), [], { now: NOW }).body;
  for (const x of r) ok(body.includes(x.text), `report includes ${x.key}`);
  eq(reminders(data(), { now: NOW, hasHistory: false }).some(x => x.key === 'no-log'), false);
});

test('no loans still produces a report', () => {
  const c = monthlyCheckin({ loans: [], payments: [], plan: {} }, [], { now: NOW });
  eq(c.snapshot.owed, 0); ok(c.title.includes('$0 owed'));
});
