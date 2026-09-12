import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createLedgerDiagnosticId, inspectLedger, formatLedgerDiagnostic } from '../src/ledger-doctor.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const cli = resolve(dirname(fileURLToPath(import.meta.url)), '../bin/ledger-doctor.mjs');
const secret = 'CANARY-raw-user-key-and-private-context';
function sql(name) { return readFileSync(join(root, 'templates/trailbase/sql', name), 'utf8'); }
function database(path = ':memory:') {
  const db = new Database(path);
  db.exec("CREATE TABLE _user(id BLOB PRIMARY KEY); INSERT INTO _user VALUES(X'01'); CREATE TABLE promotion_campaigns(id TEXT PRIMARY KEY);");
  for (const name of ['iap_orders.sql', 'promotion_reward_ledger.sql', 'message_outbox.core.sql']) db.exec(sql(name));
  return db;
}
function iap(db, id = 'order-1') {
  db.query(`INSERT INTO iap_orders(order_id,user_id,product_id,status,provider_status,created_at,updated_at,granted_at,failure_reason,toss_user_key_hmac,provider_response_json)
    VALUES(?,X'01','coins','GRANTED','PURCHASED',10,20,20,?,?,?)`).run(id, secret, secret, JSON.stringify({ userKey: secret }));
}
function promotion(db) {
  db.query(`INSERT INTO promotion_reward_ledger(id,user_id,source_type,reward_amount,status,provider_request_id,provider_transaction_key,requested_at,created_at,updated_at,failure_reason)
    VALUES('promotion-1',X'01','fixture',1,'pending','private-request',?,10,10,20,?)`).run(secret, secret);
}
function message(db) {
  db.query(`INSERT INTO message_outbox(id,user_id,toss_user_key_hmac,toss_user_key_sealed,purpose,template_code,payload_json,idempotency_key,provider_request_id,status,provider_status,not_before_at,created_at,updated_at)
    VALUES('message-1',X'01',?,?,'FUNCTIONAL','reminder',?,'private-idempotency','private-request','LOCKED','UNKNOWN',10,10,20)`).run(secret, secret, JSON.stringify({ userKey: secret }));
}
function inspect(db, kind, recordId, extra = {}) { return inspectLedger({ db, kind, recordId, timestampUnit: 'milliseconds', now: 100, ...extra }); }

test('diagnostic IDs match the Rust/JavaScript wire vectors and reject invalid text', () => {
  expect(createLedgerDiagnosticId('iap', 'order-1')).toBe('kitdiag1.iap.3b17ba35799d1a0fd2148f040b2a7965dd284dc78a6c3dbb399090d43bb3abfc');
  expect(createLedgerDiagnosticId('message', '요청-1')).toBe('kitdiag1.message.0b8bdba2356c1b1fdf57322178b5e106339583e2148c512062a2061ef62a8965');
  expect(createLedgerDiagnosticId('message', 'order-1')).not.toBe(createLedgerDiagnosticId('iap', 'order-1'));
  for (const id of ['', ' order-1', 'order-1\n', 'a\0b', 'a\u0085b', '\uFEFForder', '\uD800', 'a'.repeat(513)]) {
    expect(() => createLedgerDiagnosticId('iap', id)).toThrow('INVALID_RECORD_ID');
  }
});

test('IAP distinguishes local grant from provider completion and never regrants missing legacy history', () => {
  const db = database();
  try {
    iap(db);
    const report = inspect(db, 'iap', 'order-1');
    expect(report.record.locallyGranted).toBe(true);
    expect(report.record.completionConfirmed).toBe(false);
    expect(report.recoveryPlan.actions).toEqual(['confirm-existing-grant-completion']);
    db.exec("UPDATE iap_orders SET granted_at=NULL");
    expect(inspect(db, 'iap', 'order-1').recoveryPlan.actions).toEqual(['reconcile-grant-history-without-regrant']);
    db.exec("UPDATE iap_orders SET provider_status='ERROR'");
    expect(inspect(db, 'iap', 'order-1').recoveryPlan.actions).toEqual(['verify-order-with-provider']);
  } finally { db.close(); }
});

test('subscription projection is reported as stored data, never an authorization decision', () => {
  const db = database();
  try {
    iap(db); db.exec(sql('iap_subscriptions.sql'));
    db.exec(`INSERT INTO iap_subscription_events VALUES('event','order-1','2026-01-01T00:00:00Z','{}','CONFLICT',20);
      INSERT INTO iap_subscription_entitlements VALUES('order-1','ACTIVE',1,NULL,1,'2026-01-01T00:00:00Z','event',1,20);`);
    const report = inspect(db, 'iap', 'order-1');
    expect(report.record.subscription.storedAccessFlag).toBe(true);
    expect(report.record.subscription.authorizesAccess).toBe(false);
    expect(report.recoveryPlan.actions).toContain('reconcile-subscription-events');
    db.exec('UPDATE iap_orders SET completed_at=20');
    expect(inspect(db, 'iap', 'order-1').recoveryPlan.actions).toEqual(['reconcile-subscription-events']);
  } finally { db.close(); }
});

test('promotion recovery only refers to the original transaction and hides its key', () => {
  const db = database();
  try {
    promotion(db);
    expect(inspect(db, 'promotion', 'promotion-1').recoveryPlan.actions).toEqual(['query-original-promotion-transaction']);
    db.exec('UPDATE promotion_reward_ledger SET provider_transaction_key=NULL');
    expect(inspect(db, 'promotion', 'promotion-1').recoveryPlan.actions).toEqual(['manual-reconciliation-without-new-key']);
    db.exec("UPDATE promotion_reward_ledger SET status='success',provider_status='GRANTED',granted_at=20");
    expect(inspect(db, 'promotion', 'promotion-1').record.providerStatus).toBe('GRANTED');
    expect(inspect(db, 'promotion', 'promotion-1').recoveryPlan.actions).toEqual(['none']);
  } finally { db.close(); }
});

test('message legacy locks and in-flight attempts remain uncertain while unstarted expired claims can be reviewed', () => {
  const db = database();
  try {
    message(db);
    expect(inspect(db, 'message', 'message-1').recoveryPlan.actions).toEqual(['reconcile-uncertain-dispatch-without-resend']);
    db.exec(sql('message_outbox_attempts.sql'));
    db.exec("INSERT INTO message_outbox_attempts VALUES('message-1',1,'DISPATCHING',30,20,NULL,10)");
    expect(inspect(db, 'message', 'message-1').record.lease.expired).toBe(true);
    expect(inspect(db, 'message', 'message-1').recoveryPlan.actions).toEqual(['reconcile-uncertain-dispatch-without-resend']);
    db.exec("UPDATE message_outbox_attempts SET status='CLAIMED',dispatch_started_at=NULL; UPDATE message_outbox SET provider_status='READY'");
    expect(inspect(db, 'message', 'message-1').recoveryPlan.actions).toEqual(['review-expired-unstarted-claim']);
    db.exec("UPDATE message_outbox SET status='SENT'");
    expect(inspect(db, 'message', 'message-1').recoveryPlan.actions).toEqual(['none']);
  } finally { db.close(); }
});

test('agreement metadata is scoped to the user/template without claiming permission to dispatch', () => {
  const db = database();
  try {
    message(db); db.exec(sql('message_templates.sql')); db.exec(sql('notification_template_agreements.sql'));
    db.exec(`INSERT INTO message_templates(template_code,purpose,status,requires_agreement,agreement_template_code,created_at,updated_at)
      VALUES('reminder','FUNCTIONAL','APPROVED',1,'agreement',10,20);
      INSERT INTO notification_template_agreements VALUES('agreement-row',X'01','agreement','OPTED_IN','fixture',NULL,10,20);`);
    const report = inspect(db, 'message', 'message-1');
    expect(report.record.agreement.functionalOptedIn).toBe(true);
    expect(report.record.agreement.authorizesDispatch).toBe(false);
    db.exec("UPDATE notification_template_agreements SET user_id=X'02'");
    expect(inspect(db, 'message', 'message-1').record.agreement.functionalOptedIn).toBe(false);
  } finally { db.close(); }
});

test('legacy template and agreement columns use the same fallback as the production gate', () => {
  const db = database();
  try {
    message(db);
    db.exec(`CREATE TABLE message_templates(template_code TEXT PRIMARY KEY,purpose TEXT,status TEXT,requires_agreement INTEGER);
      INSERT INTO message_templates VALUES('reminder','FUNCTIONAL','APPROVED',1);
      CREATE TABLE notification_template_agreements(user_id BLOB,agreement_template_code TEXT,status TEXT);
      INSERT INTO notification_template_agreements VALUES(X'01','reminder','OPTED_IN');`);
    expect(inspect(db, 'message', 'message-1').record.agreement.functionalOptedIn).toBe(true);
    db.exec("UPDATE notification_template_agreements SET status='OPTED_OUT'");
    expect(inspect(db, 'message', 'message-1').record.agreement.functionalOptedIn).toBe(false);
  } finally { db.close(); }
});

test('marketing consent is inspected independently of missing or unmatched template registries', () => {
  const db = database();
  try {
    message(db);
    db.exec(`UPDATE message_outbox SET purpose='MARKETING';
      CREATE TABLE notification_consents(user_id BLOB,purpose TEXT,status TEXT);
      INSERT INTO notification_consents VALUES(X'01','MARKETING','OPTED_IN');`);
    let agreement = inspect(db, 'message', 'message-1').record.agreement;
    expect(agreement.templateRegistryAvailable).toBe(false);
    expect(agreement.marketingOptedIn).toBe(true);
    expect(agreement.authorizesDispatch).toBe(false);
    db.exec(sql('message_templates.sql'));
    agreement = inspect(db, 'message', 'message-1').record.agreement;
    expect(agreement.templatePresent).toBe(false);
    expect(agreement.marketingOptedIn).toBe(true);
    db.exec("UPDATE notification_consents SET status='OPTED_OUT'");
    expect(inspect(db, 'message', 'message-1').record.agreement.marketingOptedIn).toBe(false);
  } finally { db.close(); }
});

test('raw identifiers, keys, arbitrary failures and nonallowlisted provider status never appear in reports', () => {
  const db = database();
  try {
    iap(db); promotion(db); message(db);
    db.query('UPDATE iap_orders SET provider_status=?').run(secret);
    for (const [kind, id] of [['iap', 'order-1'], ['promotion', 'promotion-1'], ['message', 'message-1']]) {
      const report = inspect(db, kind, id);
      for (const output of [JSON.stringify(report), formatLedgerDiagnostic(report)]) {
        expect(output).not.toContain(secret);
        expect(output).not.toContain(id);
        expect(output).not.toContain('private-request');
      }
      expect(report.recoveryPlan.executable).toBe(false);
      expect(report.recoveryPlan.allowsAutomaticRetry).toBe(false);
      expect(report.recoveryPlan.requiresFreshRead).toBe(true);
    }
  } finally { db.close(); }
});

test('diagnostic fingerprint lookup is bounded and cannot silently report absence after truncation', () => {
  const db = database();
  try {
    iap(db, 'a'); iap(db, 'z');
    const diagnosticId = createLedgerDiagnosticId('iap', 'z');
    expect(() => inspect(db, 'iap', undefined, { diagnosticId, scanLimit: 1 })).toThrow('DIAGNOSTIC_LOOKUP_LIMIT_REACHED');
    expect(inspect(db, 'iap', undefined, { diagnosticId, scanLimit: 2 }).diagnosticId).toBe(diagnosticId);
    expect(inspect(db, 'iap', "' OR 1=1 --").code).toBe('RECORD_NOT_FOUND');
    expect(() => inspect(db, 'iap', undefined, { diagnosticId: createLedgerDiagnosticId('message', 'z') })).toThrow('INVALID_DIAGNOSTIC_ID');
  } finally { db.close(); }
});

test('malformed legacy IDs cannot block a later valid fingerprint match or bypass the scan limit', () => {
  const db = database();
  try {
    iap(db, ' legacy-whitespace'); iap(db, 'valid-order');
    const diagnosticId = createLedgerDiagnosticId('iap', 'valid-order');
    expect(inspect(db, 'iap', undefined, { diagnosticId, scanLimit: 2 }).diagnosticId).toBe(diagnosticId);
    expect(() => inspect(db, 'iap', undefined, { diagnosticId, scanLimit: 1 })).toThrow('DIAGNOSTIC_LOOKUP_LIMIT_REACHED');
    expect(() => inspect(db, 'iap', ' legacy-whitespace')).toThrow('INVALID_RECORD_ID');
  } finally { db.close(); }
});

test('timestamp units are explicit, numeric overflow is withheld, and missing schema fails clearly', () => {
  const db = database();
  try {
    iap(db);
    expect(inspect(db, 'iap', 'order-1').record.ageMs).toBe(80);
    expect(inspect(db, 'iap', 'order-1', { timestampUnit: 'seconds' }).record.ageMs).toBe(80000);
    expect(() => inspect(db, 'iap', 'order-1', { timestampUnit: undefined })).toThrow('EXPLICIT_TIMESTAMP_UNIT_REQUIRED');
    db.exec('UPDATE iap_orders SET updated_at=200');
    expect(inspect(db, 'iap', 'order-1').record.clockSkew).toBe(true);
    expect(inspect(db, 'iap', 'order-1').record.ageMs).toBeNull();
    db.exec('DROP TABLE iap_orders');
    expect(() => inspect(db, 'iap', 'order-1')).toThrow('LEDGER_SCHEMA_UNAVAILABLE');
  } finally { db.close(); }
});

test('CLI opens a snapshot read-only, rejects mutation flags, and sanitizes corrupt database errors', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-doctor-test-'));
  const path = join(dir, 'snapshot.sqlite');
  const db = database(path); iap(db); db.close();
  const before = readFileSync(path);
  const args = [cli, '--db', path, '--kind', 'iap', '--record-id', 'order-1', '--timestamp-unit', 'milliseconds', '--json'];
  try {
    const output = spawnSync(process.execPath, args, { encoding: 'utf8' });
    expect(output.status).toBe(0);
    expect(JSON.parse(output.stdout).ok).toBe(true);
    expect(output.stdout).not.toContain(secret);
    expect(spawnSync(process.execPath, [...args, '--apply'], { encoding: 'utf8' }).status).toBe(2);
    expect(readFileSync(path)).toEqual(before);
    writeFileSync(path, secret);
    const broken = spawnSync(process.execPath, args, { encoding: 'utf8' });
    expect(broken.status).toBe(2);
    expect(broken.stderr).not.toContain(secret);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
