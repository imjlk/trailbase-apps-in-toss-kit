import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  checkConsumerSdkCompatibility,
  satisfiesRange,
} from "./check-consumer-sdk-compatibility.mjs";

const script = fileURLToPath(new URL("./check-consumer-sdk-compatibility.mjs", import.meta.url));

function writeJson(root, path, value) {
  const target = join(root, path);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

function packageFixture({ runtime = "rn", aitVersion = "0.4.0", officialVersion = runtime === "rn" ? "2.10.10" : "3.5.0", aitPeer, declarations = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "consumer-sdk-compat-"));
  const officialName = runtime === "rn" ? "@apps-in-toss/framework" : "@apps-in-toss/web-framework";
  const officialSpec = runtime === "rn" ? "2.10.10" : "3.5.0";
  writeJson(root, "package.json", {
    name: "fixture-consumer",
    dependencies: declarations
      ? { "@ait-kit/sdk": aitVersion, [officialName]: officialSpec }
      : {},
  });
  writeJson(root, "node_modules/@ait-kit/sdk/package.json", {
    name: "@ait-kit/sdk",
    version: aitVersion,
    peerDependencies: {
      [officialName]: aitPeer ?? (runtime === "rn" ? ">=2.10.10" : ">=3.4.0"),
    },
    main: "./index.js",
  });
  writeFileSync(join(root, "node_modules/@ait-kit/sdk/index.js"), "throw new Error('SDK must not be imported');\n");
  writeJson(root, `node_modules/${officialName}/package.json`, {
    name: officialName,
    version: officialVersion,
    main: "./index.js",
  });
  writeFileSync(join(root, `node_modules/${officialName}/index.js`), "throw new Error('official SDK must not be imported');\n");
  return root;
}

test("reports installed RN and Web SDK versions while leaving runtime support unchecked", () => {
  for (const runtime of ["rn", "web"]) {
    const root = packageFixture({ runtime });
    try {
      const result = checkConsumerSdkCompatibility({ root, runtime });
      assert.equal(result.ok, true);
      assert.equal(result.runtimeSupport, "not_checked");
      assert.equal(result.checks.officialSdkPeerSatisfied, true);
      assert.equal(result.packages.aitKitSdk.version, "0.4.0");
      assert.equal(result.packages.officialSdk.version, runtime === "rn" ? "2.10.10" : "3.5.0");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("fails peer mismatches and missing platform packages without importing SDK code", () => {
  const root = packageFixture({ runtime: "rn", officialVersion: "2.9.0" });
  try {
    const result = checkConsumerSdkCompatibility({ root, runtime: "rn" });
    assert.equal(result.ok, false);
    assert.match(result.failures.join("\n"), /does not satisfy @ait-kit\/sdk peer range/);
    assert.doesNotThrow(() => readFileSync(join(root, "node_modules/@ait-kit/sdk/index.js"), "utf8"));
    rmSync(join(root, "node_modules/@apps-in-toss/framework"), { recursive: true, force: true });
    const missing = checkConsumerSdkCompatibility({ root, runtime: "rn" });
    assert.equal(missing.ok, false);
    assert.match(missing.failures.join("\n"), /Required package @apps-in-toss\/framework/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("transitive resolution is visible as a warning and never claims Toss runtime support", () => {
  const root = packageFixture({ runtime: "web", declarations: false });
  try {
    const result = checkConsumerSdkCompatibility({ root, runtime: "web" });
    assert.equal(result.ok, true);
    assert.equal(result.checks.aitKitDeclared, false);
    assert.equal(result.checks.officialSdkDeclared, false);
    assert.match(result.warnings.join("\n"), /resolved transitively/);
    assert.equal(result.runtimeSupport, "not_checked");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("supports the peer range forms used by published adapter metadata", () => {
  assert.equal(satisfiesRange("2.10.10", ">=2.10.10"), true);
  assert.equal(satisfiesRange("3.5.0", ">=3.4.0 <4"), true);
  assert.equal(satisfiesRange("4.0.0", ">=3.4.0 <4"), false);
  assert.equal(satisfiesRange("0.4.3", "^0.4.0"), true);
  assert.equal(satisfiesRange("0.5.0", "^0.4.0"), false);
});

test("CLI emits JSON and does not mutate a consumer lockfile", () => {
  const root = packageFixture({ runtime: "rn" });
  const lockfile = join(root, "bun.lock");
  writeFileSync(lockfile, "fixture lock\n");
  try {
    const result = spawnSync(process.execPath, [script, "--root", root, "--runtime", "rn", "--json"], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.runtimeSupport, "not_checked");
    assert.equal(readFileSync(lockfile, "utf8"), "fixture lock\n");
    const invalid = spawnSync(process.execPath, [script, "--root", root, "--runtime", "ios", "--json"], { encoding: "utf8" });
    assert.equal(invalid.status, 1);
    assert.match(JSON.parse(invalid.stdout).failures.join("\n"), /Unsupported runtime/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
