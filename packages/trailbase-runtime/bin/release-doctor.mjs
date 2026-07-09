#!/usr/bin/env node
import {
  createProductionEnvCheck,
  formatDoctorResultLines,
  runConfiguredReleaseDoctor,
  runReleaseDoctor,
} from "../src/release-doctor.mjs";

const args = process.argv.slice(2);
const VALUE_OPTIONS = [
  "--app-env-key",
  "--app-env-value",
  "--config",
  "--env-file",
];
const FLAG_OPTIONS = [
  "--allow-placeholders",
  "--help",
  "--json",
  "-h",
];
const KNOWN_OPTIONS = [...VALUE_OPTIONS, ...FLAG_OPTIONS];

if (hasFlag("--help") || hasFlag("-h")) {
  printUsage();
  process.exit(0);
}

const unknownOption = args.find((arg) => isUnknownOption(arg));
if (unknownOption) {
  console.error(`error: unknown option: ${unknownOption}`);
  process.exit(2);
}

const explicitEnvFile = readOption("--env-file");
const json = hasFlag("--json");
const configPath = readOption("--config");
if (hasOption("--config") && !configPath) {
  console.error("error: --config requires a value");
  process.exit(2);
}
if (hasOption("--env-file") && !explicitEnvFile) {
  console.error("error: --env-file requires a value");
  process.exit(2);
}
const envFile = explicitEnvFile ?? process.env.PRODUCTION_ENV_FILE;
const appEnvKey = readOption("--app-env-key");
const explicitAppEnvValue = readOption("--app-env-value");
const appEnvValue = explicitAppEnvValue ?? "production";
const allowPlaceholders = hasFlag("--allow-placeholders");
if (hasOption("--app-env-key") && !appEnvKey) {
  console.error("error: --app-env-key requires a value");
  process.exit(2);
}
if (hasOption("--app-env-value") && !explicitAppEnvValue) {
  console.error("error: --app-env-value requires a value");
  process.exit(2);
}

let summary;
try {
  if (configPath && explicitEnvFile) {
    console.error("error: --config and --env-file are mutually exclusive");
    process.exit(2);
  }
  if (configPath) {
    if (allowPlaceholders || hasOption("--app-env-key") || hasOption("--app-env-value")) {
      console.error(
        "error: --allow-placeholders, --app-env-key, and --app-env-value only apply to --env-file mode",
      );
      process.exit(2);
    }
    summary = await runConfiguredReleaseDoctor({ configPath });
  } else if (envFile) {
    summary = await runReleaseDoctor({
      checks: [
        createProductionEnvCheck({
          file: envFile,
          appEnvKey,
          appEnvValue,
          allowPlaceholders,
          optionalHttps: ["APP_BASE_URL"],
        }),
      ],
    });
  } else {
    printUsage();
    process.exit(2);
  }
} catch (error) {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

if (json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(formatDoctorResultLines(summary).join("\n"));
}

process.exit(summary.ok ? 0 : 1);

function printUsage() {
  console.log(`Usage:
  trailbase-release-doctor --config release-doctor.json [--json]
  trailbase-release-doctor --env-file .env.production [--app-env-key APP_ENV]

Options:
  --config <file>            Run checks from a JSON config file. Mutually exclusive with --env-file.
  --env-file <file>          Run the built-in production env check.
                             Falls back to $PRODUCTION_ENV_FILE if omitted.
  --app-env-key <key>        Env key that must equal production. Only applies to --env-file.
  --app-env-value <value>    Expected app env value. Defaults to production. Only applies to --env-file.
  --allow-placeholders       Allow placeholder/example values. Only applies to --env-file.
  --json                     Print the normalized result as JSON.
  -h, --help                 Show this help message and exit.
`);
}

function hasFlag(flag) {
  return args.includes(flag);
}

function hasOption(name) {
  return args.includes(name) || args.some((arg) => arg.startsWith(`${name}=`));
}

function readOption(name) {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) {
    return inline.slice(name.length + 1);
  }
  const index = args.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  const value = args[index + 1];
  return value && !value.startsWith("-") ? value : undefined;
}

function isRegisteredOption(value) {
  return KNOWN_OPTIONS.includes(value);
}

function isUnknownOption(value) {
  return (
    value.startsWith("-") &&
    !isRegisteredOption(value) &&
    !VALUE_OPTIONS.some((option) => value.startsWith(`${option}=`))
  );
}
