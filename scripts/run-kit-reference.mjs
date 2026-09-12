#!/usr/bin/env bun
// Fixed kit-owned checks. Stores versioned, redacted evidence; never deploys.
import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { sourceState, requireStableSource, requireReportDestination, parseFixtureEvidence, validateRecordedEvidence } from "./reference/source-state.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--output") throw new Error("Usage: bun scripts/run-kit-reference.mjs --output <report.json>");
const output = resolve(args[1]);
requireReportDestination(root, output);
const scratch = mkdtempSync(join(tmpdir(), "kit-reference-"));
const results = [];
const run = (command, argv, extra = {}) => spawnSync(command === "bun" && process.versions.bun ? process.execPath : command, argv, {
  cwd: root, encoding: "utf8", timeout: 900_000, maxBuffer: 32 * 1024 * 1024,
  env: { ...process.env, ...extra },
});
const text = (command, argv) => {
  const result = run(command, argv);
  if (result.status !== 0 || result.error) throw new Error(`Required reference metadata unavailable: ${command}`);
  return result.stdout.trim();
};
const json = path => JSON.parse(readFileSync(join(root, path), "utf8"));
const hash = path => createHash("sha256").update(readFileSync(join(root, path))).digest("hex");
function lockedRustVersions(name) {
  const versions = readFileSync(join(root, "Cargo.lock"), "utf8").split("[[package]]")
    .filter(block => block.includes(`\nname = "${name}"\n`))
    .map(block => /^version = "([^"]+)"$/m.exec(block)?.[1]).filter(Boolean);
  if (!versions.length) throw new Error("Required Rust lock metadata unavailable");
  return [...new Set(versions)];
}
function step(name, command, argv, { env, parseJson = false, validate } = {}) {
  const started = performance.now(); const result = run(command, argv, env);
  const record = { name, ok: !result.error && result.status === 0, durationMilliseconds: Math.round(performance.now() - started) };
  if (parseJson) validateRecordedEvidence(record, () => parseFixtureEvidence(result.stdout), "Expected structured fixture output was unavailable");
  if (validate) validateRecordedEvidence(record, validate, "Reference output validation failed");
  if (!record.ok && !record.reason) record.reason = "Reference command failed; run the named kit check for diagnostics";
  results.push(record);
  console.log(`${record.ok ? "PASS" : "FAIL"} ${name} (${record.durationMilliseconds} ms)`);
  if (!record.ok) throw new Error(record.reason);
  return record;
}
const report = { schemaVersion: 1, scope: "kit-owned synthetic fixtures only", startedAt: new Date().toISOString(), ok: false,
  limitations: ["No consumer repository, production service, real payment, device eligibility or certificate readiness was validated", "Fixture timings are observations on this runner and are not production latency or throughput guarantees", "Passing evidence does not authorize release publication or automatic recovery/resume"], results };
try {
  report.source = { ...sourceState(root, output),
    lockSha256: { bun: hash("bun.lock"), cargo: hash("Cargo.lock") } };
  if (report.source.trackedChanges.length || report.source.untrackedSource.length) throw new Error("Commit source changes before generating release evidence");
  report.versions = { bun: text("bun", ["--version"]), node: text("node", ["--version"]), rust: text("rustc", ["--version"]),
    rnSdk: json("node_modules/@apps-in-toss/framework/package.json").version,
    minimumRnSdk: json("node_modules/@apps-in-toss/framework-min-supported/package.json").version,
    webSdk: json("node_modules/@apps-in-toss/web-framework/package.json").version,
    proxyPackage: json("services/toss-mtls-client-proxy/package.json").version,
    rustPackages: Object.fromEntries(["trailbase-wasm", "trailbase-guest-common", "trailbase-toss-identity"].map(name => [name, lockedRustVersions(name)])) };
  step("Evidence integrity checks", "bun", ["test", "scripts/reference/source-state.test.mjs"]);
  step("Rust helper tests", "cargo", ["test", "--workspace"]);
  step("JavaScript, client and proxy tests", "bun", ["test", "packages", "services/toss-mtls-client-proxy"]);
  step("Current SDK type contracts", "bun", ["run", "packages:typecheck"]);
  step("Minimum RN SDK type contracts", "bun", ["run", "packages:typecheck:minimum"]);
  step("Combined functional migrations", "bun", ["run", "trailbase:functional-ledgers:smoke"], { parseJson: true });
  step("Normal WASM integration", "bun", ["run", "trailbase:wasm:smoke"], { env: { KIT_SMOKE_OPERATIONS_HOLD: "0" }, parseJson: true });
  step("Held WASM integration", "bun", ["run", "trailbase:wasm:smoke"], { env: { KIT_SMOKE_OPERATIONS_HOLD: "1" }, parseJson: true });
  step("Local fixture measurements", "bun", ["scripts/reference/benchmark.mjs"], { parseJson: true });
  const bundle = join(scratch, "bundle"); const meta = join(scratch, "bundle.json");
  report.browserBundle = step("WebView browser bundle", "bun", ["build", "packages/ait-web/src/index.ts", "--target", "browser", "--splitting", `--outdir=${bundle}`, `--metafile=${meta}`], {
    validate: () => {
      const graph = JSON.parse(readFileSync(meta, "utf8"));
      const inputs = Object.keys(graph.inputs);
      const rnRuntimeModules = inputs.filter(path => /(?:packages\/ait-rn\/|@apps-in-toss\/framework\/|react-native\/)/.test(path)).length;
      if (rnRuntimeModules) throw new Error("Web bundle unexpectedly includes an RN runtime");
      return { modules: inputs.length, rnRuntimeModules,
        totalBytes: Object.values(graph.outputs).reduce((total, item) => total + item.bytes, 0) };
    },
  }).evidence;
  requireStableSource(report.source, sourceState(root, output));
  report.ok = true;
} catch (error) {
  report.failure = error instanceof Error ? error.message : "Reference verification failed";
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  rmSync(scratch, { recursive: true, force: true });
  console.log(`Reference evidence written to ${output}`);
}
