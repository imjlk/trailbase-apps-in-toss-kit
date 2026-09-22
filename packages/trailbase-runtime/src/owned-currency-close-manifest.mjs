import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const MANIFEST_SCHEMA_VERSION = 1;
const REPORT_FORMATS = new Set(["json", "csv"]);
const TIMESTAMP_UNITS = new Set(["seconds", "milliseconds"]);
const CLOSE_STAGES = ["GENERATED", "REVIEWED", "SUBMITTED"];
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_TIMEZONE = /^[A-Za-z0-9][A-Za-z0-9._+/-]{0,63}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40,64}$/;
const FORBIDDEN_REFERENCE =
  /(promotion[_-]?code|user[_-]?key|hmac|sealed|token|secret|private[_-]?key)/i;

export class OwnedCurrencyCloseManifestError extends Error {
  constructor(code) {
    super(code);
    this.name = "OwnedCurrencyCloseManifestError";
    this.code = code;
  }
}

export function validateOwnedCurrencyCloseManifest(
  manifest,
  { reportBytes, report } = {},
) {
  const normalized = validateManifestShape(manifest);
  if (reportBytes === undefined) {
    fail("MANIFEST_REPORT_BYTES_REQUIRED");
  }
  const bytes = toBytes(reportBytes);
  const reportSha256 = sha256(bytes);
  if (reportSha256 !== normalized.reportSha256) {
    fail("MANIFEST_REPORT_HASH_MISMATCH");
  }

  const reportValue = report ?? parseReport(bytes, normalized.reportFormat);
  if (normalized.reportFormat === "json") {
    validateReportMetadata(normalized, reportValue);
  }

  return {
    manifest: normalized,
    reportSha256,
  };
}

export function sha256ReportBytes(value) {
  return sha256(toBytes(value));
}

export function createOwnedCurrencyCloseManifestCheck({
  name = "Owned currency close manifest",
  manifestFile,
  reportFile,
  required = true,
} = {}) {
  return {
    name,
    required,
    run() {
      if (!manifestFile) return failure("MANIFEST_FILE_REQUIRED");
      if (!reportFile) return failure("MANIFEST_REPORT_FILE_REQUIRED");
      if (!existsSync(manifestFile)) return failure("MANIFEST_FILE_NOT_FOUND");
      if (!existsSync(reportFile))
        return failure("MANIFEST_REPORT_FILE_NOT_FOUND");

      let manifest;
      try {
        manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
      } catch {
        return failure("MANIFEST_INVALID_JSON");
      }

      try {
        const result = validateOwnedCurrencyCloseManifest(manifest, {
          reportBytes: readFileSync(reportFile),
        });
        return {
          ok: true,
          message: "Owned currency close manifest verified",
          details: [result.reportSha256],
        };
      } catch (error) {
        return failure(
          error instanceof OwnedCurrencyCloseManifestError
            ? error.code
            : "MANIFEST_VALIDATION_FAILED",
        );
      }
    },
  };
}

function validateManifestShape(manifest) {
  if (!isRecord(manifest)) fail("MANIFEST_INVALID_SHAPE");
  knownKeys(manifest, [
    "schemaVersion",
    "reportSchemaVersion",
    "reportFormat",
    "reportRevision",
    "appId",
    "period",
    "timestampUnit",
    "timezone",
    "reportSha256",
    "snapshotRef",
    "sourceCommit",
    "tool",
    "policyVersions",
    "approvalRevision",
    "records",
    "correctionOf",
  ]);
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    fail("MANIFEST_SCHEMA_VERSION_UNSUPPORTED");
  }
  if (
    !Number.isSafeInteger(manifest.reportSchemaVersion) ||
    manifest.reportSchemaVersion < 1
  ) {
    fail("MANIFEST_REPORT_SCHEMA_VERSION_INVALID");
  }
  if (!REPORT_FORMATS.has(manifest.reportFormat))
    fail("MANIFEST_REPORT_FORMAT_INVALID");
  safeReference(manifest.reportRevision, "MANIFEST_REPORT_REVISION_INVALID");
  safeReference(manifest.appId, "MANIFEST_APP_ID_INVALID");
  if (!isRecord(manifest.period)) fail("MANIFEST_PERIOD_INVALID");
  knownKeys(manifest.period, ["start", "end"]);
  if (
    !safeNonNegativeInteger(manifest.period.start) ||
    !safeNonNegativeInteger(manifest.period.end)
  ) {
    fail("MANIFEST_PERIOD_INVALID");
  }
  if (manifest.period.start >= manifest.period.end)
    fail("MANIFEST_PERIOD_INVALID");
  if (!TIMESTAMP_UNITS.has(manifest.timestampUnit))
    fail("MANIFEST_TIMESTAMP_UNIT_INVALID");
  if (
    typeof manifest.timezone !== "string" ||
    !SAFE_TIMEZONE.test(manifest.timezone)
  ) {
    fail("MANIFEST_TIMEZONE_INVALID");
  }
  if (!SHA256.test(manifest.reportSha256)) fail("MANIFEST_REPORT_HASH_INVALID");
  safeReference(manifest.snapshotRef, "MANIFEST_SNAPSHOT_REF_INVALID");
  if (!COMMIT.test(manifest.sourceCommit))
    fail("MANIFEST_SOURCE_COMMIT_INVALID");
  if (!isRecord(manifest.tool)) fail("MANIFEST_TOOL_INVALID");
  knownKeys(manifest.tool, ["name", "version"]);
  safeReference(manifest.tool.name, "MANIFEST_TOOL_NAME_INVALID");
  safeReference(manifest.tool.version, "MANIFEST_TOOL_VERSION_INVALID");
  if (
    !Array.isArray(manifest.policyVersions) ||
    manifest.policyVersions.length === 0 ||
    new Set(manifest.policyVersions).size !== manifest.policyVersions.length
  ) {
    fail("MANIFEST_POLICY_VERSIONS_INVALID");
  }
  for (const policyVersion of manifest.policyVersions) {
    safeReference(policyVersion, "MANIFEST_POLICY_VERSION_INVALID");
  }
  if (
    !Number.isSafeInteger(manifest.approvalRevision) ||
    manifest.approvalRevision < 1
  ) {
    fail("MANIFEST_APPROVAL_REVISION_INVALID");
  }
  validateRecords(manifest.records);
  if (manifest.correctionOf !== null && manifest.correctionOf !== undefined) {
    safeReference(manifest.correctionOf, "MANIFEST_CORRECTION_REF_INVALID");
    if (manifest.correctionOf === manifest.reportRevision) {
      fail("MANIFEST_CORRECTION_REF_INVALID");
    }
  }
  return manifest;
}

function validateRecords(records) {
  if (
    !Array.isArray(records) ||
    records.length === 0 ||
    records.length > CLOSE_STAGES.length
  ) {
    fail("MANIFEST_RECORDS_INVALID");
  }
  let previousRecordedAt = -1;
  records.forEach((record, index) => {
    if (!isRecord(record)) fail("MANIFEST_RECORDS_INVALID");
    knownKeys(record, ["status", "recordedAt", "evidenceRef"]);
    if (record.status !== CLOSE_STAGES[index])
      fail("MANIFEST_STAGE_ORDER_INVALID");
    if (
      !safeNonNegativeInteger(record.recordedAt) ||
      record.recordedAt < previousRecordedAt
    ) {
      fail("MANIFEST_RECORD_TIME_INVALID");
    }
    previousRecordedAt = record.recordedAt;
    safeReference(record.evidenceRef, "MANIFEST_EVIDENCE_REF_INVALID");
  });
}

function validateReportMetadata(manifest, report) {
  if (!isRecord(report)) fail("MANIFEST_REPORT_INVALID");
  if (report.schemaVersion !== manifest.reportSchemaVersion) {
    fail("MANIFEST_REPORT_SCHEMA_MISMATCH");
  }
  if (report.timestampUnit !== manifest.timestampUnit) {
    fail("MANIFEST_TIMESTAMP_UNIT_MISMATCH");
  }
  if (
    !isRecord(report.period) ||
    report.period.start !== manifest.period.start ||
    report.period.end !== manifest.period.end
  ) {
    fail("MANIFEST_PERIOD_MISMATCH");
  }
  if (!isRecord(report.tool)) fail("MANIFEST_REPORT_TOOL_MISSING");
  if (report.tool.sourceCommit !== manifest.sourceCommit) {
    fail("MANIFEST_SOURCE_COMMIT_MISMATCH");
  }
  if (
    report.tool.name !== manifest.tool.name ||
    report.tool.version !== manifest.tool.version
  ) {
    fail("MANIFEST_TOOL_MISMATCH");
  }
  if (!Array.isArray(report.lines) || !isRecord(report.quality)) {
    fail("MANIFEST_REPORT_INVALID");
  }
  const reportPolicies = new Set(
    report.lines.map((line) => line?.policyVersion),
  );
  for (const policyVersion of reportPolicies) {
    if (!manifest.policyVersions.includes(policyVersion)) {
      fail("MANIFEST_POLICY_VERSION_MISMATCH");
    }
  }
}

function parseReport(bytes, reportFormat) {
  if (reportFormat !== "json") return undefined;
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    fail("MANIFEST_REPORT_INVALID_JSON");
  }
}

function knownKeys(value, keys) {
  const allowed = new Set(keys);
  if (Object.keys(value).some((key) => !allowed.has(key)))
    fail("MANIFEST_UNKNOWN_FIELD");
}

function safeReference(value, code) {
  if (
    typeof value !== "string" ||
    !SAFE_REFERENCE.test(value) ||
    FORBIDDEN_REFERENCE.test(value)
  ) {
    fail(code);
  }
}

function toBytes(value) {
  if (typeof value === "string" || value instanceof Uint8Array)
    return Buffer.from(value);
  fail("MANIFEST_REPORT_BYTES_INVALID");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function failure(message) {
  return { ok: false, failures: [message] };
}

function fail(code) {
  throw new OwnedCurrencyCloseManifestError(code);
}
