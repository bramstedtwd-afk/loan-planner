// Database and sync tests. The runner puts an initialized sql.js module on globalThis.__SQL.
import { test, eq, near, ok } from './harness.js';
import { openDb, readAll, writeAll, exportBytes, schemaVersion, DB_VERSION, MIGRATIONS_FOR_TESTS } from '../js/store/db.js';
import { Sync, STATUS } from '../js/store/sync.js';
import { toB64, fromB64 } from '../js/store/github.js';
import { simulate, ym } from '../js/engine.js';

const SQL = () => globalThis.__SQL;

const sample = () => ({
  loans: [
    { id: 'a', name: 'Lender A · 9%', servicer: 'Lender A', kind: 'private', balance: 9000, unpaid: 400.5, rate: 9, minPayment: 0, termMonths: 180, repayStart: '2028-11', asOf: '2026-10-05', origBalance: 9400.5, order: 1, notes: 'fixed', disburseMonth: '', estimate: false },
    { id: 'b', name: 'Direct Sub', servicer: '', kind: 'fed_sub', balance: 3500, unpaid: 0, rate: 6.53, minPayment: 0, termMonths: 0, repayStart: '2028-11', asOf: '2026-10-05', origBalance: 3500, order: 2, notes: '', disburseMonth: '', estimate: false },
  ],
  payments: [{ id: 'p1', loanId: 'a', loanName: 'Lender A · 9%', date: '2026-10-20', amount: 200, interest: 30.5, principal: 169.5, note: 'test', createdAt: '2026-10-20T10:00:00Z' }],
  scenarios: [{ id: 's1', name: 'Big raise', plan: { strategy: 'snowball', extraMonthly: 100 }, payoffM: ym('2029-03'), totalInterest: 4100, savedAt: '2026-10-21T00:00:00Z' }],
  plan: {
    strategy: 'avalanche', autopay: true, extraMonthly: 250, gradMonth: '2028-05', share: 90, refi: { on: false, rate: 5.5 }, customOrder: ['b', 'a'],
    incomes: [{ label: 'Part-time', kind: 'part', amount: 240, per: 'week', start: '2026-10', end: '2028-05' }, { label: 'Job', kind: 'full', amount: 4300, per: 'month', start: '2028-06', end: '' }],
    expenses: [{ label: 'Now', amount: 750, start: '2026-10', end: '2028-05' }],
    lumps: [{ month: '2027-04', label: 'Tax refund', amount: 600 }],
  },
});

class FakeRemote {
  constructor() { this.file = null; this.sha = null; this.commits = []; this.offline = false; }
  async load() { if (this.offline) throw { code: 'offline' }; return this.file ? { bytes: this.file.slice(), sha: this.sha } : null; }
  async save(bytes, sha, message) {
    if (this.offline) throw { code: 'offline' };
    if ((this.sha || null) !== (sha || null)) throw { code: 'conflict' };
    this.file = bytes.slice(); this.sha = `sha${this.commits.length + 1}`; this.commits.push(message); return this.sha;
  }
}
const memCache = () => { let v = null; return { get: () => v && JSON.parse(JSON.stringify(v)), set: x => { v = x; } }; };
const device = (remote, cache = memCache()) => new Sync({ SQL: SQL(), remote, cache, debounceMs: 1e9 });

test('a new file is created at the current schema version', () => {
  const db = openDb(SQL());
  eq(schemaVersion(db), DB_VERSION);
  eq(readAll(db).loans.length, 0);
});

test('everything written comes back unchanged', () => {
  const db = openDb(SQL()), d = sample();
  writeAll(db, d);
  const back = readAll(db);
  eq(JSON.stringify(back.loans), JSON.stringify(d.loans));
  eq(JSON.stringify(back.payments), JSON.stringify(d.payments));
  eq(JSON.stringify(back.scenarios), JSON.stringify(d.scenarios));
  for (const k of Object.keys(d.plan)) eq(JSON.stringify(back.plan[k]), JSON.stringify(d.plan[k]), `plan.${k}:`);
});

test('the file survives export and reopen', () => {
  const db = openDb(SQL()); writeAll(db, sample());
  const again = openDb(SQL(), exportBytes(db));
  eq(JSON.stringify(readAll(again)), JSON.stringify(readAll(db)));
  eq(JSON.stringify(Array.from(fromB64(toB64(new Uint8Array([0, 1, 254, 255]))))), '[0,1,254,255]', 'base64 round-trip;');
});

test('a version 1 file upgrades to the current version with every row intact', () => {
  // Build a file exactly as version 1 of the app wrote it.
  const v1 = new (SQL().Database)();
  v1.exec(MIGRATIONS_FOR_TESTS[0]);
  v1.run("INSERT INTO meta (key, value) VALUES ('schema_version', '1')");
  v1.run("INSERT INTO loans (id, name, kind, balance, unpaid, rate, sort) VALUES ('a', 'Lender A', 'private', 9000, 400.5, 9, 1)");
  v1.run("INSERT INTO payments (id, loan_id, date, amount, interest, principal) VALUES ('p1', 'a', '2026-10-20', 200, 30.5, 169.5)");
  v1.run("INSERT INTO incomes (label, kind, amount, per, start_month, end_month) VALUES ('Job', 'full', 1000, 'week', '2028-06', '')");
  v1.run("INSERT INTO settings (key, value) VALUES ('strategy', '\"snowball\"'), ('extraMonthly', '150')");
  const upgraded = openDb(SQL(), v1.export());
  eq(schemaVersion(upgraded), DB_VERSION); ok(DB_VERSION >= 2);
  const d = readAll(upgraded);
  eq(d.loans.length, 1); eq(d.loans[0].unpaid, 400.5); eq(d.payments[0].principal, 169.5);
  eq(d.plan.incomes[0].amount, 1000); eq(d.plan.strategy, 'snowball'); eq(d.plan.extraMonthly, 150);
  eq(d.accounts.length, 0, 'no accounts yet;');
  eq(d.plan.emergencyMonths, 3, 'new settings get defaults;'); eq(d.plan.assumedReturn, 6);
});

test('accounts and their balance history round-trip', () => {
  const db = openDb(SQL()), d = sample();
  d.accounts = [
    { id: 'chk', name: 'Checking', kind: 'bank', institution: 'Bank A', balance: 2500.25, rate: 0, minPayment: 0, source: 'manual', updatedAt: '2026-10-27', order: 0, notes: '',
      history: [{ date: '2026-09-30', balance: 2100 }, { date: '2026-10-27', balance: 2500.25 }] },
    { id: 'cc', name: 'Credit card', kind: 'debt', institution: 'Card Co', balance: 640, rate: 24.99, minPayment: 35, source: 'manual', updatedAt: '2026-10-20', order: 1, notes: '', history: [] },
  ];
  writeAll(db, d);
  const back = readAll(openDb(SQL(), exportBytes(db)));
  eq(JSON.stringify(back.accounts), JSON.stringify(d.accounts));
});

test('a file from a newer app version is refused, not damaged', () => {
  const db = openDb(SQL());
  db.run("UPDATE meta SET value = ? WHERE key = 'schema_version'", [String(DB_VERSION + 1)]);
  let code = null; try { openDb(SQL(), exportBytes(db)); } catch (e) { code = e.code; }
  eq(code, 'too_new');
});

test('the engine gives the same answer from the database as from the original data', () => {
  const d = sample(), db = openDb(SQL()); writeAll(db, d);
  const opts = { start: ym('2026-10') };
  const a = simulate(d.loans, d.plan, 'avalanche', opts), b = simulate(readAll(db).loans, readAll(db).plan, 'avalanche', opts);
  eq(a.payoffM, b.payoffM); near(a.totalInterest, b.totalInterest, 1e-9);
});

test('the first save creates the file on GitHub with a readable commit message', async () => {
  const remote = new FakeRemote(), a = device(remote);
  await a.start(); eq(a.status, STATUS.SAVED);
  a.commit(sample(), 'Added 2 loans'); eq(a.status, STATUS.PENDING);
  await a.flush();
  eq(a.status, STATUS.SAVED); eq(remote.commits.length, 1); eq(remote.commits[0], 'Added 2 loans'); eq(a.sha, 'sha1');
});

test('another device loads what was saved', async () => {
  const remote = new FakeRemote(), a = device(remote); await a.start(); a.commit(sample(), 'init'); await a.flush();
  const b = device(remote); await b.start();
  eq(b.status, STATUS.SAVED); eq(b.data().loans.length, 2); eq(b.sha, a.sha);
});

test('several quick edits become one commit', async () => {
  const remote = new FakeRemote(), a = device(remote); await a.start();
  const d = sample(); a.commit(d, 'Added loans');
  d.plan.extraMonthly = 300; a.commit(d, 'Extra set to $300');
  await a.flush();
  eq(remote.commits.length, 1); ok(remote.commits[0].startsWith('Extra set to $300 (+1 more change)'), remote.commits[0]);
});

test('two devices editing different things: both edits are kept', async () => {
  const remote = new FakeRemote(), a = device(remote); await a.start(); a.commit(sample(), 'init'); await a.flush();
  const b = device(remote); await b.start();
  const da = a.data(); da.plan.extraMonthly = 111; a.commit(da, 'A edit'); await a.flush();
  const db_ = b.data(); db_.plan.share = 40; b.commit(db_, 'B edit'); await b.flush();
  eq(b.status, STATUS.SAVED); eq(remote.commits.length, 3);
  ok(remote.commits[2].includes('Merged with changes from another device'), remote.commits[2]);
  const c = device(remote); await c.start();
  eq(c.data().plan.extraMonthly, 111, 'A kept;'); eq(c.data().plan.share, 40, 'B kept;');
});

test('both devices changed the same thing: this device wins and the commit says so', async () => {
  const remote = new FakeRemote(), a = device(remote); await a.start(); a.commit(sample(), 'init'); await a.flush();
  const b = device(remote); await b.start();
  const da = a.data(); da.plan.extraMonthly = 111; a.commit(da, 'A edit'); await a.flush();
  const db_ = b.data(); db_.plan.extraMonthly = 222; b.commit(db_, 'B edit'); await b.flush();
  const c = device(remote); await c.start(); eq(c.data().plan.extraMonthly, 222);
  ok(/kept this device’s: Setting extraMonthly/.test(remote.commits[2]), remote.commits[2]);
});

test('a stale device can no longer wipe newer additions (the Nov 5 incident)', async () => {
  const remote = new FakeRemote(), cacheB = memCache();
  const a = device(remote); await a.start(); a.commit(sample(), 'init'); await a.flush();
  const b = device(remote, cacheB); await b.start();
  // A (another computer) adds budgets, a recurring bill, a planned cost and a future loan
  const da = a.data();
  da.plan.spendBudgets = { Housing: 750, Food: 150 }; da.plan.expenses[0].amount = 1000;
  da.recurring = [{ id: 'rent', label: 'Rent', dir: 'out', amount: 750, cadence: 'monthly-last', anchor: '2026-11-01', category: 'Housing', variable: false, active: true }];
  da.plan.planned = [{ id: 'fall', label: 'Fall semester', amount: 3000, month: '2027-08', paidOn: '', estimate: true }];
  da.loans.push({ ...da.loans[1], id: 'future', name: 'Spring Sub (est.)', disburseMonth: '2027-01', estimate: true });
  a.commit(da, 'A adds Phase 4'); await a.flush();
  // B, offline on the old copy, changes something else and later comes back
  remote.offline = true; const db_ = b.data(); db_.loans[0].rate = 8.5; b.commit(db_, 'B rate change'); await b.flush(); remote.offline = false;
  const b2 = device(remote, cacheB); await b2.start();
  eq(b2.status, STATUS.SAVED);
  const c = device(remote); await c.start(); const d = c.data();
  eq(d.recurring.length, 1); eq(d.plan.planned.length, 1); eq(d.loans.length, 3); eq(d.plan.spendBudgets.Housing, 750);
  eq(d.plan.expenses[0].amount, 1000); eq(d.loans.find(l => l.id === 'a').rate, 8.5, 'and B’s own change is in too;');
});

test('a delete on one device is kept unless the other edited that item', async () => {
  const remote = new FakeRemote(), a = device(remote); await a.start(); a.commit(sample(), 'init'); await a.flush();
  const b = device(remote); await b.start();
  const da = a.data(); da.payments = []; a.commit(da, 'A deleted the payment'); await a.flush();
  const db_ = b.data(); db_.plan.share = 60; b.commit(db_, 'B edit'); await b.flush();
  const c = device(remote); await c.start();
  eq(c.data().payments.length, 0); eq(c.data().plan.share, 60);
});

test('edits made offline are kept and saved once back online', async () => {
  const remote = new FakeRemote(), cache = memCache(), a = device(remote, cache); await a.start(); a.commit(sample(), 'init'); await a.flush();
  remote.offline = true;
  const d = a.data(); d.plan.share = 50; a.commit(d, 'Share 50%'); await a.flush();
  eq(a.status, STATUS.OFFLINE); ok(cache.get().dirty, 'kept on the device');
  remote.offline = false;
  const reopened = device(remote, cache); await reopened.start(); // e.g. the app reopened later
  eq(reopened.status, STATUS.SAVED); eq(remote.commits.length, 2); eq(remote.commits[1], 'Share 50%');
});

test('unsaved edits on a stale copy are merged into newer GitHub data, not pushed over it', async () => {
  const remote = new FakeRemote(), cacheB = memCache();
  const a = device(remote); await a.start(); a.commit(sample(), 'init'); await a.flush();
  const b = device(remote, cacheB); await b.start();
  remote.offline = true; const db_ = b.data(); db_.plan.share = 10; b.commit(db_, 'B offline edit'); await b.flush(); remote.offline = false;
  const da = a.data(); da.plan.share = 70; a.commit(da, 'A edit'); await a.flush();
  const b2 = device(remote, cacheB); await b2.start();
  eq(b2.status, STATUS.SAVED); eq(remote.commits.length, 3, 'merged instead of overwriting;');
  const c = device(remote); await c.start(); eq(c.data().plan.share, 10, 'both changed share: this device wins');
});

test('planned costs and future loans survive a save and reload', () => {
  const d = sample();
  d.plan.planned = [{ id: 'tu', label: 'Spring tuition', amount: 3000, month: '2027-01', paidOn: '', estimate: true }, { id: 'bk', label: 'Books', amount: 400, month: '2027-01', paidOn: '2027-01-05', estimate: false }];
  d.loans[1].disburseMonth = '2027-01';
  const db = openDb(SQL()); writeAll(db, d);
  const back = readAll(openDb(SQL(), exportBytes(db)));
  eq(JSON.stringify(back.plan.planned), JSON.stringify(d.plan.planned));
  eq(back.loans.find(l => l.id === 'b').disburseMonth, '2027-01'); eq(back.loans.find(l => l.id === 'a').disburseMonth, '');
});

test('logged money and check-ins survive a save and reload', () => {
  const d = { ...sample(), transactions: [{ id: 't1', date: '2026-11-02', amount: 12.5, dir: 'out', category: 'Food', note: 'lunch', kind: 'logged', createdAt: '2026-11-02T18:00:00Z', recurringId: '', due: '' }],
    checkins: [{ date: '2026-11-08', real: 2940, estimated: 3090, unlogged: -150, takenAt: '2026-11-08T16:00:00Z' }] };
  d.plan.categories = { out: ['Rent', 'Food'], in: ['Paycheck'] };
  const db = openDb(SQL()); writeAll(db, d);
  const back = readAll(openDb(SQL(), exportBytes(db)));
  eq(JSON.stringify(back.transactions), JSON.stringify(d.transactions));
  eq(JSON.stringify(back.checkins), JSON.stringify(d.checkins));
  eq(JSON.stringify(back.plan.categories), JSON.stringify(d.plan.categories));
});
