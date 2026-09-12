import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runSnapshots } from "./snapshot-apps-in-toss-docs.mjs";

test("failed documents preserve their last good snapshot while npm discovery advances", async (t) => {
  const outDir = await mkdtemp(join(tmpdir(), "ait-snapshot-"));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  const documents = async () => [{ key: "guide", title: "Guide", url: "https://example.test", sha256: "good", bytes: 10 }];
  const packages = (version) => async () => [{ packageName: "sdk", version }];
  await runSnapshots({ outDir, documents, packages: packages("1.0.0"), now: () => "first" });
  const original = await readFile(join(outDir, "docs-snapshot.json"), "utf8");
  await assert.rejects(runSnapshots({
    outDir,
    documents: async () => { throw new Error("Page Not Found"); },
    packages: packages("2.0.0"),
    now: () => "second"
  }), /Page Not Found/);
  assert.equal(await readFile(join(outDir, "docs-snapshot.json"), "utf8"), original);
  const latest = JSON.parse(await readFile(join(outDir, "packages-snapshot.json"), "utf8"));
  assert.equal(latest.packages[0].version, "2.0.0");
  assert.equal(latest.fetchedAt, "second");
  await runSnapshots({ outDir, documents, packages: packages("2.0.0"), now: () => "third" });
  assert.equal(await readFile(join(outDir, "docs-snapshot.json"), "utf8"), original);
  assert.equal(JSON.parse(await readFile(join(outDir, "packages-snapshot.json"), "utf8")).fetchedAt, "second");
});

test("failed npm discovery does not discard validated document updates", async (t) => {
  const outDir = await mkdtemp(join(tmpdir(), "ait-snapshot-"));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  await assert.rejects(runSnapshots({
    outDir,
    documents: async () => [],
    packages: async () => { throw new Error("registry unavailable"); }
  }), /registry unavailable/);
  assert.deepEqual(JSON.parse(await readFile(join(outDir, "docs-snapshot.json"), "utf8")).documents, []);
  await assert.rejects(readFile(join(outDir, "packages-snapshot.json")), { code: "ENOENT" });
});
