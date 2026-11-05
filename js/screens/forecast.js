// Forecast: how much will be in the bank at the end of any month, starting from your last real balance plus what you've
// logged since. Pick a range, tap a month (on the chart or in the table) to see exactly what goes in and out.
import { ymLabel } from '../engine.js';
import { money, esc } from '../format.js';
import { header, subnav } from '../ui/layout.js';
import { WEALTH_TABS } from './wealth.js';
import { forecast } from '../wealth.js';
import { forecastChart, legend } from '../charts.js';

const RANGES = [['3', '3 months'], ['12', '1 year'], ['grad', 'To graduation'], ['payoff', 'To debt-free']];
const shortDate = d => new Date(`${d}T12:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export function renderForecast(view, ctx) {
  const { data, start, onRange, onPick } = ctx;
  const f = forecast(data, start);
  const top = `${header({ title: 'Wealth' })}${subnav(WEALTH_TABS, 'forecast', 'Wealth views')}`;
  if (!f.hasBank) {
    view.innerHTML = `${top}<section class="card glass empty rise"><h2>Add your bank balance</h2><p>The forecast starts from your real bank balance.</p><a class="btn primary" href="#accounts">Add bank account</a></section>`;
    return {};
  }
  const range = ctx.range || '12';
  const count = { 3: 3, 12: 12, grad: f.gradM != null ? f.gradM - start + 4 : 24, payoff: f.payoffM != null ? f.payoffM - start + 1 : 36 }[range];
  const rows = f.rows.slice(0, Math.max(1, Math.min(f.rows.length, count)));
  const low = rows.reduce((a, x) => (x.end - x.target < a.end - a.target ? x : a), rows[0]);
  const pick = rows.find(x => x.m === ctx.pick) || low;
  const vs = pick.end - pick.target;
  const line = (l, sign) => `<div class="kv"><span>${esc(l.label)}${l.estimate ? ' <em class="muted">est.</em>' : ''}</span><b class="num">${sign}${money(l.amount)}</b></div>`;
  const detail = x => `
    ${x.partial ? `<p class="muted small" style="margin:0 0 6px">Already this month: +${money(x.soFar.in)} in, −${money(x.soFar.out)} spent${x.soFar.loans ? `, −${money(x.soFar.loans)} to loans` : ''}. Below is what’s still expected.</p>` : ''}
    ${x.lines.income.map(l => line(l, '+')).join('')}${x.lines.costs.map(l => line(l, '−')).join('')}${x.lines.planned.map(l => line(l, '−')).join('')}${x.lines.loans.map(l => line(l, '−')).join('')}
    ${x.partial ? `<div class="kv"><span>Still to come this month</span><b class="num">${x.in - x.out - x.oneTime - x.loans >= 0 ? '+' : '−'}${money(Math.abs(x.in - x.out - x.oneTime - x.loans))}</b></div>` : ''}
    <div class="kv" style="border-top:1px solid var(--hairline);padding-top:6px"><span><b>End of ${ymLabel(x.m)}</b></span><b class="num">${money(x.end)}</b></div>`;

  view.innerHTML = `${top}
    <section class="card glass rise" aria-label="Starting point">
      <div class="card-h"><h2>Starting point</h2><span class="muted small">${f.asOf ? `Real as of ${shortDate(f.asOf)}` : ''}</span></div>
      <div class="tiles three">
        <div class="tile"><span>Real balance</span><b class="num">${money(f.real)}</b></div>
        <div class="tile"><span>Logged since</span><b class="num">${f.loggedSince.in - f.loggedSince.out >= 0 ? '+' : '−'}${money(Math.abs(f.loggedSince.in - f.loggedSince.out))}</b></div>
        <div class="tile accent"><span>Now</span><b class="num">${money(f.startBal)}</b></div>
      </div>
      <p class="muted small" style="margin:10px 0 0">${f.habits.months ? `Future months use your real habits: income ${Math.round(f.habits.incomeRatio * 100)}% and spending ${Math.round(f.habits.costsRatio * 100)}% of plan.` : 'Future months use your plan until a full month is tracked.'} Loans follow the cushion-first route.</p>
    </section>

    <section class="card glass rise" aria-label="Forecast">
      <div class="seg scroll" role="tablist" aria-label="Range">${RANGES.map(([k, t]) => `<label><input type="radio" name="fc-range" value="${k}" ${k === range ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>
      <div class="fc-pick">
        <label class="field" style="margin:0"><span>End of</span><select data-pick>${rows.map(x => `<option value="${x.m}" ${x.m === pick.m ? 'selected' : ''}>${ymLabel(x.m)}${x === low ? ' ↓' : ''}</option>`).join('')}</select></label>
        <div><b class="num fc-big ${vs < -0.5 ? 'crit' : ''}">${money(pick.end)}</b><small class="muted">${vs >= 0 ? `${money(vs)} above` : `${money(-vs)} under`} your ${money(pick.target)} cushion · bad stretch ${money(pick.badEnd)}</small></div>
      </div>
      <div class="legend">${legend([{ name: 'Forecast', color: 'var(--accent)' }, { name: 'Bad stretch (extras paused)', color: 'var(--warn)' }, { name: 'Cushion', color: 'var(--crit)' }])}</div>
      <div class="chartbox" data-fc></div>
      <p class="muted small" style="margin:6px 0 0">Lowest in this range: <b>${money(low.end)}</b> at the end of ${ymLabel(low.m)}.</p>
    </section>

    <section class="card glass rise" aria-label="Month by month">
      <div class="card-h"><h2>Month by month</h2><span class="muted small">Tap a month</span></div>
      <div class="fc-head"><span>Month</span><span>In</span><span>Out</span><span>End</span></div>
      ${rows.map(x => `<details class="fc-row" ${x.m === pick.m ? 'open' : ''}><summary><span>${ymLabel(x.m).replace(/ 20(\d\d)$/, ' ’$1')}${x.partial ? '*' : ''}</span><span class="num pos">+${money(x.in)}</span><span class="num">−${money(x.out + x.oneTime + x.loans)}</span><b class="num ${x.end < x.target - 0.5 ? 'crit' : ''}">${money(x.end)}</b></summary><div class="fc-detail">${detail(x)}</div></details>`).join('')}
      <p class="muted small" style="margin:8px 0 0">* Only what’s still expected this month. Future loans are paid to school directly, so they don’t move your bank cash.</p>
    </section>`;

  view.querySelectorAll('input[name="fc-range"]').forEach(r => r.addEventListener('change', () => onRange(r.value)));
  view.querySelector('[data-pick]').addEventListener('change', e => onPick(+e.target.value));
  const box = view.querySelector('[data-fc]');
  return { redraw: forecastChart(box, { rows, startBal: f.startBal, start, picked: pick.m, onPick }) };
}
