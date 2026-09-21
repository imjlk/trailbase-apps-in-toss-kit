import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageRoot, '../..');
const cli = join(packageRoot, 'bin/owned-currency-report.mjs');
const eventSchema = readFileSync(join(repoRoot, 'templates/trailbase/sql/owned_currency_events.sql'), 'utf8');
const policySchema = readFileSync(join(repoRoot, 'templates/trailbase/sql/owned_currency_policies.sql'), 'utf8');

test('owned currency report CLI emits redacted JSON and CSV from a readonly snapshot', () => {
  const directory = mkdtempSync(join(tmpdir(), 'owned-currency-report-cli-'));
  const databasePath = join(directory, 'snapshot.sqlite');
  const db = new Database(databasePath);
  try {
    db.exec('PRAGMA foreign_keys = ON; CREATE TABLE _user (id BLOB PRIMARY KEY) STRICT;');
    db.exec(eventSchema);
    db.exec(policySchema);
    db.query(`INSERT INTO owned_currency_policies
      (currency_code, unit_code, policy_version, valuation_mode, valuation_currency_code,
       conversion_numerator, conversion_denominator, effective_from, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'stars', 'count', 'v1', 'FIXED_RATE', 'TOSS_POINT', 1, 100, 0, 0,
    );
    db.query(`INSERT INTO owned_currency_events
      (id, currency_code, unit_code, event_type, quantity, source_type, source_id,
       idempotency_key, policy_version, occurred_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'event-1', 'stars', 'count', 'ISSUE', 3, 'mission', 'private-source-id',
      'idempotency-1', 'v1', 1000, 1000,
    );
  } finally {
    db.close();
  }

  try {
    const json = run(databasePath, '--format', 'json');
    expect(json.status).toBe(0);
    expect(json.stderr).toBe('');
    const report = JSON.parse(json.stdout);
    expect(report.lines[0]).toMatchObject({ currencyCode: 'stars', issuedQuantity: 3 });
    expect(report.tool.name).toBe('trailbase-owned-currency-report');
    expect(json.stdout).not.toContain('private-source-id');

    const csv = run(databasePath, '--format', 'csv');
    expect(csv.status).toBe(0);
    expect(csv.stderr).toBe('');
    expect(csv.stdout).toContain('rowType,currencyCode,unitCode');
    expect(csv.stdout).toContain('period,stars,count');
    expect(csv.stdout).toContain('duplicateSourceCount,missingPolicyEventCount,policyWindowMismatchEventCount,unknownEventCount');

    const invalid = run(databasePath, '--period-start', '10', '--period-end', '10');
    expect(invalid.status).toBe(2);
    expect(invalid.stdout).toBe('');
    expect(invalid.stderr.trim()).toBe('INVALID_REPORT_PERIOD');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function run(databasePath, ...extraArgs) {
  const args = [cli, '--db', databasePath];
  if (!extraArgs.includes('--period-start')) args.push('--period-start', '0');
  if (!extraArgs.includes('--period-end')) args.push('--period-end', '2000');
  if (!extraArgs.includes('--timestamp-unit')) args.push('--timestamp-unit', 'milliseconds');
  const result = spawnSync(process.execPath, [...args, ...extraArgs], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' },
  });
  if (result.error) throw result.error;
  return result;
}
