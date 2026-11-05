// Used by the daily alerts workflow in the private data repo.
// node tools/daily-alerts.mjs <planner.sqlite> <alerts-state.json> <out-dir>
// Reads the planner (never writes it), works out today's pushes, updates the state file, and writes messages.json to out-dir.
import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';
import { openDb, readAll } from '../js/store/db.js';
import { dailyAlerts } from '../js/alerts.js';

const [dbPath, statePath, outDir] = process.argv.slice(2);
if (!dbPath || !statePath || !outDir) { console.error('usage: daily-alerts.mjs <planner.sqlite> <alerts-state.json> <out-dir>'); process.exit(2); }

const SQL = await initSqlJs();
const data = readAll(openDb(SQL, new Uint8Array(fs.readFileSync(dbPath))));
const prev = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {};
const { messages, state } = dailyAlerts(data, prev, { now: process.env.ALERTS_NOW ? new Date(process.env.ALERTS_NOW) : new Date() });

fs.mkdirSync(path.dirname(statePath), { recursive: true });
fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'messages.json'), JSON.stringify(messages));
console.log(`${messages.length} push(es): ${messages.map(m => m.title).join(' | ') || 'none'}`);
