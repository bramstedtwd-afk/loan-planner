// Real money in and out. Pure functions over the app's data, so they run the same in the browser and in tests.
// Bank balances are only ever "real": they change when you confirm them (the Sunday check-in, or editing an account).
// Everything you log after that date moves the "estimated" balance, never the real one.

const r2 = n => Math.round(n * 100) / 100;
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const UNLOGGED = 'Unlogged';

// One list of every real in/out: your logs, loan payments, and planned costs marked paid. Newest first.
export function ledger(data) {
  const out = [];
  for (const t of data.transactions || []) out.push({ ...t, amount: +t.amount || 0, source: 'log' });
  for (const p of data.payments || []) out.push({ id: `pay-${p.id}`, date: p.date, amount: +p.amount || 0, dir: 'out', category: 'Loan payment', note: p.loanName || '', kind: 'logged', source: 'payment' });
  for (const p of data.plan?.planned || []) if (p.paidOn) out.push({ id: `plan-${p.id}`, date: p.paidOn, amount: +p.amount || 0, dir: 'out', category: 'Planned cost', note: p.label || '', kind: 'logged', source: 'planned' });
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

// Real = your bank accounts as last confirmed. Estimated = real plus everything logged after that date.
export function balances(data) {
  const banks = (data.accounts || []).filter(a => a.kind === 'bank');
  const real = r2(banks.reduce((s, a) => s + (+a.balance || 0), 0));
  const asOf = banks.reduce((d, a) => (a.updatedAt || '') > d ? a.updatedAt : d, '');
  const since = asOf ? ledger(data).filter(e => e.date > asOf && e.kind !== 'unlogged') : [];
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
    unloggedIn: sum(ins.filter(e => e.kind === 'unlogged')), unloggedOut: sum(outs.filter(e => e.kind === 'unlogged')),
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

// The most recent Sunday on or before `now`, as YYYY-MM-DD. A check-in is due when the real balance is older than that.
export const lastSunday = (now = new Date()) => { const d = new Date(now); d.setDate(d.getDate() - d.getDay()); return iso(d); };
export const checkinDue = (data, now = new Date()) => { const b = balances(data); return b.hasBank && b.asOf < lastSunday(now); };
