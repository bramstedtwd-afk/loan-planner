// `npm test` (and GitHub Actions) entry point.
import initSqlJs from 'sql.js';
import { run } from './harness.js';

globalThis.__SQL = await initSqlJs();
await import('./engine.test.js');
await import('./store.test.js');

const results = await run();
for (const r of results) console.log(`${r.pass ? 'ok  ' : 'FAIL'} ${r.name}${r.pass ? '' : `\n     ${r.error}`}`);
const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
