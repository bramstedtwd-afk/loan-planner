// Real money in and out. Pure functions over the app's data, so they run the same in the browser and in tests.
// Bank balances are only ever "real": they change when you confirm them (the Sunday check-in, or editing an account).
// Everything you log after that date moves the "estimated" balance, never the real one.

const r2 = n => Math.round(n * 100) / 100;
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const UNLOGGED = 'Unlogged';

// One list of every real in/out: your logs, loan payments, and planned costs marked paid. Newest first.
export function ledger(data) {
  const out = [];
  for (const t of data.transactions || []) if (t.kind !== 'skipped') out.push({ ...t, amount: +t.amount || 0, source: 'log' });
  for (const p of data.payments || []) out.push({ id: `pay-${p.id}`, date: p.date, amount: +p.amount || 0, dir: 'out', category: 'Loan payment', note: p.loanName || '', kind: 'logged', source: 'payment' });
  for (const p of data.plan?.planned || []) if (p.paidOn) out.push({ id: `plan-${p.id}`, date: p.paidOn, amount: +p.amount || 0, dir: 'out', category: 'Planned cost', note: p.label || '', kind: 'logged', source: 'planned' });
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

// Real = your bank accounts as last confirmed. Estimated = real plus everything logged after that date.
export function balances(data) {
  const banks = (data.accounts || []).filter(a => a.kind === 'bank');
  const real = r2(banks.reduce((s, a) => s + (+a.balance || 0), 0));
  const asOf = banks.reduce((d, a) => (a.updatedAt || '') > d ? a.updatedAt : d, '');
  const since = asOf ? ledger(data).filter(e => e.date > asOf && !isUnlogged(e.kind)) : [];
  const inSince = r2(since.filter(e => e.dir === 'in').reduce((s, e) => s + e.amount, 0));
  const outSince = r2(since.filter(e => e.dir === 'out').reduce((s, e) => s + e.amount, 0));
  return { hasBank: banks.length > 0, banks, real, asOf, inSince, outSince, count: since.length, estimated: r2(real + inSince - outSince) };
}

// Totals for one calendar month ("YYYY-MM"): in, out, net, spending by category (biggest first). Unlogged is kept apart.
export function monthSummary(data, month) {
  const es = ledger(data).filter(e => String(e.date).startsWith(month));
  const sum = (list) => r2(list.reduce((s, e) => s + e.amount, 0));
  const ins = es.filter(e => e.dir === 'in'), outs = es.filter(e => e.dir === 'out');
  const byCat = {};
  for (const e of outs) byCat[e.category || 'Other'] = (byCat[e.category || 'Other'] || 0) + e.amount;
  return {
    month, entries: es, in: sum(ins), out: sum(outs), net: r2(sum(ins) - sum(outs)),
    unloggedIn: sum(ins.filter(e => isUnlogged(e.kind))), unloggedOut: sum(outs.filter(e => isUnlogged(e.kind))),
    byCategory: Object.entries(byCat).map(([category, amount]) => ({ category, amount: r2(amount) })).sort((a, b) => b.amount - a.amount),
  };
}

// Confirming real balances: the gap between what you now have and the estimate becomes one "Unlogged" entry,
// so totals stay honest. Returns the new data (accounts updated with history, check-in recorded).
export function applyCheckin(data, realById, date, { now = new Date() } = {}) {
  const before = balances(data);
  const accounts = (data.accounts || []).map(a => {
    if (!(a.id in realById)) return a;
    const balance = r2(+realById[a.id] || 0);
    return { ...a, balance, updatedAt: date, history: [...(a.history || []).filter(h => h.date !== date), { date, balance }].sort((x, y) => x.date.localeCompare(y.date)) };
  });
  const real = r2(accounts.filter(a => a.kind === 'bank').reduce((s, a) => s + (+a.balance || 0), 0));
  const gap = before.asOf ? r2(real - before.estimated) : 0; // the first check-in has nothing to compare with
  const transactions = [...(data.transactions || [])];
  if (Math.abs(gap) >= 0.5) transactions.push({ id: `u${date.replace(/-/g, '')}`, date, amount: Math.abs(gap), dir: gap > 0 ? 'in' : 'out', category: UNLOGGED,
    note: `Difference found at the ${date} check-in`, kind: 'unlogged', createdAt: now.toISOString() });
  const checkins = [...(data.checkins || []).filter(c => c.date !== date), { date, real, estimated: before.estimated, unlogged: gap, takenAt: now.toISOString() }]
    .sort((a, b) => a.date.localeCompare(b.date));
  return { data: { ...data, accounts, transactions, checkins }, gap, real, estimated: before.estimated };
}

// Actual vs planned for the last `n` months up to `month` ("YYYY-MM"), starting no earlier than the first tracked month.
// Spending here is what you logged (plus Unlogged); loan payments and planned costs are shown apart.
export function actualVsPlan(data, month, planOf, n = 6) {
  const first = [...ledger(data).map(e => e.date), ...(data.checkins || []).map(c => c.date)].filter(Boolean).sort()[0];
  if (!first) return [];
  const [y, mo] = month.split('-').map(Number), out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(y, mo - 1 - i, 1), key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (key < first.slice(0, 7)) continue;
    const s = monthSummary(data, key), p = planOf(key);
    const spent = r2(s.entries.filter(e => e.dir === 'out' && e.source === 'log').reduce((t, e) => t + e.amount, 0));
    out.push({ month: key, in: s.in, spent, loans: r2(s.entries.filter(e => e.source === 'payment').reduce((t, e) => t + e.amount, 0)),
      planned: r2(s.entries.filter(e => e.source === 'planned').reduce((t, e) => t + e.amount, 0)), planIn: r2(p.income), planSpent: r2(p.costs), partial: key === month });
  }
  return out;
}

// ---------- recurring entries: a biweekly paycheck, rent on the last day of the month ----------
export const isUnlogged = kind => String(kind || '').startsWith('unlogged'); // 'unlogged' (not explained yet) or 'unlogged-ok' (accepted)
const addDays = (dateStr, n) => { const d = new Date(`${dateStr}T12:00`); d.setDate(d.getDate() + n); return iso(d); };
const lastDayOf = (y, m) => iso(new Date(y, m + 1, 0, 12));

// Every date a recurring entry falls on, from `from` to `to` (YYYY-MM-DD, inclusive).
export function occurrences(r, from, to) {
  const out = [];
  if (!r.anchor) return out;
  if (r.cadence === 'biweekly' || r.cadence === 'weekly') {
    const step = r.cadence === 'weekly' ? 7 : 14;
    let d = r.anchor;
    while (d < from) d = addDays(d, step);
    for (; d <= to; d = addDays(d, step)) out.push(d);
  } else { // monthly on the anchor's day, or the last day of each month
    const [ay, am, ad] = r.anchor.split('-').map(Number);
    for (let y = ay, m = am - 1; ; m++) {
      if (m > 11) { y++; m = 0; }
      const last = lastDayOf(y, m), day = r.cadence === 'monthly-last' ? last : iso(new Date(y, m, Math.min(ad, +last.slice(8)), 12));
      if (day > to) break;
      if (day >= from && day >= r.anchor) out.push(day);
    }
  }
  return out;
}

// What's due and not yet confirmed or skipped (up to 5 weeks back), oldest first.
export function recurringDue(data, today, { lookbackDays = 35 } = {}) {
  const done = new Set((data.transactions || []).filter(t => t.recurringId).map(t => `${t.recurringId}|${t.due}`));
  return (data.recurring || []).filter(r => r.active !== false)
    .flatMap(r => occurrences(r, addDays(today, -lookbackDays), today).filter(d => !done.has(`${r.id}|${d}`)).map(due => ({ r, due })))
    .sort((a, b) => a.due.localeCompare(b.due));
}
export const nextDue = (r, today) => occurrences(r, today, addDays(today, 400))[0] || null;

// Confirm one due entry (with the real amount) or skip it (it didn't happen this time).
export function confirmRecurring(data, r, due, { amount = r.amount, date = due, skip = false, now = new Date() } = {}) {
  const t = { id: `r${r.id}${due.replace(/-/g, '')}`, date, amount: skip ? 0 : Math.round(+amount * 100) / 100, dir: r.dir, category: r.category || 'Other',
    note: r.label, kind: skip ? 'skipped' : 'logged', createdAt: now.toISOString(), recurringId: r.id, due };
  return { ...data, transactions: [...(data.transactions || []).filter(x => x.id !== t.id), t] };
}

// ---------- budgets ----------
// This month against each budget. "Hot" when it's past 80% while less than 80% of the month is gone.
export function budgetStatus(data, month, today = iso(new Date())) {
  const b = data.plan?.spendBudgets || {}, s = monthSummary(data, month);
  const [y, m] = month.split('-').map(Number), days = new Date(y, m, 0).getDate();
  const gone = today.slice(0, 7) > month ? 1 : today.slice(0, 7) < month ? 0 : +today.slice(8) / days;
  return Object.entries(b).filter(([, v]) => +v > 0).map(([category, budget]) => {
    const spent = r2(s.entries.filter(e => e.dir === 'out' && e.category === category).reduce((t, e) => t + e.amount, 0));
    return { category, budget: +budget, spent, left: r2(+budget - spent), pct: spent / +budget, hot: spent >= 0.8 * budget && gone < 0.8 && spent < budget, over: spent > +budget + 0.5 };
  });
}
export const budgetTotal = data => Object.values(data.plan?.spendBudgets || {}).reduce((s, v) => s + (+v || 0), 0);

// ---------- odd balances ----------
// A check-in gap is "odd" when it's $75 or more, or 10% or more of a typical week's money in and out.
export function oddThreshold(weeklyIn, weeklyOut) { return Math.max(75, 0.1 * ((+weeklyIn || 0) + (+weeklyOut || 0))); }
export const unexplained = (data, threshold = 75) => (data.transactions || []).filter(t => t.kind === 'unlogged' && t.amount >= threshold);

// Split an Unlogged amount into what it really was. Whatever is left stays Unlogged, or is accepted as is.
export function explainGap(data, id, splits, { accept = false, now = new Date() } = {}) {
  const u = (data.transactions || []).find(t => t.id === id);
  if (!u) return data;
  const parts = Object.entries(splits).map(([category, a]) => [category, Math.round(+a * 100) / 100]).filter(([, a]) => a > 0);
  const used = parts.reduce((s, [, a]) => s + a, 0), rest = r2(u.amount - used);
  const added = parts.map(([category, amount], i) => ({ id: `${u.id}e${i}${Date.now().toString(36)}`, date: u.date, amount, dir: u.dir, category, note: 'Explained at check-in', kind: 'logged', createdAt: now.toISOString() }));
  const others = data.transactions.filter(t => t.id !== id);
  const keep = rest >= 0.5 ? [{ ...u, amount: rest, kind: accept ? 'unlogged-ok' : 'unlogged' }] : [];
  return { ...data, transactions: [...others, ...added, ...keep] };
}

// The most recent Sunday on or before `now`, as YYYY-MM-DD. A check-in is due when the real balance is older than that.
export const lastSunday = (now = new Date()) => { const d = new Date(now); d.setDate(d.getDate() - d.getDay()); return iso(d); };
export const checkinDue = (data, now = new Date()) => { const b = balances(data); return b.hasBank && b.asOf < lastSunday(now); };
