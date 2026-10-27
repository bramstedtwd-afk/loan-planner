// Monthly check-in: a snapshot of where things stand plus a readable report with reminders.
// Pure function (no I/O) so it runs the same in tests, in the browser and in the monthly GitHub Action.
import { ym, ymStr, ymLabel, nowYM, migratePlan, simulate, interestMoves, cashFlow, STRATEGIES } from './engine.js';

const money = (n, cents = false) => (n < -0.004 ? '−$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
const owedOf = l => (+l.balance || 0) + (+l.unpaid || 0);
const monthName = m => ymLabel(m).replace(/^(\w+)/, s => ({ Jan: 'January', Feb: 'February', Mar: 'March', Apr: 'April', Jun: 'June', Jul: 'July', Aug: 'August', Sep: 'September', Oct: 'October', Nov: 'November', Dec: 'December' }[s] || s));

// data: { loans, payments, plan }; snapshots: earlier results of this function (oldest first)
export function monthlyCheckin(data, snapshots = [], { now = new Date(), appUrl = '', mention = '' } = {}) {
  const start = nowYM(now), month = ymStr(start);
  const loans = data.loans || [], plan = migratePlan(data.plan || {}), payments = data.payments || [];
  const st = STRATEGIES.some(s => s.id === plan.strategy) ? plan.strategy : 'avalanche';
  const r = simulate(loans, plan, st, { start });
  const owed = loans.reduce((s, l) => s + owedOf(l), 0);
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

  // reminders
  const todo = [];
  if (prev && !logged.length && r.rows[0]?.paid > 0) todo.push(`No payments were logged in ${monthName(start - 1)}. If you paid anything, log it so balances stay accurate.`);
  for (const l of loans) {
    const rs = ym(l.repayStart);
    if (rs != null && rs > start && rs - start <= 2 && owedOf(l) > 0.005) todo.push(`Repayment on **${l.name}** starts in ${monthName(rs)}. Confirm the minimum payment and due date with ${l.servicer || 'the servicer'}.`);
  }
  for (const l of loans.filter(l => /variable/i.test(`${l.name} ${l.notes || ''}`) && owedOf(l) > 0.005)) todo.push(`**${l.name}** has a variable rate. Check whether it changed and update it in the app.`);
  const stale = loans.filter(l => owedOf(l) > 0.005 && l.asOf && (now - new Date(l.asOf)) / 864e5 > 60);
  if (stale.length) todo.push(`Balances not updated in over 60 days: ${stale.map(l => `${l.name} (${l.asOf})`).join(', ')}. Copy the latest balance from the servicer's site.`);
  const grad = ym(plan.gradMonth);
  if (grad != null && grad >= start && grad - start <= 1) todo.push(`Graduation is ${grad === start ? 'this month' : 'next month'}. Your grace period starts; review your income and costs in the app.`);
  const short = r.rows.slice(0, 3).filter(x => cashFlow(plan, x.m).inc.length && x.budget + 0.01 < x.minsDue).length;
  const cf = cashFlow(plan, start);
  if (short) todo.push(`Your income doesn't cover the required minimums in ${short} of the next 3 months.`);
  else if (cf.inc.length && row && row.paid > Math.max(0, cf.income - cf.costs) + 1) todo.push(`This month's plan sends ${money(row.paid)} to loans but only ${money(cf.income - cf.costs)} is left after costs. The difference would come from savings.`);
  const move = interestMoves(loans, plan, st, { start })[0];

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
