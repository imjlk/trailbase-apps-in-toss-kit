import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, copyFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRestoreCheckpointCheck, evaluateRestoreCheckpoint } from "../src/restore-checkpoint.mjs";

const evidence = { database: { generation: "test", sequence: 1 }, witness: { generation: "test", sequence: 1 }, dispatchPaused: true, inFlight: 0, unresolved: 0 };

test("missing, mismatched, unresolved and active restore evidence blocks readiness", () => {
  expect(evaluateRestoreCheckpoint(evidence).ok).toBe(true);
  expect(evaluateRestoreCheckpoint(null).ok).toBe(false);
  for (const patch of [{ witness: null }, { witness: { generation: "other", sequence: 1 } },
    { witness: { generation: "test", sequence: 2 } }, { dispatchPaused: false }, { inFlight: 1 },
    { unresolved: 1 }, { unresolved: undefined }, { database: { generation: "test", sequence: -1 } }]) {
    expect(evaluateRestoreCheckpoint({ ...evidence, ...patch }).ok).toBe(false);
  }
});

test("an old SQLite backup cannot authorize duplicate external dispatch or settlement", () => {
  const root = mkdtempSync(join(tmpdir(), "kit-old-backup-"));
  const livePath = join(root, "live.sqlite"); const backupPath = join(root, "old.sqlite");
  let live; let restored; let external;
  try {
    live = new Database(livePath);
    live.exec("CREATE TABLE checkpoint(generation TEXT, sequence INTEGER); INSERT INTO checkpoint VALUES ('fixture',0); CREATE TABLE work(id TEXT PRIMARY KEY,status TEXT); INSERT INTO work VALUES ('request-original','PENDING');");
    live.close(); live = undefined;
    copyFileSync(livePath, backupPath); // Actual file snapshot taken before dispatch.
    live = new Database(livePath);
    external = new Database(join(root, "independent-witness.sqlite"));
    external.exec("CREATE TABLE witness(generation TEXT, sequence INTEGER); INSERT INTO witness VALUES ('fixture',0); CREATE TABLE provider(id TEXT PRIMARY KEY,status TEXT); CREATE TABLE calls(n INTEGER); INSERT INTO calls VALUES (0);");
    // The independent durable witness precedes any external effect. Synthetic only.
    external.exec("UPDATE witness SET sequence=1; INSERT INTO provider VALUES ('request-original','SENT'); UPDATE calls SET n=n+1;");
    external.close();
    external = new Database(join(root, "independent-witness.sqlite"));
    const witness = external.query("SELECT * FROM witness").get();
    live.exec("UPDATE work SET status='SENT'; UPDATE checkpoint SET sequence=1;");
    live.close(); live = undefined;
    restored = new Database(backupPath);
    const before = { database: restored.query("SELECT * FROM checkpoint").get(), witness, dispatchPaused: true, inFlight: 0, unresolved: 1 };
    const ready = evaluateRestoreCheckpoint(before).ok;
    expect(ready).toBe(false);
    // The reference dispatcher obeys the guard; a regression would count a resend.
    if (ready) external.exec("UPDATE calls SET n=n+1;");
    expect(restored.query("SELECT status FROM work").get().status).toBe("PENDING");
    // A pending restored row is quarantined, never resent with a new ID.
    restored.exec("UPDATE work SET status='UNKNOWN';");
    expect(evaluateRestoreCheckpoint({ ...before, unresolved: 0 }).ok).toBe(false); // Closing a flag cannot hide the history gap.
    expect(external.query("SELECT status FROM provider WHERE id=?").get("request-original").status).toBe("SENT"); // Read-only original-ID reconciliation.
    restored.transaction(() => {
      restored.exec("UPDATE work SET status='SENT'; UPDATE checkpoint SET sequence=1;");
    })();
    expect(evaluateRestoreCheckpoint({ ...before, database: restored.query("SELECT * FROM checkpoint").get(), unresolved: 0 }).ok).toBe(true);
    expect(external.query("SELECT n FROM calls").get().n).toBe(1);
    expect(external.query("SELECT count(*) AS n FROM provider").get().n).toBe(1);
  } finally { live?.close(); restored?.close(); external?.close(); rmSync(root, { recursive: true, force: true }); }
});

test("Doctor reports only redacted evidence errors", async () => {
  const check = createRestoreCheckpointCheck({ readEvidence: async () => { throw new Error("PRIVATE-CANARY"); } });
  const result = await check.run(); expect(result.ok).toBe(false); expect(JSON.stringify(result)).not.toContain("PRIVATE-CANARY");
  expect((await createRestoreCheckpointCheck({ readEvidence: async () => evidence }).run()).ok).toBe(true);
});
