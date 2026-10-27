// Database and sync tests. The runner puts an initialized sql.js module on globalThis.__SQL.
import { test, eq, near, ok } from './harness.js';
import { openDb, readAll, writeAll, exportBytes, schemaVersion, DB_VERSION } from '../js/store/db.js';
import { Sync, STATUS } from '../js/store/sync.js';
import { toB64, fromB64 } from '../js/store/github.js';
import { simulate, ym } from '../js/engine.js';

const SQL = () => globalThis.__SQL;

const sample = () => ({
  loans: [
    { id: 'a', name: 'Lender A · 9%', servicer: 'Lender A', kind: 'private', balance: 9000, unpaid: 400.5, rate: 9, minPayment: 0, termMonths: 180, repayStart: '2028-11', asOf: '2026-10-05', origBalance: 9400.5, order: 1, notes: 'fixed' },
    { id: 'b', name: 'Direct Sub', servicer: '', kind: 'fed_sub', balance: 3500, unpaid: 0, rate: 6.53, minPayment: 0, termMonths: 0, repayStart: '2028-11', asOf: '2026-10-05', origBalance: 3500, order: 2, notes: '' },
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

test('a save based on an old copy stops with a conflict instead of overwriting', async () => {
  const remote = new FakeRemote(), a = device(remote); await a.start(); a.commit(sample(), 'init'); await a.flush();
  const b = device(remote); await b.start();
  const da = a.data(); da.plan.extraMonthly = 111; a.commit(da, 'A edit'); await a.flush();
  const db_ = b.data(); db_.plan.extraMonthly = 222; b.commit(db_, 'B edit'); await b.flush();
  eq(b.status, STATUS.CONFLICT); eq(remote.commits.length, 2, 'B did not overwrite;');
  await b.resolve('theirs');
  eq(b.status, STATUS.SAVED); eq(b.data().plan.extraMonthly, 111);
});

test('keeping this device’s version saves it on top of the newer one', async () => {
  const remote = new FakeRemote(), a = device(remote); await a.start(); a.commit(sample(), 'init'); await a.flush();
  const b = device(remote); await b.start();
  const da = a.data(); da.plan.extraMonthly = 111; a.commit(da, 'A edit'); await a.flush();
  const db_ = b.data(); db_.plan.extraMonthly = 222; b.commit(db_, 'B edit'); await b.flush();
  await b.resolve('mine');
  eq(b.status, STATUS.SAVED); eq(remote.commits.length, 3);
  const c = device(remote); await c.start(); eq(c.data().plan.extraMonthly, 222);
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

test('unsaved edits on a stale copy are not pushed over newer GitHub data', async () => {
  const remote = new FakeRemote(), cacheB = memCache();
  const a = device(remote); await a.start(); a.commit(sample(), 'init'); await a.flush();
  const b = device(remote, cacheB); await b.start();
  remote.offline = true; const db_ = b.data(); db_.plan.share = 10; b.commit(db_, 'B offline edit'); await b.flush(); remote.offline = false;
  const da = a.data(); da.plan.share = 70; a.commit(da, 'A edit'); await a.flush();
  const b2 = device(remote, cacheB); await b2.start();
  eq(b2.status, STATUS.CONFLICT); eq(remote.commits.length, 2);
});
