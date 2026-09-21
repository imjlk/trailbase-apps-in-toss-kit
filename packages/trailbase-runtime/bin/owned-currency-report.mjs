#!/usr/bin/env bun
import { Database } from 'bun:sqlite';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  buildOwnedCurrencyReport,
  formatOwnedCurrencyCsv,
  OwnedCurrencyReportError,
} from '../src/owned-currency-report.mjs';

const usage = 'Usage: bun owned-currency-report.mjs --db <sqlite-snapshot> --period-start <integer> --period-end <integer> --timestamp-unit <seconds|milliseconds> [--format <json|csv>] [--server-version x.y.z]';

class OwnedCurrencyReportCliError extends Error {
  constructor(code) {
    super(code);
    this.name = 'OwnedCurrencyReportCliError';
    this.code = code;
  }
}

let db;
try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage);
    process.exit(0);
  }
  if (!options.database || options.periodStart === undefined || options.periodEnd === undefined || !options.timestampUnit) {
    throw new OwnedCurrencyReportCliError('MISSING_REQUIRED_ARGUMENTS');
  }
  if (options.serverVersion && !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(options.serverVersion)) {
    throw new OwnedCurrencyReportCliError('INVALID_SERVER_VERSION');
  }

  let path;
  try {
    path = realpathSync(resolve(options.database));
    if (!statSync(path).isFile()) throw new OwnedCurrencyReportCliError('DATABASE_MUST_BE_A_FILE');
  } catch (error) {
    if (error instanceof OwnedCurrencyReportCliError) throw error;
    throw new OwnedCurrencyReportCliError('DATABASE_UNAVAILABLE');
  }

  db = new Database(path, { readonly: true, strict: true });
  db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=3000;');
  const report = buildOwnedCurrencyReport({
    db,
    periodStart: options.periodStart,
    periodEnd: options.periodEnd,
    timestampUnit: options.timestampUnit,
  });
  report.tool = {
    name: 'trailbase-owned-currency-report',
    version: packageVersion(),
    sourceCommit: sourceCommit(),
    reportedServerVersion: options.serverVersion ?? null,
  };

  if (options.format === 'csv') process.stdout.write(formatOwnedCurrencyCsv(report));
  else console.log(JSON.stringify(report, null, 2));
} catch (error) {
  // Database errors and arbitrary failure payloads can contain identifiers. Never echo them.
  console.error(error instanceof OwnedCurrencyReportError || error instanceof OwnedCurrencyReportCliError
    ? error.code
    : 'OWNED_CURRENCY_REPORT_FAILED');
  process.exitCode = 2;
} finally {
  db?.close();
}

function parseArguments(args) {
  const options = {};
  const names = new Map([
    ['--db', 'database'],
    ['--period-start', 'periodStart'],
    ['--period-end', 'periodEnd'],
    ['--timestamp-unit', 'timestampUnit'],
    ['--format', 'format'],
    ['--server-version', 'serverVersion'],
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help') {
      if (options.help) throw new OwnedCurrencyReportCliError('INVALID_CLI_ARGUMENTS');
      options.help = true;
      continue;
    }
    if (argument === '--json') {
      if (options.format !== undefined || options.json) throw new OwnedCurrencyReportCliError('INVALID_CLI_ARGUMENTS');
      options.json = true;
      continue;
    }
    const key = names.get(argument);
    if (
      !key || !args[index + 1] || args[index + 1].startsWith('--') || options[key] !== undefined
      || (key === 'format' && options.json)
    ) {
      throw new OwnedCurrencyReportCliError('INVALID_CLI_ARGUMENTS');
    }
    options[key] = args[++index];
  }
  options.format = options.json ? 'json' : (options.format ?? 'json');
  if (!['json', 'csv'].includes(options.format)) throw new OwnedCurrencyReportCliError('INVALID_FORMAT');
  if (options.periodStart !== undefined) options.periodStart = parseTimestamp(options.periodStart);
  if (options.periodEnd !== undefined) options.periodEnd = parseTimestamp(options.periodEnd);
  if (options.timestampUnit !== undefined && !['seconds', 'milliseconds'].includes(options.timestampUnit)) {
    throw new OwnedCurrencyReportCliError('EXPLICIT_TIMESTAMP_UNIT_REQUIRED');
  }
  return options;
}

function parseTimestamp(value) {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) throw new OwnedCurrencyReportCliError('INVALID_REPORT_PERIOD');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new OwnedCurrencyReportCliError('INVALID_REPORT_PERIOD');
  return parsed;
}

function packageVersion() {
  try {
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    return JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')).version;
  } catch {
    return null;
  }
}

function sourceCommit() {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const kitRoot = resolve(packageRoot, '../..');
  const top = spawnSync('git', ['-C', kitRoot, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (top.status !== 0 || !top.stdout.trim()) return null;
  try {
    if (realpathSync(top.stdout.trim()) !== realpathSync(kitRoot)) return null;
  } catch {
    return null;
  }
  const head = spawnSync('git', ['-C', kitRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  return head.status === 0 && /^[a-f0-9]{40,64}$/.test(head.stdout.trim()) ? head.stdout.trim() : null;
}
