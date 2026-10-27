// Monthly check-in: a snapshot of where things stand plus a readable report with reminders.
// Pure function (no I/O) so it runs the same in tests, in the browser and in the monthly GitHub Action.
import { ym, ymStr, ymLabel, nowYM, migratePlan, simulate, interestMoves, cashFlow, owedNow, STRATEGIES } from './engine.js';
import { effectivePlan } from './wealth.js';

const money = (n, cents = false) => (n < -0.004 ? '−$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
const owedOf = (l, m) => owedNow(l, m);
const monthName = m => ymLabel(m).replace(/^(\w+)/, s => ({ Jan: 'January', Feb: 'February', Mar: 'March', Apr: 'April', Jun: 'June', Jul: 'July', Aug: 'August', Sep: 'September', Oct: 'October', Nov: 'November', Dec: 'December' }[s] || s));

// data: { loans, payments, plan }; snapshots: earlier results of this function (oldest first)
export function monthlyCheckin(data, snapshots = [], { now = new Date(), appUrl = '', mention = '' } = {}) {
  const start = nowYM(now), month = ymStr(start);
  const loans = data.loans || [], plan = migratePlan(data.plan || {}), payments = data.payments || [];
  const st = STRATEGIES.some(s => s.id === plan.strategy) ? plan.strategy : 'avalanche';
  const ep = effectivePlan({ ...data, plan }, start);
  const r = simulate(loans, ep, st, { start });
  const owed = loans.reduce((s, l) => s + owedOf(l, start), 0);
  const prev = [...snapshots].filter(s => s.month < month).pop() || null;
  const lastMonth = ymStr(start - 1);
  const logged = payments.filter(p => String(p.date).startsWith(lastMonth));
  const loggedTotal = logged.reduce((s, p) => s + (+p.amount || 0), 0);

  const snapshot = {
    month, takenAt: now.toISOString(), owed: Math.round(owed * 100) / 100,
    unpaidInterest: Math.round(loans.reduce((s, l) => s + (+l.unpaid || 0), 0) * 100) / 100,
    payoffMonth: r.done ? ymStr(r.payoffM) : null, totalInterest: Math.round(r.totalInterest),
    strategy: st, extraMonthly: +plan.extraMonthly || 0, loggedLastMonth: Math.round(loggedTotal * 100) / 100, loans: loans.length,
  };

  // headline changes since the last check-in
  const changes = [];
  if (prev) {
    const d = owed - prev.owed;
    if (Math.abs(d) >= 1) changes.push(`${d < 0 ? '⬇️ Owed' : '⬆️ Owed'} **${money(Math.abs(d))} ${d < 0 ? 'less' : 'more'}** than at the ${monthName(ym(prev.month))} check-in${d > 0 ? ' (interest building, or a balance update)' : ''}.`);
    if (prev.payoffMonth && snapshot.payoffMonth && prev.payoffMonth !== snapshot.payoffMonth) {
      const mv = ym(snapshot.payoffMonth) - ym(prev.payoffMonth);
      changes.push(`${mv < 0 ? '🎉 Debt-free date moved **' + Math.abs(mv) + ' month' + (Math.abs(mv) > 1 ? 's' : '') + ' sooner**' : '⚠️ Debt-free date slipped **' + mv + ' month' + (mv > 1 ? 's' : '') + '**'} (${ymLabel(ym(prev.payoffMonth))} → ${ymLabel(ym(snapshot.payoffMonth))}).`);
    }
    const di = snapshot.totalInterest - prev.totalInterest;
    if (Math.abs(di) >= 25) changes.push(`Projected interest ${di < 0 ? 'down' : 'up'} **${money(Math.abs(di))}** (${money(prev.totalInterest)} → ${money(snapshot.totalInterest)}).`);
  }

  // this month's payments from the plan
  const row = r.rows[0];
  const payLines = row ? loans.filter(l => row.pay[l.id] > 0.005).sort((a, b) => row.pay[b.id] - row.pay[a.id]).map(l => `| ${l.name} | ${money(row.pay[l.id], true)} |`) : [];

  const todo = reminders(data, { now, hasHistory: !!prev }).map(t => t.text);
  const move = interestMoves(loans, ep, st, { start })[0];

  const title = `${monthName(start)} check-in: ${money(owed)} owed · ${r.done ? `debt-free ${ymLabel(r.payoffM)}` : 'not on track to pay off'}`;
  const body = [
    mention ? `${mention}, here's your monthly loan check-in.` : `Here's your monthly loan check-in.`,
    '',
    '| | |', '|---|---|',
    `| Owed today | **${money(owed)}**${snapshot.unpaidInterest ? ` (incl. ${money(snapshot.unpaidInterest)} unpaid interest)` : ''} |`,
    `| Debt-free | **${r.done ? ymLabel(r.payoffM) : 'not within 40 years'}**${r.done && r.payoffM > start ? ` (${r.payoffM - start} months away)` : ''} |`,
    `| Interest still to pay | ${money(r.totalInterest)} |`,
    `| Strategy | ${STRATEGIES.find(s => s.id === st).name}${snapshot.extraMonthly ? ` + ${money(snapshot.extraMonthly)}/mo extra` : ''} |`,
    `| Logged in ${monthName(start - 1)} | ${logged.length ? `${money(loggedTotal, true)} across ${logged.length} payment${logged.length > 1 ? 's' : ''}` : 'nothing'} |`,
    '',
    ...(changes.length ? ['### Since last month', ...changes.map(c => `- ${c}`), ''] : prev ? [] : ['_First check-in. Next month will show what changed._', '']),
    `### ${monthName(start)} payments`,
    ...(payLines.length ? ['| Loan | Send |', '|---|---|', ...payLines, `| **Total** | **${money(row.paid, true)}** |`] : ['Nothing is due this month.']),
    '',
    ...(todo.length ? ['### To do', ...todo.map(t => `- [ ] ${t}`), ''] : []),
    ...(move ? ['### Best next move', `**${move.title}**: saves ${money(move.saved)} in interest${move.sooner > 0 ? ` and finishes ${move.sooner} month${move.sooner > 1 ? 's' : ''} sooner` : ''}. ${move.detail}.`, ''] : []),
    appUrl ? `[Open Loan Payoff](${appUrl})` : '',
    '',
    '<sub>Made by the monthly check-in workflow. It reads planner.sqlite and records a snapshot in snapshots.json; it never changes your plan.</sub>',
  ].join('\n');

  return { month, title, body, snapshot };
}

// Reminders shared by the monthly check-in issue and the Today screen. Each has a stable key so it can be dismissed for the month.
export function reminders(data, { now = new Date(), hasHistory = false } = {}) {
  const start = nowYM(now);
  const loans = data.loans || [], plan = migratePlan(data.plan || {}), payments = data.payments || [];
  const st = STRATEGIES.some(s => s.id === plan.strategy) ? plan.strategy : 'avalanche';
  const ep = effectivePlan({ ...data, plan }, start);
  const r = simulate(loans, ep, st, { start }), row = r.rows[0];
  const lastMonth = ymStr(start - 1);
  const out = [];
  if (hasHistory && !payments.some(p => String(p.date).startsWith(lastMonth)) && row?.paid > 0) out.push({ key: 'no-log', text: `No payments were logged in ${monthName(start - 1)}. If you paid anything, log it so balances stay accurate.` });
  for (const l of loans) {
    const rs = ym(l.repayStart);
    if (rs != null && rs > start && rs - start <= 2 && owedOf(l, start) > 0.005) out.push({ key: `repay-${l.id}`, text: `Repayment on **${l.name}** starts in ${monthName(rs)}. Confirm the minimum payment and due date with ${l.servicer || 'the servicer'}.` });
  }
  for (const l of loans.filter(l => /variable/i.test(`${l.name} ${l.notes || ''}`) && owedOf(l, start) > 0.005)) out.push({ key: `variable-${l.id}`, text: `**${l.name}** has a variable rate. Check whether it changed and update it in the app.` });
  const stale = loans.filter(l => owedOf(l, start) > 0.005 && l.asOf && (now - new Date(l.asOf)) / 864e5 > 60);
  if (stale.length) out.push({ key: 'stale', text: `Balances not updated in over 60 days: ${stale.map(l => `${l.name} (${l.asOf})`).join(', ')}. Copy the latest balance from the servicer's site.` });
  for (const p of (plan.planned || []).filter(p => !p.paidOn && ym(p.month) != null && ym(p.month) - start <= 1)) {
    const pm = ym(p.month);
    out.push({ key: `planned-${p.id}`, text: pm < start
      ? `**${p.label}** (${money(+p.amount)}) was planned for ${monthName(pm)}. If you paid it, mark it paid in Wealth → Cash flow; if not, move it to the right month.`
      : `**${p.label}** (${money(+p.amount)}) is due ${pm === start ? 'this month' : `in ${monthName(pm)}`}. Your cushion already holds it; mark it paid in Wealth → Cash flow when you pay.` });
  }
  for (const l of loans.filter(l => ym(l.disburseMonth) != null && ym(l.disburseMonth) <= start)) out.push({ key: `arrived-${l.id}`,
    text: `**${l.name}** was planned to arrive in ${monthName(ym(l.disburseMonth))}. Confirm the amount you actually got on the Loans tab.` });
  const grad = ym(plan.gradMonth);
  if (grad != null && grad >= start && grad - start <= 1) out.push({ key: 'grad', text: `Graduation is ${grad === start ? 'this month' : 'next month'}. Your grace period starts; review your income and costs in the app.` });
  const short = r.rows.slice(0, 3).filter(x => cashFlow(plan, x.m).inc.length && x.budget + 0.01 < x.minsDue).length;
  const cf = cashFlow(plan, start), spare = ep.lumps.filter(l => ym(l.month) === start).reduce((a, l) => a + (+l.amount || 0), 0);
  if (short) out.push({ key: 'short', text: `Your income doesn't cover the required minimums in ${short} of the next 3 months.` });
  else if (cf.inc.length && row && row.paid > Math.max(0, cf.left) + spare + 1) out.push({ key: 'savings-draw', text: `This month's plan sends ${money(row.paid)} to loans but only ${money(Math.max(0, cf.left))} is left after costs. The difference would come from savings.` });
  return out;
}
