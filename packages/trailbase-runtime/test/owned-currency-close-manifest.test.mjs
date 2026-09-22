import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createOwnedCurrencyCloseManifestCheck,
  OwnedCurrencyCloseManifestError,
  sha256ReportBytes,
  validateOwnedCurrencyCloseManifest,
} from "../src/owned-currency-close-manifest.mjs";
import { buildOwnedCurrencyReport } from "../src/owned-currency-report.mjs";

const sourceCommit = "0123456789abcdef0123456789abcdef01234567";

describe("owned currency close manifest", () => {
  test("validates the report bytes, metadata, policy revision, and close stages", () => {
    const reportBytes = reportFixture();
    const manifest = manifestFixture(reportBytes);

    const result = validateOwnedCurrencyCloseManifest(manifest, {
      reportBytes,
    });

    expect(result.reportSha256).toBe(manifest.reportSha256);
    expect(result.manifest).toEqual(manifest);
  });

  test("fails when the report hash, period, or timestamp unit differs", () => {
    const reportBytes = reportFixture();
    const manifest = manifestFixture(reportBytes);

    expectCode(
      () =>
        validateOwnedCurrencyCloseManifest(
          { ...manifest, reportSha256: "0".repeat(64) },
          { reportBytes },
        ),
      "MANIFEST_REPORT_HASH_MISMATCH",
    );
    expectCode(
      () =>
        validateOwnedCurrencyCloseManifest(
          { ...manifest, period: { start: 1, end: 2 } },
          { reportBytes },
        ),
      "MANIFEST_PERIOD_MISMATCH",
    );
    expectCode(
      () =>
        validateOwnedCurrencyCloseManifest(
          { ...manifest, timestampUnit: "seconds" },
          { reportBytes },
        ),
      "MANIFEST_TIMESTAMP_UNIT_MISMATCH",
    );
  });

  test("requires generated-first ordered evidence and rejects sensitive references", () => {
    const reportBytes = reportFixture();
    const manifest = manifestFixture(reportBytes);

    expectCode(
      () =>
        validateOwnedCurrencyCloseManifest(
          {
            ...manifest,
            records: [manifest.records[1]],
          },
          { reportBytes },
        ),
      "MANIFEST_STAGE_ORDER_INVALID",
    );
    expectCode(
      () =>
        validateOwnedCurrencyCloseManifest(
          { ...manifest, snapshotRef: "reports/private/user-key.txt" },
          { reportBytes },
        ),
      "MANIFEST_SNAPSHOT_REF_INVALID",
    );
    expectCode(
      () =>
        validateOwnedCurrencyCloseManifest(
          { ...manifest, leakedSecret: "secret" },
          { reportBytes },
        ),
      "MANIFEST_UNKNOWN_FIELD",
    );
    expectCode(
      () =>
        validateOwnedCurrencyCloseManifest(
          { ...manifest, approvalRevision: 0 },
          { reportBytes },
        ),
      "MANIFEST_APPROVAL_REVISION_INVALID",
    );
    expectCode(
      () =>
        validateOwnedCurrencyCloseManifest(
          { ...manifest, correctionOf: manifest.reportRevision },
          { reportBytes },
        ),
      "MANIFEST_CORRECTION_REF_INVALID",
    );
    expectCode(
      () =>
        validateOwnedCurrencyCloseManifest(
          { ...manifest, reportFormat: "csv" },
          { reportBytes },
        ),
      "MANIFEST_REPORT_FORMAT_INVALID",
    );
    expectCode(
      () =>
        validateOwnedCurrencyCloseManifest(
          { ...manifest, timezone: "Mars/Phobos" },
          { reportBytes },
        ),
      "MANIFEST_TIMEZONE_INVALID",
    );
    expectCode(
      () =>
        validateOwnedCurrencyCloseManifest(
          { ...manifest, sourceCommit: "a".repeat(45) },
          { reportBytes },
        ),
      "MANIFEST_SOURCE_COMMIT_INVALID",
    );
    expectCode(
      () =>
        validateOwnedCurrencyCloseManifest(
          {
            ...manifest,
            records: [{ ...manifest.records[0], evidenceRef: "api-key-2026" }],
          },
          { reportBytes },
        ),
      "MANIFEST_EVIDENCE_REF_INVALID",
    );
    expect(
      validateOwnedCurrencyCloseManifest(
        {
          ...manifest,
          snapshotRef: "qa-passed-2026-09",
        },
        { reportBytes },
      ),
    ).toMatchObject({ reportSha256: manifest.reportSha256 });
    expectCode(
      () =>
        validateOwnedCurrencyCloseManifest(
          {
            ...manifest,
            snapshotRef: "user-pass",
          },
          { reportBytes },
        ),
      "MANIFEST_SNAPSHOT_REF_INVALID",
    );
    expectCode(
      () =>
        validateOwnedCurrencyCloseManifest(
          {
            ...manifest,
            snapshotRef: "passcode-2026",
          },
          { reportBytes },
        ),
      "MANIFEST_SNAPSHOT_REF_INVALID",
    );
  });

  test("does not infer review or submission from a generated report", () => {
    const reportBytes = reportFixture();
    const manifest = {
      ...manifestFixture(reportBytes),
      records: [manifestFixture(reportBytes).records[0]],
    };

    expect(
      validateOwnedCurrencyCloseManifest(manifest, { reportBytes }).manifest
        .records,
    ).toEqual([
      {
        status: "GENERATED",
        recordedAt: 1790870400000,
        evidenceRef: "report-generated",
      },
    ]);
  });

  test("validates a report produced by the owned-currency report builder", () => {
    const db = new Database(":memory:");
    try {
      db.exec(`
        CREATE TABLE owned_currency_events (
          id TEXT PRIMARY KEY,
          currency_code TEXT NOT NULL,
          unit_code TEXT NOT NULL,
          event_type TEXT NOT NULL,
          quantity INTEGER NOT NULL,
          source_type TEXT NOT NULL,
          source_id TEXT NOT NULL,
          policy_version TEXT NOT NULL,
          valuation_amount INTEGER,
          valuation_currency_code TEXT,
          occurred_at INTEGER NOT NULL,
          conversion_group_id TEXT
        ) STRICT;
        CREATE TABLE owned_currency_policies (
          currency_code TEXT NOT NULL,
          unit_code TEXT NOT NULL,
          policy_version TEXT NOT NULL,
          valuation_mode TEXT NOT NULL,
          valuation_currency_code TEXT,
          conversion_numerator INTEGER,
          conversion_denominator INTEGER,
          effective_from INTEGER NOT NULL,
          effective_to INTEGER,
          PRIMARY KEY (currency_code, unit_code, policy_version)
        ) STRICT;
      `);
      db.query(
        `INSERT INTO owned_currency_policies
        (currency_code, unit_code, policy_version, valuation_mode, valuation_currency_code,
         conversion_numerator, conversion_denominator, effective_from)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "gold_dust",
        "mg",
        "gold-dust-v1",
        "FIXED_RATE",
        "TOSS_POINT",
        1,
        100,
        0,
      );
      db.query(
        `INSERT INTO owned_currency_events
        (id, currency_code, unit_code, event_type, quantity, source_type, source_id,
         policy_version, occurred_at, conversion_group_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "event-1",
        "gold_dust",
        "mg",
        "ISSUE",
        1,
        "mission",
        "mission-1",
        "gold-dust-v1",
        1788192000000,
        null,
      );
      const report = buildOwnedCurrencyReport({
        db,
        periodStart: 1788192000000,
        periodEnd: 1790870400000,
        timestampUnit: "milliseconds",
        now: 1790870400000,
      });
      report.tool = {
        name: "trailbase-owned-currency-report",
        version: "0.5.0",
        sourceCommit,
      };
      const reportBytes = Buffer.from(JSON.stringify(report, null, 2));

      expect(
        validateOwnedCurrencyCloseManifest(manifestFixture(reportBytes), {
          reportBytes,
        }),
      ).toMatchObject({ reportSha256: sha256ReportBytes(reportBytes) });
    } finally {
      db.close();
    }
  });

  test("runs as a read-only release doctor check", () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), "owned-currency-close-manifest-"),
    );
    try {
      const reportFile = path.join(directory, "report.json");
      const manifestFile = path.join(directory, "manifest.json");
      const reportBytes = reportFixture();
      writeFileSync(reportFile, reportBytes);
      writeFileSync(
        manifestFile,
        JSON.stringify(manifestFixture(reportBytes), null, 2),
      );

      const check = createOwnedCurrencyCloseManifestCheck({
        manifestFile,
        reportFile,
      });
      expect(check.run()).toMatchObject({ ok: true });

      writeFileSync(reportFile, Buffer.from(`${reportBytes}\n`));
      expect(check.run()).toMatchObject({
        ok: false,
        failures: ["MANIFEST_REPORT_HASH_MISMATCH"],
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

function reportFixture() {
  return Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      timestampUnit: "milliseconds",
      period: { start: 1788192000000, end: 1790870400000 },
      tool: {
        name: "trailbase-owned-currency-report",
        version: "0.5.0",
        sourceCommit,
      },
      lines: [{ policyVersion: "gold-dust-v1" }],
      quality: {},
    }),
  );
}

function manifestFixture(reportBytes) {
  return {
    schemaVersion: 1,
    reportSchemaVersion: 1,
    reportFormat: "json",
    reportRevision: "2026-09-r1",
    appId: "gold-dust",
    period: { start: 1788192000000, end: 1790870400000 },
    timestampUnit: "milliseconds",
    timezone: "Asia/Seoul",
    reportSha256: sha256ReportBytes(reportBytes),
    snapshotRef: "snapshot-2026-09-r1",
    sourceCommit,
    tool: { name: "trailbase-owned-currency-report", version: "0.5.0" },
    policyVersions: ["gold-dust-v1"],
    approvalRevision: 2,
    records: [
      {
        status: "GENERATED",
        recordedAt: 1790870400000,
        evidenceRef: "report-generated",
      },
      {
        status: "REVIEWED",
        recordedAt: 1790874000000,
        evidenceRef: "operator-review-2026-09",
      },
      {
        status: "SUBMITTED",
        recordedAt: 1790877600000,
        evidenceRef: "operator-submit-2026-09",
      },
    ],
    correctionOf: null,
  };
}

function expectCode(callback, code) {
  let error;
  try {
    callback();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(OwnedCurrencyCloseManifestError);
  expect(error).toMatchObject({ code });
}
