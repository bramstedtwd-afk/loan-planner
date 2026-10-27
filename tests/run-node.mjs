// `npm test` (and GitHub Actions) entry point.
import { run } from './harness.js';
import './engine.test.js';

const results = await run();
for (const r of results) console.log(`${r.pass ? 'ok  ' : 'FAIL'} ${r.name}${r.pass ? '' : `\n     ${r.error}`}`);
const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
