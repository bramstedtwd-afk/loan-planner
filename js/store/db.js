// planner.sqlite: schema, upgrades, and conversion between tables and the app's data shape.
// Works with any initialized sql.js module (browser CDN build or the npm package in tests).
import { defaultPlan, migratePlan } from '../engine.js';

// Each entry upgrades the file by one version. Never edit a shipped entry; append a new one.
const MIGRATIONS = [
  `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE loans (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, servicer TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL,
     balance REAL NOT NULL DEFAULT 0, unpaid REAL NOT NULL DEFAULT 0, rate REAL NOT NULL DEFAULT 0,
     min_payment REAL NOT NULL DEFAULT 0, term_months INTEGER NOT NULL DEFAULT 0,
     repay_start TEXT NOT NULL DEFAULT '', as_of TEXT NOT NULL DEFAULT '', orig_balance REAL NOT NULL DEFAULT 0,
     sort INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '');
   CREATE TABLE payments (
     id TEXT PRIMARY KEY, loan_id TEXT NOT NULL, loan_name TEXT NOT NULL DEFAULT '', date TEXT NOT NULL,
     amount REAL NOT NULL, interest REAL NOT NULL DEFAULT 0, principal REAL NOT NULL DEFAULT 0,
     note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT '');
   CREATE TABLE incomes (
     id INTEGER PRIMARY KEY, label TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'other',
     amount REAL NOT NULL DEFAULT 0, per TEXT NOT NULL DEFAULT 'week', start_month TEXT NOT NULL DEFAULT '', end_month TEXT NOT NULL DEFAULT '');
   CREATE TABLE expenses (
     id INTEGER PRIMARY KEY, label TEXT NOT NULL DEFAULT '', amount REAL NOT NULL DEFAULT 0,
     start_month TEXT NOT NULL DEFAULT '', end_month TEXT NOT NULL DEFAULT '');
   CREATE TABLE lumps (id INTEGER PRIMARY KEY, month TEXT NOT NULL DEFAULT '', label TEXT NOT NULL DEFAULT '', amount REAL NOT NULL DEFAULT 0);
   CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE scenarios (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, plan TEXT NOT NULL, payoff_month INTEGER, total_interest REAL, saved_at TEXT NOT NULL DEFAULT '');
   CREATE TABLE snapshots (
     month TEXT PRIMARY KEY, owed REAL NOT NULL, payoff_month INTEGER, total_interest REAL, taken_at TEXT NOT NULL);`,
  // v2: accounts (bank, brokerage, retirement, other debts) and a dated history of each balance.
  `CREATE TABLE accounts (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, institution TEXT NOT NULL DEFAULT '',
     balance REAL NOT NULL DEFAULT 0, rate REAL NOT NULL DEFAULT 0, min_payment REAL NOT NULL DEFAULT 0,
     source TEXT NOT NULL DEFAULT 'manual', updated_at TEXT NOT NULL DEFAULT '', sort INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '');
   CREATE TABLE account_history (
     account_id TEXT NOT NULL, date TEXT NOT NULL, balance REAL NOT NULL, PRIMARY KEY (account_id, date));`,
  // v3: one-time planned costs (tuition you pay out of pocket) and loans that arrive in a future month.
  `CREATE TABLE planned_costs (
     id TEXT PRIMARY KEY, label TEXT NOT NULL DEFAULT '', amount REAL NOT NULL DEFAULT 0, month TEXT NOT NULL DEFAULT '',
     paid_on TEXT NOT NULL DEFAULT '', sort INTEGER NOT NULL DEFAULT 0);
   ALTER TABLE loans ADD COLUMN disburse_month TEXT NOT NULL DEFAULT '';`,
];
export const DB_VERSION = MIGRATIONS.length;
export const MIGRATIONS_FOR_TESTS = MIGRATIONS;

// Plan fields kept as JSON in `settings`; list fields live in their own tables.
const SETTING_KEYS = ['strategy', 'autopay', 'extraMonthly', 'gradMonth', 'share', 'refi', 'customOrder', 'emergencyMonths', 'assumedReturn', 'employerMatch', 'strategyOverride', 'dismissed', 'useSpareCash'];

const rowsOf = (db, sql, params) => {
  const st = db.prepare(sql); if (params) st.bind(params);
  const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out;
};

export function schemaVersion(db) {
  const hasMeta = rowsOf(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='meta'").length > 0;
  if (!hasMeta) return 0;
  const r = rowsOf(db, "SELECT value FROM meta WHERE key='schema_version'")[0];
  return r ? +r.value : 0;
}

export function migrate(db) {
  let v = schemaVersion(db);
  if (v > DB_VERSION) throw Object.assign(new Error(`This planner file was saved by a newer version of the app (schema ${v}). Reload the app to update it.`), { code: 'too_new' });
  while (v < DB_VERSION) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]); v++;
      db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)", [String(v)]);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  return v;
}

export function openDb(SQL, bytes) {
  const db = bytes && bytes.length ? new SQL.Database(bytes) : new SQL.Database();
  migrate(db);
  return db;
}

export function readAll(db) {
  const loans = rowsOf(db, 'SELECT * FROM loans ORDER BY sort, name').map(r => ({
    id: r.id, name: r.name, servicer: r.servicer, kind: r.kind, balance: r.balance, unpaid: r.unpaid, rate: r.rate,
    minPayment: r.min_payment, termMonths: r.term_months, repayStart: r.repay_start, asOf: r.as_of,
    origBalance: r.orig_balance, order: r.sort, notes: r.notes, disburseMonth: r.disburse_month,
  }));
  const payments = rowsOf(db, 'SELECT * FROM payments ORDER BY date, created_at').map(r => ({
    id: r.id, loanId: r.loan_id, loanName: r.loan_name, date: r.date, amount: r.amount, interest: r.interest,
    principal: r.principal, note: r.note, createdAt: r.created_at,
  }));
  const scenarios = rowsOf(db, 'SELECT * FROM scenarios ORDER BY saved_at').map(r => ({
    id: r.id, name: r.name, plan: JSON.parse(r.plan), payoffM: r.payoff_month, totalInterest: r.total_interest, savedAt: r.saved_at,
  }));
  const plan = defaultPlan();
  for (const r of rowsOf(db, 'SELECT key, value FROM settings')) if (SETTING_KEYS.includes(r.key)) plan[r.key] = JSON.parse(r.value);
  plan.incomes = rowsOf(db, 'SELECT * FROM incomes ORDER BY id').map(r => ({ label: r.label, kind: r.kind, amount: r.amount, per: r.per, start: r.start_month, end: r.end_month }));
  plan.expenses = rowsOf(db, 'SELECT * FROM expenses ORDER BY id').map(r => ({ label: r.label, amount: r.amount, start: r.start_month, end: r.end_month }));
  plan.lumps = rowsOf(db, 'SELECT * FROM lumps ORDER BY id').map(r => ({ month: r.month, label: r.label, amount: r.amount }));
  plan.planned = rowsOf(db, 'SELECT * FROM planned_costs ORDER BY month, sort').map(r => ({ id: r.id, label: r.label, amount: r.amount, month: r.month, paidOn: r.paid_on }));
  const history = {};
  for (const h of rowsOf(db, 'SELECT * FROM account_history ORDER BY date')) (history[h.account_id] ||= []).push({ date: h.date, balance: h.balance });
  const accounts = rowsOf(db, 'SELECT * FROM accounts ORDER BY sort, name').map(r => ({
    id: r.id, name: r.name, kind: r.kind, institution: r.institution, balance: r.balance, rate: r.rate, minPayment: r.min_payment,
    source: r.source, updatedAt: r.updated_at, order: r.sort, notes: r.notes, history: history[r.id] || [],
  }));
  return { loans, payments, scenarios, plan, accounts };
}

const num = v => (v === '' || v == null || Number.isNaN(+v)) ? 0 : +v;
const str = v => v == null ? '' : String(v);

// Replaces the file's contents with `data` in one transaction.
export function writeAll(db, data) {
  const plan = migratePlan(data.plan || {});
  db.exec('BEGIN');
  try {
    for (const t of ['loans', 'payments', 'incomes', 'expenses', 'lumps', 'settings', 'scenarios', 'accounts', 'account_history', 'planned_costs']) db.exec(`DELETE FROM ${t}`);
    (plan.planned || []).forEach((p, i) => db.run('INSERT INTO planned_costs (id, label, amount, month, paid_on, sort) VALUES (?,?,?,?,?,?)',
      [str(p.id || `c${i}`), str(p.label), num(p.amount), str(p.month), str(p.paidOn), i]));
    (data.accounts || []).forEach((a, i) => {
      db.run('INSERT INTO accounts (id, name, kind, institution, balance, rate, min_payment, source, updated_at, sort, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [str(a.id), str(a.name), str(a.kind), str(a.institution), num(a.balance), num(a.rate), num(a.minPayment), str(a.source || 'manual'), str(a.updatedAt), a.order ?? i, str(a.notes)]);
      for (const h of a.history || []) db.run('INSERT OR REPLACE INTO account_history (account_id, date, balance) VALUES (?,?,?)', [str(a.id), str(h.date), num(h.balance)]);
    });
    (data.loans || []).forEach((l, i) => db.run(
      'INSERT INTO loans (id, name, servicer, kind, balance, unpaid, rate, min_payment, term_months, repay_start, as_of, orig_balance, sort, notes, disburse_month) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [str(l.id), str(l.name), str(l.servicer), str(l.kind), num(l.balance), num(l.unpaid), num(l.rate), num(l.minPayment), Math.round(num(l.termMonths)),
        str(l.repayStart), str(l.asOf), num(l.origBalance) || num(l.balance) + num(l.unpaid), l.order ?? i, str(l.notes), str(l.disburseMonth)]));
    for (const p of data.payments || []) db.run(
      'INSERT INTO payments (id, loan_id, loan_name, date, amount, interest, principal, note, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [str(p.id), str(p.loanId), str(p.loanName), str(p.date), num(p.amount), num(p.interest), num(p.principal), str(p.note), str(p.createdAt)]);
    for (const s of plan.incomes) db.run('INSERT INTO incomes (label, kind, amount, per, start_month, end_month) VALUES (?,?,?,?,?,?)',
      [str(s.label), str(s.kind || 'other'), num(s.amount), s.per === 'month' ? 'month' : 'week', str(s.start), str(s.end)]);
    for (const s of plan.expenses) db.run('INSERT INTO expenses (label, amount, start_month, end_month) VALUES (?,?,?,?)', [str(s.label), num(s.amount), str(s.start), str(s.end)]);
    for (const s of plan.lumps) db.run('INSERT INTO lumps (month, label, amount) VALUES (?,?,?)', [str(s.month), str(s.label), num(s.amount)]);
    for (const k of SETTING_KEYS) db.run('INSERT INTO settings (key, value) VALUES (?, ?)', [k, JSON.stringify(plan[k] ?? null)]);
    for (const s of data.scenarios || []) db.run('INSERT INTO scenarios (id, name, plan, payoff_month, total_interest, saved_at) VALUES (?,?,?,?,?,?)',
      [str(s.id), str(s.name), JSON.stringify(s.plan || {}), s.payoffM ?? null, s.totalInterest ?? null, str(s.savedAt)]);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function recordSnapshot(db, { month, owed, payoffMonth, totalInterest, takenAt = new Date().toISOString() }) {
  db.run('INSERT OR REPLACE INTO snapshots (month, owed, payoff_month, total_interest, taken_at) VALUES (?,?,?,?,?)', [month, owed, payoffMonth, totalInterest, takenAt]);
}
export const readSnapshots = db => rowsOf(db, 'SELECT * FROM snapshots ORDER BY month');

export const exportBytes = db => db.export();
