import { afterEach, describe, expect, test } from "bun:test";
import { createServer } from "node:net";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildComposeArgs,
  buildDevRunnerChildEnv,
  buildDevRunnerEnv,
  buildDevRunnerPlan,
  buildDevRunnerUrls,
  createDevRunnerPlan,
  detectLanIp,
  findAvailablePort,
  parseDockerPublishedHostPortSets,
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
        "--dry-run",
        "--print-env",
        "--no-build",
        "--profile=toss-proxy",
        "--project-name",
        "dev-stack",
        "--ignore-container-prefix=dev-stack-",
        "--mtls-health-path",
        "healthz",
        "--trailbase-port",
        "4001",
        "trailbase",
      ]),
    ).toMatchObject({
      fresh: true,
      dryRun: true,
      printEnv: true,
      build: false,
      profiles: ["toss-proxy"],
      projectName: "dev-stack",
      ignoreContainerNamePrefixes: ["dev-stack-"],
      mtlsProxyHealthPath: "healthz",
      trailbasePort: 4001,
      services: ["trailbase"],
    });
  });

  test("builds docker compose args", () => {
    expect(
      buildComposeArgs({
        composeFiles: ["docker-compose.yml"],
        profiles: ["toss-proxy"],
        projectName: "dev-stack",
        services: ["trailbase"],
      }),
    ).toEqual([
      "compose",
      "--project-name",
      "dev-stack",
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

  test("builds local dev URLs from selected ports", () => {
    expect(
      buildDevRunnerUrls({
        host: "0.0.0.0",
        trailbasePort: 4001,
        mtlsProxyPort: 8788,
        granitePort: 8081,
        mtlsProxyHealthPath: "healthz",
      }),
    ).toEqual({
      trailbase: "http://127.0.0.1:4001",
      mtlsProxy: "http://127.0.0.1:8788",
      mtlsProxyHealth: "http://127.0.0.1:8788/healthz",
      granite: "http://127.0.0.1:8081",
    });
  });

  test("builds local dev environment without overriding explicit URLs", () => {
    expect(
      buildDevRunnerEnv({
        host: "127.0.0.1",
        trailbasePort: 4001,
        mtlsProxyPort: 8788,
        granitePort: 8081,
        fresh: true,
        env: {
          TRAILBASE_PUBLIC_URL: "http://trailbase.test",
          TOSS_PROXY_SMOKE_URL: "http://proxy.test",
          GRANITE_DEV_SERVER_URL: "http://granite.test",
          TRAILBASE_FRESH_START_TOKEN: "manual-token",
        },
        now: () => 123,
      }),
    ).toEqual({
      TRAILBASE_HOST_PORT: "4001",
      MTLS_PROXY_HOST_PORT: "8788",
      TRAILBASE_PUBLIC_URL: "http://trailbase.test",
      TOSS_PROXY_SMOKE_URL: "http://proxy.test",
      GRANITE_HOST_PORT: "8081",
      GRANITE_DEV_SERVER_URL: "http://granite.test",
      TRAILBASE_FRESH_START_TOKEN: "manual-token",
    });
  });

  test("strips stale fresh-start token from child env unless requested", () => {
    expect(
      buildDevRunnerChildEnv({
        env: {
          PATH: "/bin",
          TRAILBASE_FRESH_START_TOKEN: "stale-token",
          TRAILBASE_FRESH_START_CONFIRM: "DELETE_TRAILBASE_DATA",
        },
        planEnv: {
          TRAILBASE_HOST_PORT: "4000",
        },
        fresh: false,
      }),
    ).toEqual({
      PATH: "/bin",
      TRAILBASE_HOST_PORT: "4000",
    });

    expect(
      buildDevRunnerChildEnv({
        env: {
          TRAILBASE_FRESH_START_TOKEN: "manual-token",
          TRAILBASE_FRESH_START_CONFIRM: "DELETE_TRAILBASE_DATA",
        },
        planEnv: {},
        fresh: true,
      }),
    ).toMatchObject({
      TRAILBASE_FRESH_START_TOKEN: "manual-token",
      TRAILBASE_FRESH_START_CONFIRM: "DELETE_TRAILBASE_DATA",
    });
  });

  test("builds a compose runner plan", () => {
    const plan = buildDevRunnerPlan({
      options: {
        composeFiles: ["apps/trailbase/docker-compose.yml"],
        profiles: ["toss-proxy"],
        projectName: "dev-stack",
        services: ["trailbase", "toss-mtls-client-proxy"],
        host: "127.0.0.1",
        fresh: true,
      },
      ports: {
        trailbasePort: 4002,
        mtlsProxyPort: 8789,
      },
      env: {},
      now: () => 456,
    });

    expect(plan.command).toBe("docker");
    expect(plan.composeArgs).toEqual([
      "compose",
      "--project-name",
      "dev-stack",
      "-f",
      "apps/trailbase/docker-compose.yml",
      "--profile",
      "toss-proxy",
      "up",
      "-d",
      "--build",
      "trailbase",
      "toss-mtls-client-proxy",
    ]);
    expect(plan.env).toMatchObject({
      TRAILBASE_HOST_PORT: "4002",
      MTLS_PROXY_HOST_PORT: "8789",
      TRAILBASE_PUBLIC_URL: "http://127.0.0.1:4002",
      TOSS_PROXY_SMOKE_URL: "http://127.0.0.1:8789",
      TRAILBASE_FRESH_START_TOKEN: "local-dev-456",
    });
    expect(plan.urls.mtlsProxyHealth).toBe(
      "http://127.0.0.1:8789/internal/apps-in-toss/health",
    );
  });

  test("creates a down plan without probing ports", async () => {
    const { options, plan } = await createDevRunnerPlan({
      argv: [
        "--down",
        "--compose-file",
        "apps/trailbase/docker-compose.yml",
        "--trailbase-port",
        "4003",
        "--mtls-port",
        "8790",
      ],
      env: { GRANITE_HOST_PORT: "8081" },
      logger: { warn: () => {}, debug: () => {} },
    });

    expect(options.down).toBe(true);
    expect(plan.composeArgs).toEqual([
      "compose",
      "-f",
      "apps/trailbase/docker-compose.yml",
      "down",
    ]);
    expect(plan.env.TRAILBASE_HOST_PORT).toBe("4003");
    expect(plan.env.MTLS_PROXY_HOST_PORT).toBe("8790");
    expect(plan.env.GRANITE_HOST_PORT).toBeUndefined();
    expect(plan.urls.granite).toBeUndefined();
  });

  test("treats empty port environment values as unset", async () => {
    const { plan } = await createDevRunnerPlan({
      argv: ["--down"],
      env: {
        TRAILBASE_HOST_PORT: "",
        MTLS_PROXY_HOST_PORT: "",
        GRANITE_HOST_PORT: "",
      },
      logger: { warn: () => {}, debug: () => {} },
    });

    expect(plan.env.TRAILBASE_HOST_PORT).toBe("4000");
    expect(plan.env.MTLS_PROXY_HOST_PORT).toBe("8787");
    expect(plan.env.GRANITE_HOST_PORT).toBeUndefined();
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

  test("reuses an ignored container port even when the socket is already bound", async () => {
    const server = createServer();
    servers.push(server);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const busyPort = server.address().port;

    const result = await findAvailablePort({
      preferredPort: busyPort,
      host: "127.0.0.1",
      label: "TrailBase port",
      maxAttempts: 3,
      allowUnavailablePorts: new Set([busyPort]),
    });

    expect(result.port).toBe(busyPort);
    expect(result.changed).toBe(false);
  });

  test("reuses explicitly allowed fallback ports even when the socket is already bound", async () => {
    const preferredServer = createServer();
    const fallbackServer = createServer();
    servers.push(preferredServer, fallbackServer);
    await new Promise((resolve) => preferredServer.listen(0, "127.0.0.1", resolve));
    const busyPort = preferredServer.address().port;
    await new Promise((resolve) =>
      fallbackServer.listen(busyPort + 1, "127.0.0.1", resolve),
    );

    const result = await findAvailablePort({
      preferredPort: busyPort,
      host: "127.0.0.1",
      label: "TrailBase port",
      logger: { warn: () => {} },
      maxAttempts: 4,
      busyPorts: new Set([busyPort]),
      allowUnavailablePorts: new Set([busyPort + 1]),
    });

    expect(result.port).toBe(busyPort + 1);
    expect(result.changed).toBe(true);
  });

  test("prefers explicitly allowed ports before probing free gaps", async () => {
    const result = await findAvailablePort({
      preferredPort: 49260,
      host: "127.0.0.1",
      label: "TrailBase port",
      logger: { warn: () => {} },
      maxAttempts: 4,
      busyPorts: new Set([49260]),
      allowUnavailablePorts: new Set([49262]),
    });

    expect(result.port).toBe(49262);
    expect(result.changed).toBe(true);
  });

  test("parses Docker published host ports and ignores current project containers", () => {
    const ports = parseDockerPublishedHostPorts(
      [
        "current-stack-trailbase-1\t0.0.0.0:4001->4000/tcp",
        "trailbase-trailbase-1\t0.0.0.0:4000->4000/tcp, [::]:4000->4000/tcp",
        "kit-proxy-1\t127.0.0.1:8787->8787/tcp",
        "internal-only\t4000/tcp",
      ].join("\n"),
      { ignoreContainerNamePrefixes: ["current-stack-"] },
    );

    expect([...ports].sort((a, b) => a - b)).toEqual([4000, 8787]);
  });

  test("separates ignored Docker published host ports for same-project reuse", () => {
    const { busyPorts, ignoredPorts, ignoredPortsByService } = parseDockerPublishedHostPortSets(
      [
        "current-stack-trailbase-1\t0.0.0.0:4000->4000/tcp",
        "current-stack-toss-mtls-client-proxy-1\t0.0.0.0:8787->8787/tcp",
        "current-stack-granite-1\t0.0.0.0:5173->5173/tcp",
        "current-stack-worker-1\t0.0.0.0:9999->9999/tcp",
        "other-stack-trailbase-1\t0.0.0.0:4001->4000/tcp",
      ].join("\n"),
      { ignoreContainerNamePrefixes: ["current-stack-"] },
    );

    expect([...busyPorts]).toEqual([4001]);
    expect([...ignoredPorts].sort((a, b) => a - b)).toEqual([
      4000,
      5173,
      8787,
      9999,
    ]);
    expect([...ignoredPortsByService.trailbase]).toEqual([4000]);
    expect([...ignoredPortsByService.mtlsProxy]).toEqual([8787]);
    expect([...ignoredPortsByService.assetPreview]).toEqual([5173]);
    expect([...ignoredPortsByService.unknown]).toEqual([9999]);
  });

  test("does not classify generic ignored services by container port alone", () => {
    const { ignoredPortsByService } = parseDockerPublishedHostPortSets(
      [
        "current-stack-api-1\t0.0.0.0:4000->4000/tcp",
        "current-stack-worker-1\t0.0.0.0:8787->8787/tcp",
        "current-stack-http-proxy-1\t0.0.0.0:8790->8787/tcp",
      ].join("\n"),
      { ignoreContainerNamePrefixes: ["current-stack-"] },
    );

    expect([...ignoredPortsByService.trailbase]).toEqual([]);
    expect([...ignoredPortsByService.mtlsProxy]).toEqual([]);
    expect([...ignoredPortsByService.unknown].sort((a, b) => a - b)).toEqual([
      4000,
      8787,
      8790,
    ]);
  });

  test("does not reuse matching service names when the target port is different", () => {
    const { ignoredPortsByService } = parseDockerPublishedHostPortSets(
      [
        "current-stack-trailbase-1\t0.0.0.0:4050->9000/tcp",
        "current-stack-toss-mtls-client-proxy-1\t0.0.0.0:8788->9001/tcp",
      ].join("\n"),
      { ignoreContainerNamePrefixes: ["current-stack-"] },
    );

    expect([...ignoredPortsByService.trailbase]).toEqual([]);
    expect([...ignoredPortsByService.mtlsProxy]).toEqual([]);
    expect([...ignoredPortsByService.unknown].sort((a, b) => a - b)).toEqual([
      4050,
      8788,
    ]);
  });

  test("resolves local dev ports from ignored same-project containers", async () => {
    const result = await resolveLocalDevPorts({
      trailbasePort: 4000,
      mtlsProxyPort: 8787,
      ignoreContainerNamePrefixes: ["current-stack-"],
      spawnSyncImpl: () => ({
        status: 0,
        stdout: [
          "current-stack-trailbase-1\t0.0.0.0:4000->4000/tcp",
          "current-stack-toss-mtls-client-proxy-1\t0.0.0.0:8787->8787/tcp",
        ].join("\n"),
      }),
    });

    expect(result.trailbasePort).toBe(4000);
    expect(result.mtlsProxyPort).toBe(8787);
    expect(result.changed).toBe(false);
  });

  test("reuses ignored fallback ports for the same service", async () => {
    const fallbackServer = createServer();
    servers.push(fallbackServer);
    await new Promise((resolve) => fallbackServer.listen(0, "127.0.0.1", resolve));
    const fallbackPort = fallbackServer.address().port;
    const preferredPort = fallbackPort - 1;
    const mtlsProxyPort = fallbackPort > 1024 ? fallbackPort - 10 : fallbackPort + 10;

    const result = await resolveLocalDevPorts({
      trailbasePort: preferredPort,
      mtlsProxyPort,
      ignoreContainerNamePrefixes: ["current-stack-"],
      spawnSyncImpl: () => ({
        status: 0,
        stdout: [
          `other-stack-trailbase-1\t0.0.0.0:${preferredPort}->4000/tcp`,
          `current-stack-trailbase-1\t0.0.0.0:${fallbackPort}->4000/tcp`,
        ].join("\n"),
      }),
      logger: { warn: () => {} },
    });

    expect(result.trailbasePort).toBe(fallbackPort);
    expect(result.changed).toBe(true);
  });

  test("probes ignored fallback ports from other services", async () => {
    const fallbackServer = createServer();
    servers.push(fallbackServer);
    await new Promise((resolve) => fallbackServer.listen(0, "127.0.0.1", resolve));
    const fallbackPort = fallbackServer.address().port;
    const preferredPort = fallbackPort - 1;
    const mtlsProxyPort = fallbackPort > 1024 ? fallbackPort - 10 : fallbackPort + 10;

    const result = await resolveLocalDevPorts({
      trailbasePort: preferredPort,
      mtlsProxyPort,
      ignoreContainerNamePrefixes: ["current-stack-"],
      spawnSyncImpl: () => ({
        status: 0,
        stdout: [
          `other-stack-trailbase-1\t0.0.0.0:${preferredPort}->4000/tcp`,
          `current-stack-proxy-1\t0.0.0.0:${fallbackPort}->8787/tcp`,
        ].join("\n"),
      }),
      logger: { warn: () => {} },
    });

    expect(result.trailbasePort).toBeGreaterThan(fallbackPort);
    expect(result.changed).toBe(true);
  });

  test("treats unclassified ignored ports as busy during local port resolution", async () => {
    const preferredPort = 49250;
    const unknownIgnoredPort = preferredPort + 1;

    const result = await resolveLocalDevPorts({
      trailbasePort: preferredPort,
      mtlsProxyPort: preferredPort + 10,
      ignoreContainerNamePrefixes: ["current-stack-"],
      spawnSyncImpl: () => ({
        status: 0,
        stdout: [
          `other-stack-trailbase-1\t0.0.0.0:${preferredPort}->4000/tcp`,
          `current-stack-worker-1\t0.0.0.0:${unknownIgnoredPort}->9999/tcp`,
        ].join("\n"),
      }),
      logger: { warn: () => {} },
    });

    expect(result.trailbasePort).toBeGreaterThan(unknownIgnoredPort);
    expect(result.changed).toBe(true);
  });

  test(
    "resolves TrailBase, proxy, and asset preview ports without overlap",
    async () => {
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
      expect(result.granitePort).toBe(49102);
      expect(result.changed).toBe(true);
    },
    15_000,
  );

  test("shell entrypoint helper has valid syntax", () => {
    const result = spawnSync("sh", ["-n", "packages/trailbase-runtime/entrypoint/lib.sh"], {
      cwd: new URL("../../..", import.meta.url).pathname,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
  });

  test("dev-with-trailbase bin supports dry-run output", () => {
    const result = spawnSync(
      process.execPath,
      [
        "packages/trailbase-runtime/bin/dev-with-trailbase.mjs",
        "--dry-run",
        "--no-build",
        "--compose-file",
        "apps/trailbase/docker-compose.yml",
        "--trailbase-port",
        "49200",
        "--mtls-port",
        "49201",
        "trailbase",
      ],
      {
        cwd: new URL("../../..", import.meta.url).pathname,
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("TrailBase URL:");
    expect(result.stdout).toContain("mTLS proxy health URL:");
    expect(result.stdout).toContain("TRAILBASE_HOST_PORT=");
    expect(result.stdout).toContain(
      "command: docker compose -f apps/trailbase/docker-compose.yml up -d trailbase",
    );
  });

  test("dev-with-trailbase bin reports invalid arguments without a stack trace", () => {
    const result = spawnSync(
      process.execPath,
      [
        "packages/trailbase-runtime/bin/dev-with-trailbase.mjs",
        "--dry-run",
        "--trailbase-port",
        "not-a-port",
      ],
      {
        cwd: new URL("../../..", import.meta.url).pathname,
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("error: trailbase port must be a port number");
    expect(result.stderr).not.toContain("at ");
  });

  test("dev-with-trailbase bin documents help flags", () => {
    const result = spawnSync(
      process.execPath,
      ["packages/trailbase-runtime/bin/dev-with-trailbase.mjs", "--help"],
      {
        cwd: new URL("../../..", import.meta.url).pathname,
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("-h, --help");
    expect(result.stdout).toContain("--mtls-health-path");
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
