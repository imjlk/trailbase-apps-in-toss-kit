#!/usr/bin/env bun
import { Database } from 'bun:sqlite';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { LedgerDiagnosticError, inspectLedger, formatLedgerDiagnostic } from '../src/ledger-doctor.mjs';

const usage = 'Usage: bun ledger-doctor.mjs --db <sqlite-snapshot> --kind <iap|promotion|message> (--record-id <id> | --diagnostic-id <id>) --timestamp-unit <seconds|milliseconds> [--scan-limit 10000] [--server-version x.y.z] [--json]';
let db;
try {
  const options = {};
  const names = new Map([['--db', 'database'], ['--kind', 'kind'], ['--record-id', 'recordId'],
    ['--diagnostic-id', 'diagnosticId'], ['--timestamp-unit', 'timestampUnit'], ['--scan-limit', 'scanLimit'], ['--server-version', 'serverVersion']]);
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help') { console.log(usage); process.exit(0); }
    if (args[i] === '--json') { options.json = true; continue; }
    const key = names.get(args[i]);
    if (!key || !args[i + 1] || args[i + 1].startsWith('--') || options[key] !== undefined) throw new LedgerDiagnosticError('INVALID_CLI_ARGUMENTS');
    options[key] = args[++i];
  }
  if (!options.database || !options.kind || !options.timestampUnit) throw new LedgerDiagnosticError('MISSING_REQUIRED_ARGUMENTS');
  if (options.serverVersion && !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(options.serverVersion)) throw new LedgerDiagnosticError('INVALID_SERVER_VERSION');
  const path = realpathSync(resolve(options.database));
  if (!statSync(path).isFile()) throw new LedgerDiagnosticError('DATABASE_MUST_BE_A_FILE');
  db = new Database(path, { readonly: true, strict: true });
  db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=3000;');
  const report = inspectLedger({ db, kind: options.kind, recordId: options.recordId, diagnosticId: options.diagnosticId,
    timestampUnit: options.timestampUnit, scanLimit: options.scanLimit === undefined ? undefined : Number(options.scanLimit) });
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const kitRoot = resolve(packageRoot, '../..');
  let sourceCommit = null;
  const top = spawnSync('git', ['-C', kitRoot, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (top.status === 0 && realpathSync(top.stdout.trim()) === realpathSync(kitRoot)) {
    const head = spawnSync('git', ['-C', kitRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
    if (head.status === 0 && /^[a-f0-9]{40,64}$/.test(head.stdout.trim())) sourceCommit = head.stdout.trim();
  }
  report.tool = { version: JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')).version,
    sourceCommit, reportedServerVersion: options.serverVersion ?? null };
  console.log(options.json ? JSON.stringify(report, null, 2) : `${formatLedgerDiagnostic(report)}\n${JSON.stringify(report.tool)}`);
  if (!report.ok) process.exitCode = 1;
} catch (error) {
  // DB errors and arbitrary failure payloads can contain identifiers. Never echo them.
  console.error(error instanceof LedgerDiagnosticError ? error.code : 'DATABASE_INSPECTION_FAILED');
  process.exitCode = 2;
} finally { db?.close(); }
