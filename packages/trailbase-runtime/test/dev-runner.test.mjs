import { afterEach, describe, expect, test } from "bun:test";
import { createServer } from "node:net";
import { spawnSync } from "node:child_process";
import {
  buildComposeArgs,
  detectLanIp,
  findAvailablePort,
  parseDevRunnerArgs,
} from "../src/dev-runner.mjs";

const servers = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.close();
  }
});

describe("dev runner helpers", () => {
  test("parses common flags", () => {
    expect(
      parseDevRunnerArgs([
        "--fresh",
        "--no-build",
        "--profile=toss-proxy",
        "--trailbase-port",
        "4001",
        "trailbase",
      ]),
    ).toMatchObject({
      fresh: true,
      build: false,
      profiles: ["toss-proxy"],
      trailbasePort: 4001,
      services: ["trailbase"],
    });
  });

  test("builds docker compose args", () => {
    expect(
      buildComposeArgs({
        composeFiles: ["docker-compose.yml"],
        profiles: ["toss-proxy"],
        services: ["trailbase"],
      }),
    ).toEqual([
      "compose",
      "-f",
      "docker-compose.yml",
      "--profile",
      "toss-proxy",
      "up",
      "-d",
      "--build",
      "trailbase",
    ]);
  });

  test("detects preferred private LAN IP", () => {
    expect(
      detectLanIp({
        interfaces: {
          en0: [{ family: "IPv4", internal: false, address: "192.168.0.5" }],
        },
      }),
    ).toBe("192.168.0.5");
  });

  test("increments when the preferred port is busy", async () => {
    const server = createServer();
    servers.push(server);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const busyPort = server.address().port;
    const warnings = [];

    const result = await findAvailablePort({
      preferredPort: busyPort,
      host: "127.0.0.1",
      label: "TrailBase port",
      logger: { warn: (message) => warnings.push(message) },
      maxAttempts: 3,
    });

    expect(result.port).toBeGreaterThan(busyPort);
    expect(result.changed).toBe(true);
    expect(warnings[0]).toContain(`TrailBase port ${busyPort} is already in use`);
  });

  test("shell entrypoint helper has valid syntax", () => {
    const result = spawnSync("sh", ["-n", "packages/trailbase-runtime/entrypoint/lib.sh"], {
      cwd: new URL("../../..", import.meta.url).pathname,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
  });
});
