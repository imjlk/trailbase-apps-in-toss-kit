#!/usr/bin/env node
import { constants as osConstants } from "node:os";
import { spawnSync } from "node:child_process";
import { createDevRunnerPlan } from "../src/dev-runner.mjs";

let options;
let plan;
try {
  ({ options, plan } = await createDevRunnerPlan());
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exit(1);
}

if (options.help) {
  printUsage();
  process.exit(0);
}

printPlan(plan);

if (options.printEnv || options.dryRun) {
  printEnv(plan.env);
}

if (options.dryRun) {
  console.log(`command: ${plan.command} ${plan.composeArgs.map(shellSafeValue).join(" ")}`);
  process.exit(0);
}

const result = spawnSync(plan.command, plan.composeArgs, {
  env: { ...process.env, ...plan.env },
  stdio: "inherit",
});

if (result.error) {
  console.error(`failed to run ${plan.command}: ${result.error.message}`);
  process.exit(1);
}

if (result.signal) {
  console.error(`${plan.command} process was killed by signal ${result.signal}`);
  process.exit(128 + signalNumber(result.signal));
}

process.exit(result.status ?? 1);

function printUsage() {
  console.log(`Usage:
  dev-with-trailbase [options] [service...]

Options:
  -f, --compose-file <file>       Add a Docker Compose file.
  --profile <name>                Enable a Compose profile.
  --project-name <name>           Set the Compose project name.
  --service <name>                Add a service to docker compose up.
  --trailbase-port <port>         Preferred local TrailBase host port. Defaults to 4000.
  --mtls-port <port>              Preferred local mTLS proxy host port. Defaults to 8787.
  --mtls-health-path <path>       mTLS proxy health path for printed URLs.
  --granite-port <port>           Optional local Granite or asset-preview host port.
  --host <host>                   Local host used for port probing. Defaults to 127.0.0.1.
  --ignore-container-prefix <pfx> Ignore matching Docker container names during port probing.
  --fresh                         Set TRAILBASE_FRESH_START_TOKEN for this run.
  --down                          Run docker compose down instead of up.
  --attached                      Run docker compose up without -d.
  --no-build                      Omit --build for docker compose up.
  --print-env                     Print generated environment variables.
  --dry-run                       Print the plan without running Docker; still probes ports.
  -h, --help                      Show this help message and exit.
`);
}

function printPlan({ urls }) {
  console.log(`TrailBase URL: ${urls.trailbase}`);
  console.log(`mTLS proxy URL: ${urls.mtlsProxy}`);
  if (urls.mtlsProxyHealth) {
    console.log(`mTLS proxy health URL: ${urls.mtlsProxyHealth}`);
  }
  if (urls.granite) {
    console.log(`Granite URL: ${urls.granite}`);
  }
}

function printEnv(values) {
  for (const [key, value] of Object.entries(values)) {
    console.log(`${key}=${shellSafeValue(value)}`);
  }
}

function shellSafeValue(value) {
  const stringValue = String(value);
  return /^[A-Za-z0-9_./:=@-]+$/.test(stringValue)
    ? stringValue
    : shellQuote(stringValue);
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function signalNumber(signal) {
  return osConstants.signals[signal] ?? 1;
}
