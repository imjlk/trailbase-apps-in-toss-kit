import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { validateProductionEnv } from "./production-env.mjs";

export async function runReleaseDoctor({
  checks = [],
  failFast = false,
  logger,
  now = () => Date.now(),
} = {}) {
  const results = [];
  for (const check of checks) {
    const startedAt = now();
    const result = await runDoctorCheck(check, {
      durationMs: () => Math.max(0, now() - startedAt),
    });
    results.push(result);
    logDoctorResult(result, logger);
    if (failFast && result.status === "failed") {
      break;
    }
  }

  return summarizeDoctorResults(results);
}

export function createProductionEnvCheck({
  name = "Production env",
  file,
  raw,
  required = true,
  allowPlaceholders = false,
  appEnvKey,
  appEnvValue = "production",
  requiredSecrets = [],
  optionalSecrets = [],
  requiredHttps = [],
  optionalHttps = [],
  positiveIntegers = [],
  mtlsCertificatePairDir,
} = {}) {
  return {
    name,
    required,
    run() {
      if (!raw && !file) {
        return failure("Production env check requires file or raw");
      }
      if (!raw && !existsSync(file)) {
        return failure(`Production env file not found: ${file}`);
      }
      return validateProductionEnv({
        raw: raw ?? readFileSync(file, "utf8"),
        label: file ?? name,
        allowPlaceholders,
        appEnvKey,
        appEnvValue,
        requiredSecrets,
        optionalSecrets,
        requiredHttps,
        optionalHttps,
        positiveIntegers,
        mtlsCertificatePairDir,
      });
    },
  };
}

export function createCommandCheck({
  name,
  command,
  args = [],
  cwd,
  env = {},
  required = true,
  captureOutput = "failure",
  maxBuffer = 8 * 1024 * 1024,
  successCodes = [0],
  spawnSyncImpl = spawnSync,
} = {}) {
  return {
    name: name || command,
    required,
    run() {
      if (!command) {
        return failure("Command check requires command");
      }
      const normalizedSuccessCodes = normalizeSuccessCodes(successCodes);
      if (normalizedSuccessCodes.length === 0) {
        return failure("Command check successCodes must contain integer exit codes");
      }
      const normalizedMaxBuffer = normalizePositiveInteger(maxBuffer, 8 * 1024 * 1024);
      const captureStdout = shouldCaptureCommandOutput(captureOutput, "success");
      const captureStderr =
        shouldCaptureCommandOutput(captureOutput, "failure") || captureStdout;
      const result = spawnSyncImpl(command, args.map(String), {
        cwd,
        env: { ...process.env, ...env },
        encoding: "utf8",
        maxBuffer: normalizedMaxBuffer,
        stdio: ["ignore", captureStdout ? "pipe" : "ignore", captureStderr ? "pipe" : "ignore"],
      });
      if (result.error) {
        return failure(result.error.message);
      }
      if (result.signal) {
        return failure(`${command} was terminated by ${result.signal}`);
      }
      const status = result.status ?? 1;
      if (!normalizedSuccessCodes.includes(status)) {
        return failure(`${command} exited with status ${status}`, {
          output: shouldCaptureCommandOutput(captureOutput, "failure")
            ? trimCommandOutput(result.stderr || result.stdout)
            : "",
        });
      }
      return {
        ok: true,
        message: `${command} completed`,
        output: shouldCaptureCommandOutput(captureOutput, "success")
          ? trimCommandOutput(result.stdout)
          : "",
      };
    },
  };
}

export function createPendingChangesetCheck({
  name = "Pending Sampo changeset",
  root = ".",
  changesetDir = ".sampo/changesets",
  required = true,
} = {}) {
  return {
    name,
    required,
    run() {
      const dir = resolve(root, changesetDir);
      if (!existsSync(dir)) {
        return failure(`Changeset directory not found: ${changesetDir}`);
      }
      const files = readdirSync(dir)
        .filter((file) => file.endsWith(".md") && file !== ".gitkeep")
        .sort();
      if (files.length === 0) {
        return failure(`No pending Sampo changesets in ${changesetDir}`);
      }
      return {
        ok: true,
        message: `${files.length} pending changeset(s) found`,
        details: files.map((file) => `${changesetDir}/${file}`),
      };
    },
  };
}

export function loadReleaseDoctorConfig(path) {
  const configPath = resolve(path);
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load release doctor config from ${configPath}: ${message}`);
  }
  return {
    ...config,
    configPath,
    configDir: dirname(configPath),
  };
}

export function createReleaseDoctorChecksFromConfig(config, { root } = {}) {
  if (!Array.isArray(config?.checks)) {
    throw new Error("Release doctor config must include a checks array");
  }
  const configRoot = resolve(config.configDir ?? ".", root ?? config.root ?? ".");
  return config.checks.map((entry, index) =>
    createReleaseDoctorCheckFromConfig(entry, {
      root: configRoot,
      index,
    }),
  );
}

export async function runConfiguredReleaseDoctor({
  config,
  configPath,
  root,
  logger,
  now,
} = {}) {
  const loaded = config ?? loadReleaseDoctorConfig(configPath);
  return await runReleaseDoctor({
    checks: createReleaseDoctorChecksFromConfig(loaded, { root }),
    failFast: Boolean(loaded.failFast),
    logger,
    now,
  });
}

export function formatDoctorResultLines(summary) {
  const lines = [];
  for (const result of summary.results ?? []) {
    const status = result.status ?? "unknown";
    lines.push(`${String(status).toUpperCase()} ${result.name ?? "Unnamed check"}`);
    for (const warning of result.warnings ?? []) {
      lines.push(`  WARN ${warning}`);
    }
    for (const failure of result.failures ?? []) {
      lines.push(`  FAIL ${failure}`);
    }
    if (result.message) {
      lines.push(`  ${result.message}`);
    }
    if (result.output) {
      lines.push("  OUTPUT");
      for (const line of String(result.output).split("\n")) {
        lines.push(`    ${line}`);
      }
    }
  }
  lines.push(
    `${summary.ok ? "PASS" : "FAIL"} release doctor: ${summary.passed} passed, ${summary.failed} failed, ${summary.warnings} warning(s), ${summary.skipped} skipped`,
  );
  return lines;
}

function createReleaseDoctorCheckFromConfig(entry, { root, index }) {
  const type = entry?.type;
  if (type === "production-env") {
    const {
      name,
      file,
      required,
      allowPlaceholders,
      appEnvKey,
      appEnvValue,
      requiredSecrets,
      optionalSecrets,
      requiredHttps,
      optionalHttps,
      positiveIntegers,
      mtlsCertificatePairDir,
    } = entry;
    return createProductionEnvCheck({
      name,
      file: file ? resolve(root, file) : undefined,
      required,
      allowPlaceholders,
      appEnvKey,
      appEnvValue,
      requiredSecrets,
      optionalSecrets,
      requiredHttps,
      optionalHttps,
      positiveIntegers,
      mtlsCertificatePairDir: mtlsCertificatePairDir
        ? resolve(root, mtlsCertificatePairDir)
        : undefined,
    });
  }
  if (type === "command") {
    const { name, command, args, cwd, env, required, captureOutput, maxBuffer, successCodes } =
      entry;
    return createCommandCheck({
      name,
      command,
      args,
      cwd: cwd ? resolve(root, cwd) : root,
      env,
      required,
      captureOutput,
      maxBuffer,
      successCodes: Array.isArray(successCodes) ? successCodes : undefined,
    });
  }
  if (type === "changeset") {
    const { name, changesetDir, required } = entry;
    return createPendingChangesetCheck({
      name,
      changesetDir,
      required,
      root,
    });
  }
  throw new Error(`Unsupported release doctor check type at index ${index + 1}: ${type}`);
}

async function runDoctorCheck(check, { durationMs }) {
  const name = check?.name || "Unnamed check";
  const required = check?.required !== false;
  try {
    const output = await check.run();
    return normalizeDoctorResult({
      name,
      required,
      durationMs: durationMs(),
      ...output,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return normalizeDoctorResult({
      name,
      required,
      durationMs: durationMs(),
      ok: false,
      failures: [message],
    });
  }
}

function normalizeDoctorResult({
  name,
  required = true,
  ok,
  skipped = false,
  message = "",
  warnings = [],
  failures = [],
  details = [],
  output = "",
  durationMs = 0,
} = {}) {
  const normalizedFailures = arrayOfStrings(failures);
  const normalizedWarnings = arrayOfStrings(warnings);
  const failed = ok === false || normalizedFailures.length > 0;
  const status = skipped
    ? "skipped"
    : failed && required
      ? "failed"
      : failed
        ? "warning"
        : "passed";
  return {
    name,
    required,
    ok: status !== "failed",
    status,
    skipped: Boolean(skipped),
    message,
    warnings: failed && !required
      ? [...normalizedWarnings, ...normalizedFailures]
      : normalizedWarnings,
    failures: failed && required ? normalizedFailures : [],
    details: arrayOfStrings(details),
    output: output ? String(output) : "",
    durationMs,
  };
}

function summarizeDoctorResults(results) {
  const summary = {
    ok:
      results.length > 0 &&
      results.some((result) => result.status !== "skipped") &&
      results.every((result) => result.ok),
    results,
    passed: results.filter((result) => result.status === "passed").length,
    failed: results.filter((result) => result.status === "failed").length,
    warnings: results.filter((result) => result.status === "warning").length,
    skipped: results.filter((result) => result.status === "skipped").length,
  };
  summary.failures = results.flatMap((result) =>
    result.failures.map((failure) => `${result.name}: ${failure}`),
  );
  summary.warningMessages = results.flatMap((result) =>
    result.warnings.map((warning) => `${result.name}: ${warning}`),
  );
  return summary;
}

function logDoctorResult(result, logger) {
  if (!logger) {
    return;
  }
  const message = `${result.status.toUpperCase()} ${result.name}`;
  if (result.status === "failed" && logger.error) {
    logger.error(message);
  } else if (result.status === "warning" && logger.warn) {
    logger.warn(message);
  } else if (logger.log) {
    logger.log(message);
  }
}

function failure(message, extras = {}) {
  return {
    ok: false,
    failures: [message],
    ...extras,
  };
}

function arrayOfStrings(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function trimCommandOutput(value, maxLength = 4000) {
  const output = String(value ?? "").trim();
  if (output.length <= maxLength) {
    return output;
  }
  const prefix = "... output truncated\n";
  return `${prefix}${output.slice(output.length - Math.max(0, maxLength - prefix.length))}`;
}

function shouldCaptureCommandOutput(captureOutput, phase) {
  return captureOutput === true || captureOutput === "always" || captureOutput === phase;
}

function normalizeSuccessCodes(successCodes) {
  if (successCodes === undefined || !Array.isArray(successCodes)) {
    return [0];
  }
  const normalized = successCodes.filter((code) => Number.isInteger(code));
  return normalized.length > 0 ? normalized : [];
}

function normalizePositiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
