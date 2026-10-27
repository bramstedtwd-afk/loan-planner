// Used by the monthly check-in workflow in the private data repo.
// node tools/monthly-report.mjs <planner.sqlite> <snapshots.json> <out-dir>
// Reads the planner (never writes it), adds this month's snapshot to snapshots.json, and writes the issue title/body to out-dir.
// Env: APP_URL (link in the issue), MENTION (e.g. @username), CHECKIN_NOW (override the date, for testing).
import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';
import { openDb, readAll } from '../js/store/db.js';
import { monthlyCheckin } from '../js/report.js';

const [dbPath, snapPath, outDir] = process.argv.slice(2);
if (!dbPath || !snapPath || !outDir) { console.error('usage: monthly-report.mjs <planner.sqlite> <snapshots.json> <out-dir>'); process.exit(2); }

const SQL = await initSqlJs();
const data = readAll(openDb(SQL, new Uint8Array(fs.readFileSync(dbPath))));
const file = fs.existsSync(snapPath) ? JSON.parse(fs.readFileSync(snapPath, 'utf8')) : { version: 1, snapshots: [] };
const now = process.env.CHECKIN_NOW ? new Date(process.env.CHECKIN_NOW) : new Date();

const c = monthlyCheckin(data, file.snapshots, { now, appUrl: process.env.APP_URL || '', mention: process.env.MENTION || '' });
file.snapshots = [...file.snapshots.filter(s => s.month !== c.month), c.snapshot].sort((a, b) => a.month.localeCompare(b.month));
fs.writeFileSync(snapPath, JSON.stringify(file, null, 2) + '\n');

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'title.txt'), c.title);
fs.writeFileSync(path.join(outDir, 'body.md'), c.body);
fs.writeFileSync(path.join(outDir, 'month.txt'), c.month);
console.log(c.title);
