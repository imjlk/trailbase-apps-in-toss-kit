#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { validateProductionEnv } from "../src/production-env.mjs";

const args = process.argv.slice(2);
const allowPlaceholders = args.includes("--allow-placeholders");
const appEnvKey = readOption("--app-env-key");
const appEnvValue = readOption("--app-env-value") ?? "production";
const file = args.find((arg) => !arg.startsWith("--")) ?? process.env.PRODUCTION_ENV_FILE;

if (!file) {
  console.error(
    "Usage: bun packages/trailbase-runtime/bin/validate-production-env.mjs <env-file> [--allow-placeholders] [--app-env-key KEY]",
  );
  process.exit(1);
}

if (!existsSync(file)) {
  console.error(`FAIL production env file not found: ${file}`);
  process.exit(1);
}

const isExample = basename(file).includes("example");
const result = validateProductionEnv({
  raw: readFileSync(file, "utf8"),
  label: file,
  allowPlaceholders: allowPlaceholders || isExample,
  appEnvKey,
  appEnvValue,
  optionalHttps: ["APP_BASE_URL"],
  requiredSecrets: [],
});

for (const warning of result.warnings) {
  console.warn(`WARN ${warning}`);
}
if (!result.ok) {
  for (const failure of result.failures) {
    console.error(`FAIL ${failure}`);
  }
  process.exit(1);
}

console.log(result.successMessage);

function readOption(name) {
  const index = args.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  return args[index + 1];
}
