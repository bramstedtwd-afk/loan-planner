// Which phone pushes to send today, compared with what was sent before. Pure, so the daily workflow and the tests share it.
// state: { level, safe, sent: { key: 'YYYY-MM-DD' } } from the last run; returns { messages, state } for this run.
import { ym, ymLabel, nowYM, cashFlow, WEEKS_PER_MONTH } from './engine.js';
import { stability, monthAction } from './wealth.js';
import { unexplained, oddThreshold } from './tracker.js';

const money = n => '$' + Math.round(n).toLocaleString('en-US');
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysBetween = (a, b) => Math.round((new Date(`${b}T12:00`) - new Date(`${a}T12:00`)) / 864e5);
const LEVEL = { stable: 'Stable', watch: 'Watch', tight: 'Tight' };

export function dailyAlerts(data, prev = {}, { now = new Date() } = {}) {
  const today = iso(now), start = nowYM(now), sent = { ...(prev.sent || {}) }, messages = [];
  const st = stability(data, start), act = monthAction(data, start);
  const push = (key, title, body, click, every = null) => {
    if (sent[key] && (every == null || daysBetween(sent[key], today) < every)) return;
    messages.push({ key, title, body, click }); sent[key] = today;
  };

  // 1. the verdict changed since the last run
  if (st.level && prev.level && st.level !== prev.level) push(`level-${today}`, `Now ${LEVEL[st.level]} (was ${LEVEL[prev.level]})`, act.title, '#today');
  // 2. a safe extra payment opened up
  if (st.level === 'stable' && st.safe > 0 && !(prev.safe > 0)) push(`safe-${today}`, `Safe to pay ${money(st.safe)} extra`, act.title, '#today');
  // 3. a planned cost is about a week away (they're due by month, so: within 7 days of the 1st of that month)
  for (const p of (data.plan?.planned || []).filter(p => !p.paidOn && p.month)) {
    const d = daysBetween(today, `${p.month}-01`);
    if (d >= 0 && d <= 7) push(`planned-${p.id}`, `${p.label} is due ${ymLabel(ym(p.month))}`, `${money(+p.amount)}${p.estimate ? ' (estimate)' : ''}. ${st.level === 'tight' ? 'Your cushion is short; keep extra in savings.' : 'Your cushion already holds it.'}`, '#cashflow');
  }
  // 4. an odd balance still unexplained (reminded every 3 days)
  const cf = cashFlow(data.plan || {}, start), threshold = oddThreshold(cf.income / WEEKS_PER_MONTH, (cf.costs + cf.oneTime) / WEEKS_PER_MONTH);
  for (const u of unexplained(data, threshold)) push(`odd-${u.id}`, `${money(u.amount)} unexplained`, `Your ${u.date} check-in was ${money(u.amount)} ${u.dir === 'out' ? 'lower' : 'higher'} than expected. What was it?`, '#spending', 3);

  for (const k of Object.keys(sent)) if (daysBetween(sent[k], today) > 120) delete sent[k]; // keep the state small
  return { messages, state: { level: st.level, safe: st.safe, sent, updated: today } };
}
