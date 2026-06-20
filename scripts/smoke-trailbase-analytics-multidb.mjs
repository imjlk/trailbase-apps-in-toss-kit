#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const image = process.env.TRAILBASE_IMAGE || "trailbase/trailbase:0.28.6";
const keepDir = process.env.KEEP_TRAILBASE_SMOKE_DIR === "1";
const port = Number(process.env.TRAILBASE_SMOKE_PORT || "4028");
const tempDir = mkdtempSync(path.join(tmpdir(), "trailbase-analytics-multidb-"));
const traildepot = path.join(tempDir, "traildepot");
const containerName = `trailbase-analytics-smoke-${process.pid}`;
let containerStarted = false;

try {
  assertDockerAvailable();
  prepareDepot();
  await startTrailBase();
  await waitForHealth();
  stopTrailBase();
  verifyAnalyticsDatabase();
  console.log(
    JSON.stringify(
      {
        ok: true,
        image,
        healthcheck: `http://127.0.0.1:${port}/api/healthcheck`,
        analyticsDb: path.join(traildepot, "data", "analytics.db"),
        insertedAnalyticsEvents: 1,
      },
      null,
      2,
    ),
  );
} finally {
  if (containerStarted) {
    stopTrailBase();
  }
  if (keepDir) {
    console.error(`Kept smoke directory: ${tempDir}`);
  } else {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function prepareDepot() {
  const migrations = path.join(traildepot, "migrations", "analytics");
  mkdirSync(migrations, { recursive: true });
  writeFileSync(
    path.join(traildepot, "config.textproto"),
    [
      "email {}",
      "server {",
      '  application_name: "TrailBase Analytics Smoke"',
      `  site_url: "http://127.0.0.1:${port}"`,
      "}",
      "auth {}",
      "jobs {}",
      "",
      "databases: [{",
      '  name: "analytics"',
      "}]",
      "record_apis: [{",
      '  name: "analytics_events_smoke"',
      '  table_name: "analytics.analytics_events"',
      '  attached_databases: ["analytics"]',
      "}]",
      "",
    ].join("\n"),
  );
  cpSync(
    path.join(root, "templates", "trailbase", "sql", "analytics_events.sql"),
    path.join(migrations, "U2000000000__create_analytics_events.sql"),
  );
}

async function startTrailBase() {
  const args = [
    "run",
    "--rm",
    "-d",
    "--name",
    containerName,
    "-p",
    `127.0.0.1:${port}:4000`,
    "-v",
    `${traildepot}:/app/traildepot`,
    image,
    "/app/trail",
    "--data-dir",
    "/app/traildepot",
    "run",
    "--address",
    "0.0.0.0:4000",
  ];
  const result = spawnSync("docker", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `Failed to start TrailBase container:\n${result.stdout}\n${result.stderr}`.trim(),
    );
  }
  containerStarted = true;
}

async function waitForHealth() {
  const deadline = Date.now() + 45_000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/healthcheck`);
      if (response.ok) {
        return;
      }
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const logs = spawnSync("docker", ["logs", containerName], { encoding: "utf8" });
  throw new Error(
    [
      `TrailBase healthcheck did not pass: ${lastError}`,
      logs.stdout,
      logs.stderr,
    ].join("\n"),
  );
}

function stopTrailBase() {
  spawnSync("docker", ["rm", "-f", containerName], { encoding: "utf8" });
  containerStarted = false;
}

function verifyAnalyticsDatabase() {
  const analyticsDbPath = path.join(traildepot, "data", "analytics.db");
  if (!existsSync(analyticsDbPath)) {
    throw new Error(`analytics.db was not created at ${analyticsDbPath}`);
  }

  const db = new Database(analyticsDbPath);
  try {
    const history = db
      .query("SELECT name FROM _schema_history WHERE name = ?1")
      .get("create_analytics_events");
    if (!history) {
      throw new Error("analytics _schema_history does not include create_analytics_events");
    }

    const table = db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1")
      .get("analytics_events");
    if (!table) {
      throw new Error("analytics_events table was not created");
    }

    db.query(
      `INSERT INTO analytics_events
        (event_name, screen, source, payload_json, client_created_at, server_received_at, request_id, batch_id)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    ).run(
      "screen_view",
      "main",
      "smoke",
      JSON.stringify({ smoke: true }),
      Date.now(),
      Date.now(),
      "smoke-request",
      "smoke-batch",
    );
    const row = db.query("SELECT COUNT(*) AS count FROM analytics_events").get();
    if (row.count !== 1) {
      throw new Error(`expected 1 analytics event, found ${row.count}`);
    }
  } finally {
    db.close();
  }
}

function assertDockerAvailable() {
  const result = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`Docker is required for this smoke test:\n${result.stderr}`.trim());
  }
}
