// Navigation map tests.
import { test, eq } from './harness.js';
import { resolveRoute, TABS, ROUTES } from '../js/routes.js';

test('each of the four tabs resolves to itself', () => {
  for (const t of TABS) { const r = resolveRoute(`#${t}`); eq(r.key, t); eq(r.tab, t); eq(r.redirected, false); }
});

test('older links redirect to their new homes', () => {
  eq(resolveRoute('#money').key, 'cashflow'); eq(resolveRoute('#money').redirected, true);
  eq(resolveRoute('#history').key, 'activity');
});

test('sub-views belong to their tab; Settings to no tab', () => {
  eq(resolveRoute('#activity').tab, 'loans');
  eq(resolveRoute('#accounts').tab, 'wealth'); eq(resolveRoute('#cashflow').tab, 'wealth');
  eq(resolveRoute('#settings').tab, null);
});

test('empty or unknown links open Today', () => {
  eq(resolveRoute('').key, 'today'); eq(resolveRoute('#').key, 'today');
  eq(resolveRoute('#nope').key, 'today'); eq(resolveRoute(undefined).key, 'today');
  eq(Object.keys(ROUTES).length, 8);
});
