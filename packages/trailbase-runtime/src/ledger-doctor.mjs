import { createHash } from 'node:crypto';

const LEDGERS = Object.freeze({ iap: ['iap_orders', 'order_id'], promotion: ['promotion_reward_ledger', 'id'], message: ['message_outbox', 'id'] });
const DIGEST_PREFIX = 'kit-ledger-diagnostic-v1\0';
export class LedgerDiagnosticError extends Error {
  constructor(code) { super(code); this.name = 'LedgerDiagnosticError'; this.code = code; }
}
const fail = code => { throw new LedgerDiagnosticError(code); };

export function createLedgerDiagnosticId(kind, recordId) {
  if (!Object.hasOwn(LEDGERS, kind)) fail('INVALID_LEDGER_KIND');
  if (typeof recordId !== 'string' || !recordId || recordId.trim() !== recordId ||
      Buffer.byteLength(recordId) > 512 || /[\p{Cc}\uFEFF]/u.test(recordId) ||
      Buffer.from(recordId).toString('utf8') !== recordId) fail('INVALID_RECORD_ID');
  const hash = createHash('sha256').update(`${DIGEST_PREFIX}${kind}\0${recordId}`).digest('hex');
  return `kitdiag1.${kind}.${hash}`;
}

function columns(db, table) {
  if (!db.query("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table)) return null;
  return new Set(db.query(`PRAGMA table_info("${table}")`).all().map(row => row.name));
}
function requireColumns(db, table, names) {
  const present = columns(db, table);
  if (!present || names.some(name => !present.has(name))) fail('LEDGER_SCHEMA_UNAVAILABLE');
  return present;
}
function known(value, allowed) { return allowed.includes(value) ? value : 'UNRECOGNIZED'; }
function integer(value) { return Number.isSafeInteger(value) && value >= 0 ? value : null; }
function normalizedProvider(value) {
  return known(typeof value === 'string' ? value.trim().toUpperCase() : '', [
    'PAYMENT_COMPLETED', 'PURCHASED', 'REFUNDED', 'PENDING', 'NOT_FOUND', 'FAILED', 'ERROR', 'UNKNOWN',
    'PREPARED', 'EXECUTING', 'SUBMITTED', 'SUCCESS', 'GRANTED', 'SENT', 'CANCELLED', 'SKIPPED', 'READY', 'PROCESSING',
    'ORDER_IN_PROGRESS', 'PAYMENT_PENDING', 'PENDING_GRANT', 'ALREADY_GRANTED', 'COMPLETED', 'MINIAPP_MISMATCH',
  ]);
}

function selectRecordId(db, kind, recordId, diagnosticId, scanLimit) {
  if ((recordId === undefined) === (diagnosticId === undefined)) fail('USE_ONE_RECORD_SELECTOR');
  if (recordId !== undefined) { createLedgerDiagnosticId(kind, recordId); return recordId; }
  const match = /^kitdiag1\.(iap|promotion|message)\.[a-f0-9]{64}$/.exec(diagnosticId ?? '');
  if (!match || match[1] !== kind) fail('INVALID_DIAGNOSTIC_ID');
  const [table, id] = LEDGERS[kind];
  const rows = db.query(`SELECT "${id}" AS id FROM "${table}" ORDER BY "${id}" LIMIT ?`).all(scanLimit + 1);
  for (const row of rows.slice(0, scanLimit)) {
    try {
      if (createLedgerDiagnosticId(kind, row.id) === diagnosticId) return row.id;
    } catch (error) {
      // Invalid legacy IDs cannot match, but still consume the bounded scan budget.
      if (!(error instanceof LedgerDiagnosticError) || error.code !== 'INVALID_RECORD_ID') throw error;
    }
  }
  if (rows.length > scanLimit) fail('DIAGNOSTIC_LOOKUP_LIMIT_REACHED');
  return null;
}

function common(row, now, timestampUnit) {
  const updatedAt = integer(row.updated_at);
  const multiplier = timestampUnit === 'seconds' ? 1000 : 1;
  const ageMs = updatedAt === null ? null : (now - updatedAt) * multiplier;
  return { status: row.status, providerStatus: normalizedProvider(row.provider_status),
    createdAt: integer(row.created_at), updatedAt, timestampUnit,
    ageMs: Number.isSafeInteger(ageMs) && ageMs >= 0 ? ageMs : null,
    clockSkew: updatedAt !== null && updatedAt > now,
    hasFailureReason: Boolean(row.has_failure_reason) };
}

function inspectIap(db, id, now, unit) {
  requireColumns(db, 'iap_orders', ['order_id', 'status', 'provider_status', 'created_at', 'updated_at', 'granted_at', 'completed_at', 'refunded_at', 'failure_reason']);
  const row = db.query(`SELECT status, provider_status, created_at, updated_at, granted_at, completed_at, refunded_at,
    failure_reason IS NOT NULL AS has_failure_reason FROM iap_orders WHERE order_id=?`).get(id);
  if (!row) return null;
  row.status = known(row.status, ['FAILED', 'GRANTED', 'NOT_FOUND', 'PENDING', 'PENDING_GRANT', 'REFUNDED', 'UNKNOWN']);
  const report = { ...common(row, now, unit), locallyGranted: row.granted_at !== null,
    completionConfirmed: row.completed_at !== null, refunded: row.refunded_at !== null,
    subscription: { available: false } };
  const entitlementColumns = columns(db, 'iap_subscription_entitlements');
  if (entitlementColumns) {
    requireColumns(db, 'iap_subscription_entitlements', ['order_id', 'status', 'access_granted', 'needs_reconciliation']);
    const entitlement = db.query('SELECT status, access_granted, needs_reconciliation FROM iap_subscription_entitlements WHERE order_id=?').get(id);
    report.subscription = { available: true, present: Boolean(entitlement),
      ...(entitlement ? { status: known(entitlement.status, ['ACTIVE', 'EXPIRED', 'IN_GRACE_PERIOD', 'ON_HOLD', 'PAUSED', 'REVOKED']),
        storedAccessFlag: entitlement.access_granted === 1, needsReconciliation: entitlement.needs_reconciliation !== 0 } : {}),
      authorizesAccess: false };
  }
  const verified = ['PENDING_GRANT', 'GRANTED', 'REFUNDED'].includes(row.status) && ['PAYMENT_COMPLETED', 'PURCHASED', 'REFUNDED'].includes(report.providerStatus);
  let actions;
  if (!verified) actions = ['verify-order-with-provider'];
  else if (report.refunded || row.status === 'REFUNDED') actions = ['review-refund-policy'];
  else if (report.locallyGranted && !report.completionConfirmed) actions = ['confirm-existing-grant-completion'];
  else if (row.status === 'GRANTED' && !report.locallyGranted) actions = ['reconcile-grant-history-without-regrant'];
  else if (!report.locallyGranted) actions = ['review-local-grant-transaction'];
  else actions = ['none'];
  if (report.subscription.needsReconciliation) {
    actions = actions.filter(action => action !== 'none');
    actions.push('reconcile-subscription-events');
  }
  return { record: report, actions };
}

function inspectPromotion(db, id, now, unit) {
  const present = requireColumns(db, 'promotion_reward_ledger', ['id', 'status', 'provider_status', 'provider_transaction_key', 'failure_reason', 'created_at', 'updated_at', 'granted_at']);
  if (present.has('protocol') !== present.has('execution_started_at')) fail('LEDGER_SCHEMA_UNAVAILABLE');
  const hasV2 = present.has('protocol');
  const row = db.query(`SELECT status, provider_status, created_at, updated_at, granted_at,
    ${hasV2 ? 'protocol, execution_started_at' : 'NULL AS protocol, NULL AS execution_started_at'},
    failure_reason IS NOT NULL AS has_failure_reason,
    length(trim(COALESCE(provider_transaction_key,''))) > 0 AS has_transaction_key
    FROM promotion_reward_ledger WHERE id=?`).get(id);
  if (!row) return null;
  row.status = known(row.status, ['recorded', 'pending', 'success', 'failed', 'cancelled']);
  const record = { ...common(row, now, unit), hasTransactionKey: Boolean(row.has_transaction_key), granted: row.granted_at !== null };
  record.execution = {
    schemaAvailable: hasV2,
    protocol: row.protocol === null ? 'legacy' : known(row.protocol, ['three-step']),
    started: row.protocol === 'three-step' ? row.execution_started_at !== null : null,
    startedAt: integer(row.execution_started_at),
  };
  let actions;
  if (row.status === 'success' || row.status === 'cancelled') actions = ['none'];
  else if (row.status === 'pending' && record.execution.protocol === 'three-step' && !record.execution.started) {
    actions = ['review-unstarted-three-step-attempt'];
  } else {
    actions = record.hasTransactionKey ? ['query-original-promotion-transaction'] : ['manual-reconciliation-without-new-key'];
  }
  return { record, actions };
}

function messageAgreement(db, id) {
  const templates = columns(db, 'message_templates');
  const message = db.query('SELECT user_id, purpose, template_code FROM message_outbox WHERE id=?').get(id);
  const report = { templateRegistryAvailable: Boolean(templates), authorizesDispatch: false,
    functionalOptedIn: null, marketingOptedIn: null };
  // The production gate checks marketing consent even without a template registry.
  if (columns(db, 'notification_consents')) {
    requireColumns(db, 'notification_consents', ['user_id', 'purpose', 'status']);
    report.marketingOptedIn = Boolean(db.query("SELECT 1 FROM notification_consents WHERE user_id=? AND purpose='MARKETING' AND status='OPTED_IN'").get(message.user_id));
  }
  if (!templates) return report;
  requireColumns(db, 'message_templates', ['template_code', 'purpose', 'status', 'requires_agreement']);
  // Legacy registries use their template_code when no explicit agreement-code column exists.
  let codeColumn = 'template_code';
  if (templates.has('notification_template_code')) codeColumn = 'notification_template_code';
  else if (templates.has('agreement_template_code')) codeColumn = 'agreement_template_code';
  const template = db.query(`SELECT status, purpose=? AS purpose_matches, requires_agreement,
    "${codeColumn}" AS agreement_code FROM message_templates WHERE template_code=?`).get(message.purpose, message.template_code);
  report.templatePresent = template?.status !== undefined && template.status !== null;
  if (!report.templatePresent) return report;
  Object.assign(report, { templateStatus: known(template.status, ['DRAFT', 'APPROVED', 'PAUSED', 'RETIRED']),
    purposeMatches: template.purpose_matches === 1, requiresAgreement: template.requires_agreement !== 0 });
  const agreements = columns(db, 'notification_template_agreements');
  let agreementCode = null;
  if (agreements?.has('template_code')) agreementCode = 'template_code';
  else if (agreements?.has('agreement_template_code')) agreementCode = 'agreement_template_code';
  if (agreements && agreementCode && template.agreement_code) {
    requireColumns(db, 'notification_template_agreements', ['user_id', 'status']);
    report.functionalOptedIn = Boolean(db.query(`SELECT 1 FROM notification_template_agreements WHERE user_id=? AND "${agreementCode}"=? AND status='OPTED_IN'`).get(message.user_id, template.agreement_code));
  }
  return report;
}

function inspectMessage(db, id, now, unit) {
  const present = requireColumns(db, 'message_outbox', ['id', 'user_id', 'template_code', 'purpose', 'status', 'provider_status', 'created_at', 'updated_at', 'failure_reason', 'attempts', 'provider_sent_push_count', 'provider_sent_inbox_count']);
  const row = db.query(`SELECT status, provider_status, created_at, updated_at, attempts,
    provider_sent_push_count, provider_sent_inbox_count, ${present.has('recipient_kind') ? 'recipient_kind' : "'TOSS_USER_KEY' AS recipient_kind"},
    failure_reason IS NOT NULL AS has_failure_reason FROM message_outbox WHERE id=?`).get(id);
  if (!row) return null;
  row.status = known(row.status, ['READY', 'LOCKED', 'SENT', 'FAILED', 'SKIPPED', 'CANCELLED']);
  const record = { ...common(row, now, unit), recipientKind: known(row.recipient_kind, ['TOSS_USER_KEY', 'ANONYMOUS_KEY']),
    attempts: integer(row.attempts), channels: { push: integer(row.provider_sent_push_count), inbox: integer(row.provider_sent_inbox_count) },
    agreement: messageAgreement(db, id), lease: { available: false } };
  if (columns(db, 'message_outbox_attempts')) {
    requireColumns(db, 'message_outbox_attempts', ['outbox_id', 'attempt_number', 'status', 'lease_expires_at', 'dispatch_started_at']);
    const attempt = db.query('SELECT attempt_number, status, lease_expires_at, dispatch_started_at FROM message_outbox_attempts WHERE outbox_id=? ORDER BY attempt_number DESC LIMIT 1').get(id);
    record.lease = { available: true, present: Boolean(attempt), ...(attempt ? {
      attemptNumber: integer(attempt.attempt_number), status: known(attempt.status, ['CLAIMED', 'DISPATCHING', 'SENT', 'FAILED', 'SKIPPED', 'EXPIRED', 'UNKNOWN']),
      expiresAt: integer(attempt.lease_expires_at), expired: integer(attempt.lease_expires_at) !== null && attempt.lease_expires_at <= now,
      dispatchStarted: attempt.dispatch_started_at !== null,
    } : {}) };
  }
  const terminal = ['SENT', 'SKIPPED', 'CANCELLED'].includes(row.status);
  const uncertain = ['UNKNOWN', 'DISPATCHING'].includes(record.lease.status) || record.providerStatus === 'UNKNOWN' ||
    (row.status === 'LOCKED' && (!record.lease.present || record.lease.dispatchStarted));
  let actions;
  if (terminal) actions = ['none'];
  else if (uncertain) actions = ['reconcile-uncertain-dispatch-without-resend'];
  else if (row.status === 'LOCKED' && record.lease.status === 'CLAIMED' && record.lease.expired) actions = ['review-expired-unstarted-claim'];
  else actions = ['recheck-dispatch-gates-and-current-attempt'];
  return { record, actions };
}

/** Private operator inspection only; never use the report as authorization. */
export function inspectLedger({ db, kind, recordId, diagnosticId, timestampUnit, now, scanLimit = 10_000 }) {
  if (!Object.hasOwn(LEDGERS, kind)) fail('INVALID_LEDGER_KIND');
  if (!['seconds', 'milliseconds'].includes(timestampUnit)) fail('EXPLICIT_TIMESTAMP_UNIT_REQUIRED');
  now ??= timestampUnit === 'seconds' ? Math.floor(Date.now() / 1000) : Date.now();
  if (integer(now) === null || !Number.isInteger(scanLimit) || scanLimit < 1 || scanLimit > 100_000) fail('INVALID_INSPECTION_BOUNDS');
  return db.transaction(() => {
    const [table, idColumn] = LEDGERS[kind];
    requireColumns(db, table, [idColumn]);
    const id = selectRecordId(db, kind, recordId, diagnosticId, scanLimit);
    const selected = id === null ? null : { iap: inspectIap, promotion: inspectPromotion, message: inspectMessage }[kind](db, id, now, timestampUnit);
    if (!selected) return { schemaVersion: 1, ok: false, code: 'RECORD_NOT_FOUND', kind };
    return { schemaVersion: 1, ok: true, kind, diagnosticId: createLedgerDiagnosticId(kind, id), observedAt: now,
      record: selected.record,
      recoveryPlan: { actions: selected.actions, executable: false, requiresFreshRead: true, allowsAutomaticRetry: false,
        expected: { status: selected.record.status, updatedAt: selected.record.updatedAt, ...(kind === 'message' ? { attemptNumber: selected.record.lease.attemptNumber ?? null } : {}) } } };
  })();
}

export function formatLedgerDiagnostic(report) {
  if (!report.ok) return `${report.code}: ${report.kind}`;
  return [report.diagnosticId, `Ledger: ${report.kind}`, `Status: ${report.record.status} / ${report.record.providerStatus}`,
    `Next checks: ${report.recoveryPlan.actions.join(', ')}`, 'Read-only advice. Re-read current state and use authorized shared helpers before any action.',
    JSON.stringify(report.record, null, 2)].join('\n');
}
