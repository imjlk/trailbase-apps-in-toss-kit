#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import path from "node:path";

const script = path.join(import.meta.dirname, "validate-agent-skills.mjs");
const result = spawnSync(process.execPath, [script, ...process.argv.slice(2)], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
