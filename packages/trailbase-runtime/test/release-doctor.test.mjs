import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  createCommandCheck,
  createPendingChangesetCheck,
  createProductionEnvCheck,
  createReleaseDoctorChecksFromConfig,
  formatDoctorResultLines,
  loadReleaseDoctorConfig,
  runConfiguredReleaseDoctor,
  runReleaseDoctor,
} from "../src/release-doctor.mjs";

const repoRoot = new URL("../../..", import.meta.url).pathname;
const cliScript = "packages/trailbase-runtime/bin/release-doctor.mjs";
const releaseDoctorConfigTemplate =
  "templates/trailbase/release/release-doctor.config.example.json";

describe("release doctor", () => {
  test("runs production env checks", async () => {
    const summary = await runReleaseDoctor({
      checks: [
        createProductionEnvCheck({
          name: "Env",
          raw: [
            "APP_ENV=production",
            "APP_BASE_URL=https://service.test",
            "MTLS_PROXY_MODE=stub",
          ].join("\n"),
          appEnvKey: "APP_ENV",
          optionalHttps: ["APP_BASE_URL"],
        }),
      ],
    });

    expect(summary.ok).toBe(true);
    expect(summary.passed).toBe(1);
  });

  test("reports production env check failures", async () => {
    const summary = await runReleaseDoctor({
      checks: [
        createProductionEnvCheck({
          name: "Env",
          raw: "APP_BASE_URL=http://service.test",
          appEnvKey: "APP_ENV",
          requiredHttps: ["APP_BASE_URL"],
          requiredSecrets: ["APP_SECRET"],
        }),
      ],
    });

    expect(summary.ok).toBe(false);
    expect(summary.failed).toBe(1);
    expect(summary.failures).toContain("Env: APP_ENV is required");
    expect(summary.failures).toContain("Env: APP_SECRET is required");
    expect(summary.failures).toContain("Env: APP_BASE_URL must start with https://");
  });

  test("normalizes required and optional failures", async () => {
    const summary = await runReleaseDoctor({
      checks: [
        {
          name: "Required",
          run: () => ({ ok: false, failures: ["required failure"] }),
        },
        {
          name: "Optional",
          required: false,
          run: () => ({ ok: false, failures: ["optional failure"] }),
        },
      ],
    });

    expect(summary.ok).toBe(false);
    expect(summary.failed).toBe(1);
    expect(summary.warnings).toBe(1);
    expect(summary.failures).toEqual(["Required: required failure"]);
    expect(summary.warningMessages).toEqual(["Optional: optional failure"]);
  });

  test("normalizes skipped checks", async () => {
    const summary = await runReleaseDoctor({
      checks: [
        {
          name: "Skipped",
          run: () => ({ ok: true, skipped: true, message: "not needed" }),
        },
      ],
    });

    expect(summary.ok).toBe(false);
    expect(summary.skipped).toBe(1);
    expect(formatDoctorResultLines(summary)).toContain("SKIPPED Skipped");
  });

  test("stops on fail fast", async () => {
    const seen = [];
    const summary = await runReleaseDoctor({
      failFast: true,
      checks: [
        {
          name: "First",
          run: () => {
            seen.push("first");
            return { ok: false, failures: ["stop"] };
          },
        },
        {
          name: "Second",
          run: () => {
            seen.push("second");
            return { ok: true };
          },
        },
      ],
    });

    expect(summary.ok).toBe(false);
    expect(seen).toEqual(["first"]);
  });

  test("normalizes non-Error thrown values", async () => {
    const summary = await runReleaseDoctor({
      checks: [
        {
          name: "Throwing",
          run: () => {
            throw "string failure";
          },
        },
      ],
    });

    expect(summary.ok).toBe(false);
    expect(summary.results[0].failures).toEqual(["string failure"]);
  });

  test("does not pass when no checks run", async () => {
    const summary = await runReleaseDoctor({ checks: [] });

    expect(summary.ok).toBe(false);
    expect(summary.passed).toBe(0);
  });

  test("runs command checks", async () => {
    const summary = await runReleaseDoctor({
      checks: [
        createCommandCheck({
          name: "Command",
          command: process.execPath,
          args: ["-e", "console.log('ok')"],
        }),
      ],
    });

    expect(summary.ok).toBe(true);
    expect(summary.results[0].output).toBe("");
  });

  test("does not buffer successful stdout unless requested", async () => {
    const calls = [];
    await runReleaseDoctor({
      checks: [
        createCommandCheck({
          name: "Default",
          command: "command",
          spawnSyncImpl: (_command, _args, options) => {
            calls.push(options);
            return { status: 0, stdout: "ignored", stderr: "" };
          },
        }),
        createCommandCheck({
          name: "Always",
          command: "command",
          captureOutput: "always",
          spawnSyncImpl: (_command, _args, options) => {
            calls.push(options);
            return { status: 0, stdout: "captured", stderr: "" };
          },
        }),
      ],
    });

    expect(calls[0].stdio).toEqual(["ignore", "ignore", "pipe"]);
    expect(calls[0].maxBuffer).toBe(8 * 1024 * 1024);
    expect(calls[0].timeout).toBe(300_000);
    expect(calls[1].stdio).toEqual(["ignore", "pipe", "pipe"]);
  });

  test("can capture successful command output when requested", async () => {
    const summary = await runReleaseDoctor({
      checks: [
        createCommandCheck({
          name: "Command",
          command: process.execPath,
          args: ["-e", "console.log('ok')"],
          captureOutput: "always",
        }),
      ],
    });

    expect(summary.ok).toBe(true);
    expect(summary.results[0].output).toBe("ok");
  });

  test("reports command failures without throwing", async () => {
    const summary = await runReleaseDoctor({
      checks: [
        createCommandCheck({
          name: "Command",
          command: process.execPath,
          args: ["-e", "console.error('bad'); process.exit(7)"],
        }),
      ],
    });

    expect(summary.ok).toBe(false);
    expect(summary.results[0].failures[0]).toBe(`${process.execPath} exited with status 7`);
    expect(summary.results[0].output).toBe("bad");
  });

  test("falls back to default success codes when config provides an invalid value", async () => {
    const summary = await runReleaseDoctor({
      checks: [
        createCommandCheck({
          name: "Command",
          command: process.execPath,
          args: ["-e", "process.exit(0)"],
          successCodes: 0,
        }),
      ],
    });

    expect(summary.ok).toBe(true);
  });

  test("fails closed when success codes array has no integer exit codes", async () => {
    const summary = await runReleaseDoctor({
      checks: [
        createCommandCheck({
          name: "Command",
          command: process.execPath,
          args: ["-e", "process.exit(0)"],
          successCodes: [null],
        }),
      ],
    });

    expect(summary.ok).toBe(false);
    expect(summary.results[0].failures[0]).toContain("successCodes");
  });

  test("reports missing commands without throwing", async () => {
    const summary = await runReleaseDoctor({
      checks: [
        createCommandCheck({
          name: "Command",
          command: "release-doctor-command-that-does-not-exist",
        }),
      ],
    });

    expect(summary.ok).toBe(false);
    expect(summary.results[0].failures[0]).toContain(
      "release-doctor-command-that-does-not-exist",
    );
  });

  test("checks pending Sampo changesets", async () => {
    await withTempDir(async (dir) => {
      mkdirSync(path.join(dir, ".sampo", "changesets"), { recursive: true });
      writeFileSync(path.join(dir, ".sampo", "changesets", "feature.md"), "---\n---\n\nok\n");

      const summary = await runReleaseDoctor({
        checks: [createPendingChangesetCheck({ root: dir })],
      });

      expect(summary.ok).toBe(true);
      expect(summary.results[0].details).toEqual([".sampo/changesets/feature.md"]);
    });
  });

  test("reports missing Sampo changeset directories", async () => {
    await withTempDir(async (dir) => {
      const summary = await runReleaseDoctor({
        checks: [createPendingChangesetCheck({ root: dir })],
      });

      expect(summary.ok).toBe(false);
      expect(summary.results[0].failures[0]).toContain("Changeset directory not found");
    });
  });

  test("loads JSON config checks", async () => {
    await withTempDir(async (dir) => {
      mkdirSync(path.join(dir, "ops"), { recursive: true });
      writeFileSync(
        path.join(dir, "ops", ".env.production"),
        ["APP_ENV=production", "APP_BASE_URL=https://service.test"].join("\n"),
      );
      writeFileSync(
        path.join(dir, "release-doctor.json"),
        JSON.stringify(
          {
            root: "ops",
            checks: [
              {
                type: "production-env",
                name: "Env",
                file: ".env.production",
                appEnvKey: "APP_ENV",
                optionalHttps: ["APP_BASE_URL"],
              },
              {
                type: "command",
                name: "Command",
                command: process.execPath,
                args: ["-e", "process.exit(0)"],
              },
            ],
          },
          null,
          2,
        ),
      );

      const config = loadReleaseDoctorConfig(path.join(dir, "release-doctor.json"));
      expect(createReleaseDoctorChecksFromConfig(config)).toHaveLength(2);

      const summary = await runConfiguredReleaseDoctor({
        configPath: path.join(dir, "release-doctor.json"),
      });
      expect(summary.ok).toBe(true);
      expect(summary.passed).toBe(2);
    });
  });

  test("release doctor template is copyable under apps/trailbase", () => {
    withTempDir((dir) => {
      const configDir = path.join(dir, "apps", "trailbase");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        path.join(configDir, ".env.production"),
        [
          "APP_ENV=production",
          "APP_BASE_URL=https://service.test",
          "TRAILBASE_PUBLIC_URL=https://trailbase.service.test",
        ].join("\n"),
      );
      writeFileSync(
        path.join(configDir, "release-doctor.json"),
        readFileSync(path.join(repoRoot, releaseDoctorConfigTemplate), "utf8"),
      );

      const config = loadReleaseDoctorConfig(path.join(configDir, "release-doctor.json"));
      const checks = createReleaseDoctorChecksFromConfig(config);

      expect(config.root).toBe("../..");
      expect(checks).toHaveLength(3);
      expect(checks[0].run().ok).toBe(true);
    });
  });

  test("config checks only pass supported declarative options", async () => {
    await withTempDir(async (dir) => {
      writeFileSync(
        path.join(dir, "release-doctor.json"),
        JSON.stringify({
          checks: [
            {
              type: "command",
              name: "Command",
              command: process.execPath,
              args: ["-e", "process.exit(0)"],
              spawnSyncImpl: null,
              successCodes: 0,
            },
          ],
        }),
      );

      const summary = await runConfiguredReleaseDoctor({
        configPath: path.join(dir, "release-doctor.json"),
      });

      expect(summary.ok).toBe(true);
      expect(summary.results[0].status).toBe("passed");
    });
  });

  test("adds config path context to invalid JSON errors", () => {
    withTempDir((dir) => {
      const config = path.join(dir, "release-doctor.json");
      writeFileSync(config, "{");

      expect(() => loadReleaseDoctorConfig(config)).toThrow(
        "Failed to load release doctor config",
      );
    });
  });

  test("formats human-readable output", async () => {
    const lines = formatDoctorResultLines({
      ok: false,
      passed: 0,
      failed: 1,
      warnings: 0,
      skipped: 0,
      results: [
        {
          status: "failed",
          name: "Env",
          warnings: [],
          failures: ["APP_ENV is required"],
          message: "",
          output: "extra context",
        },
      ],
    });

    expect(lines).toContain("FAILED Env");
    expect(lines).toContain("  FAIL APP_ENV is required");
    expect(lines).toContain("  OUTPUT");
    expect(lines).toContain("    extra context");
    expect(lines.at(-1)).toContain("FAIL release doctor");
  });

  test("formats sparse result objects defensively", () => {
    const lines = formatDoctorResultLines({
      ok: true,
      passed: 0,
      failed: 0,
      warnings: 0,
      skipped: 0,
      results: [{ name: "Sparse" }],
    });

    expect(lines).toContain("UNKNOWN Sparse");
  });

  test("CLI runs env-file checks", () => {
    withTempDir((dir) => {
      const envFile = path.join(dir, ".env.production");
      writeFileSync(envFile, "APP_ENV=production\n");

      const result = runCli(["--env-file", envFile, "--app-env-key", "APP_ENV"]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("PASS release doctor");
    });
  });

  test("CLI exits non-zero on check failure", () => {
    withTempDir((dir) => {
      const envFile = path.join(dir, ".env.production");
      writeFileSync(envFile, "APP_ENV=staging\n");

      const result = runCli(["--env-file", envFile, "--app-env-key", "APP_ENV"]);

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("FAIL release doctor");
    });
  });

  test("CLI rejects config and explicit env-file modes together", () => {
    withTempDir((dir) => {
      const envFile = path.join(dir, ".env.production");
      const config = path.join(dir, "release-doctor.json");
      writeFileSync(envFile, "APP_ENV=production\n");
      writeFileSync(config, JSON.stringify({ checks: [] }));

      const result = runCli(["--config", config, "--env-file", envFile]);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("mutually exclusive");
    });
  });

  test("CLI rejects config mode with env-file-only options", () => {
    withTempDir((dir) => {
      const config = path.join(dir, "release-doctor.json");
      writeFileSync(config, JSON.stringify({ checks: [] }));

      const result = runCli(["--config", config, "--allow-placeholders"]);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("only apply to --env-file mode");
    });
  });

  test("CLI rejects options that require missing values", () => {
    const configResult = runCli(["--config", "--json"]);
    const envFileResult = runCli(["--env-file", "--json"], {
      env: { ...process.env, PRODUCTION_ENV_FILE: "" },
    });
    const appEnvKeyResult = runCli(["--env-file", "env.example", "--app-env-key", "--json"]);
    const appEnvValueResult = runCli(["--env-file", "env.example", "--app-env-value", "--json"]);

    expect(configResult.status).toBe(2);
    expect(configResult.stderr).toContain("--config requires a value");
    expect(envFileResult.status).toBe(2);
    expect(envFileResult.stderr).toContain("--env-file requires a value");
    expect(appEnvKeyResult.status).toBe(2);
    expect(appEnvKeyResult.stderr).toContain("--app-env-key requires a value");
    expect(appEnvValueResult.status).toBe(2);
    expect(appEnvValueResult.stderr).toContain("--app-env-value requires a value");
  });

  test("CLI rejects unknown options", () => {
    const result = runCli(["--confg", "release-doctor.json"]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("unknown option: --confg");
  });

  test("CLI runs config checks and can print JSON", () => {
    withTempDir((dir) => {
      const config = path.join(dir, "release-doctor.json");
      writeFileSync(
        config,
        JSON.stringify({
          checks: [
            {
              type: "command",
              name: "Command",
              command: process.execPath,
              args: ["-e", "process.exit(0)"],
              timeout: 30_000,
            },
          ],
        }),
      );

      const result = runCli(["--config", config, "--json"]);

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).passed).toBe(1);
    });
  });
});

function runCli(args, options = {}) {
  const result = spawnSync(process.execPath, [cliScript, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 15000,
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  return result;
}

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "release-doctor-"));
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  try {
    const result = fn(dir);
    if (result && typeof result.then === "function") {
      return result.finally(cleanup);
    }
    cleanup();
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
}
