import { afterEach, describe, expect, test } from "bun:test";
import { createServer } from "node:net";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildComposeArgs,
  detectLanIp,
  findAvailablePort,
  parseDockerPublishedHostPorts,
  parseDevRunnerArgs,
  resolveLocalDevPorts,
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

  test("increments when Docker already publishes the preferred port", async () => {
    const warnings = [];

    const result = await findAvailablePort({
      preferredPort: 49000,
      host: "127.0.0.1",
      label: "TrailBase port",
      logger: { warn: (message) => warnings.push(message) },
      maxAttempts: 3,
      busyPorts: new Set([49000]),
    });

    expect(result.port).toBe(49001);
    expect(result.changed).toBe(true);
    expect(warnings[0]).toContain("TrailBase port 49000 is already in use");
  });

  test("parses Docker published host ports and ignores current project containers", () => {
    const ports = parseDockerPublishedHostPorts(
      [
        "zero-three-three-trailbase-1\t0.0.0.0:4001->4000/tcp",
        "trailbase-trailbase-1\t0.0.0.0:4000->4000/tcp, [::]:4000->4000/tcp",
        "kit-proxy-1\t127.0.0.1:8787->8787/tcp",
        "internal-only\t4000/tcp",
      ].join("\n"),
      { ignoreContainerNamePrefixes: ["zero-three-three-"] },
    );

    expect([...ports].sort((a, b) => a - b)).toEqual([4000, 8787]);
  });

  test("resolves TrailBase, proxy, and asset preview ports without overlap", async () => {
    const result = await resolveLocalDevPorts({
      trailbasePort: 49100,
      mtlsProxyPort: 49101,
      assetPreviewPort: 49101,
      host: "127.0.0.1",
      logger: { warn: () => {} },
    });

    expect(result.trailbasePort).toBe(49100);
    expect(result.mtlsProxyPort).toBe(49101);
    expect(result.assetPreviewPort).toBe(49102);
    expect(result.changed).toBe(true);
  });

  test("shell entrypoint helper has valid syntax", () => {
    const result = spawnSync("sh", ["-n", "packages/trailbase-runtime/entrypoint/lib.sh"], {
      cwd: new URL("../../..", import.meta.url).pathname,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
  });

  test("shell URL normalization preserves explicit ports", () => {
    const result = spawnSync(
      "sh",
      [
        "-c",
        '. packages/trailbase-runtime/entrypoint/lib.sh && trailbase_runtime_normalize_public_url "http://127.0.0.1:4011/path?x=1" development && printf "\\n" && trailbase_runtime_normalize_public_url "http://example.com:4000/path" production',
      ],
      {
        cwd: new URL("../../..", import.meta.url).pathname,
        encoding: "utf8",
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split("\n")).toEqual([
      "http://127.0.0.1:4011",
      "https://example.com:4000",
    ]);
  });

  test("shell migration copy includes each database subdirectory", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trailbase-runtime-"));
    try {
      const template = path.join(root, "template");
      const depot = path.join(root, "traildepot");
      mkdirSync(path.join(template, "migrations", "main"), { recursive: true });
      mkdirSync(path.join(template, "migrations", "analytics"), { recursive: true });
      writeFileSync(path.join(template, "migrations", "main", "U1__main.sql"), "SELECT 1;");
      writeFileSync(
        path.join(template, "migrations", "analytics", "U2__analytics.sql"),
        "SELECT 2;",
      );
      writeFileSync(path.join(template, "migrations", "U0__legacy.sql"), "SELECT 0;");

      const result = spawnSync(
        "sh",
        [
          "-c",
          `. packages/trailbase-runtime/entrypoint/lib.sh && trailbase_runtime_copy_template_migrations ${shellQuote(template)} ${shellQuote(depot)}`,
        ],
        {
          cwd: new URL("../../..", import.meta.url).pathname,
          encoding: "utf8",
        },
      );

      expect(result.status).toBe(0);
      expect(readFileSync(path.join(depot, "migrations", "main", "U1__main.sql"), "utf8")).toBe(
        "SELECT 1;",
      );
      expect(
        readFileSync(path.join(depot, "migrations", "analytics", "U2__analytics.sql"), "utf8"),
      ).toBe("SELECT 2;");
      expect(existsSync(path.join(depot, "migrations", "U0__legacy.sql"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("shell migration copy no-ops when source migration directory is missing", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trailbase-runtime-"));
    try {
      const result = spawnSync(
        "sh",
        [
          "-c",
          `. packages/trailbase-runtime/entrypoint/lib.sh && trailbase_runtime_copy_template_migrations ${shellQuote(path.join(root, "missing-template"))} ${shellQuote(path.join(root, "traildepot"))}`,
        ],
        {
          cwd: new URL("../../..", import.meta.url).pathname,
          encoding: "utf8",
        },
      );

      expect(result.status).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("shell Toss unlink callback guard validates production settings", () => {
    const root = new URL("../../..", import.meta.url).pathname;
    const ok = spawnSync(
      "sh",
      [
        "-c",
        '. packages/trailbase-runtime/entrypoint/lib.sh && TOSS_LOGIN_UNLINK_BASIC_AUTH="console-user:console-password" TOSS_USER_KEY_HMAC_SECRET="12345678901234567890123456789012" TOSS_UNLINK_CALLBACK_METHODS="GET,POST" trailbase_runtime_require_toss_unlink_callback_settings production',
      ],
      { cwd: root, encoding: "utf8" },
    );
    expect(ok.status).toBe(0);

    const bad = spawnSync(
      "sh",
      [
        "-c",
        '. packages/trailbase-runtime/entrypoint/lib.sh && TOSS_LOGIN_UNLINK_BASIC_AUTH="console-user:console-password" TOSS_USER_KEY_HMAC_SECRET="12345678901234567890123456789012" TOSS_UNLINK_CALLBACK_METHODS="PUT" trailbase_runtime_require_toss_unlink_callback_settings production',
      ],
      { cwd: root, encoding: "utf8" },
    );
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("TOSS_UNLINK_CALLBACK_METHODS supports only GET and POST");

    const missingHmac = spawnSync(
      "sh",
      [
        "-c",
        '. packages/trailbase-runtime/entrypoint/lib.sh && TOSS_LOGIN_UNLINK_BASIC_AUTH="console-user:console-password" trailbase_runtime_require_toss_unlink_callback_settings production',
      ],
      { cwd: root, encoding: "utf8" },
    );
    expect(missingHmac.status).toBe(1);
    expect(missingHmac.stderr).toContain("refusing placeholder production environment variable: TOSS_USER_KEY_HMAC_SECRET");

    const localCredential = spawnSync(
      "sh",
      [
        "-c",
        '. packages/trailbase-runtime/entrypoint/lib.sh && TOSS_LOGIN_UNLINK_BASIC_AUTH="dev-user:dev-password" TOSS_USER_KEY_HMAC_SECRET="12345678901234567890123456789012" trailbase_runtime_require_toss_unlink_callback_settings production',
      ],
      { cwd: root, encoding: "utf8" },
    );
    expect(localCredential.status).toBe(1);
    expect(localCredential.stderr).toContain("TOSS_LOGIN_UNLINK_BASIC_AUTH must not use local dev/test credentials in production");
  });
});

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
