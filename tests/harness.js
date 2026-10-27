// Minimal test harness that works unchanged in Node and in a browser page.
const cases = [];
export const test = (name, fn) => cases.push({ name, fn });

export function eq(actual, expected, msg = '') {
  if (actual !== expected) throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`.trim());
}
export function near(actual, expected, tol = 0.01, msg = '') {
  if (!(Math.abs(actual - expected) <= tol)) throw new Error(`${msg} expected ${expected} ± ${tol}, got ${actual}`.trim());
}
export function ok(cond, msg = 'expected condition to hold') { if (!cond) throw new Error(msg); }

export async function run() {
  const results = [];
  for (const c of cases) {
    try { await c.fn(); results.push({ name: c.name, pass: true }); }
    catch (e) { results.push({ name: c.name, pass: false, error: e.message }); }
  }
  return results;
}
