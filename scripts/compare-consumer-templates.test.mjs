import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, "..");
const compareScript = path.join(scriptsDir, "compare-consumer-templates.mjs");

describe("compare-consumer-templates", () => {
  test("compose-service mode scopes drift to the mapped service and volumes", () => {
    withConsumer((consumerRoot) => {
      writeConsumerFile(
        consumerRoot,
        "apps/trailbase/docker-compose.yml",
        [
          "services:",
          "  trailbase:",
          "    image: app/trailbase:local",
          "    environment:",
          "      PM_APP_ENV: production",
          "",
          "  toss-mtls-client-proxy:",
          "    image: ghcr.io/imjlk/trailbase-apps-in-toss-kit/toss-mtls-client-proxy:0.1.5",
          "    profiles:",
          "      - toss-proxy",
          "    expose:",
          "      - \"8787\"",
          "    environment:",
          "      MTLS_PROXY_MODE: forward",
          "      MTLS_PROXY_TOKEN: ${MTLS_PROXY_TOKEN:-}",
          "      MTLS_UPSTREAM_BASE_URL: https://apps-in-toss-api.toss.im",
          "      MTLS_CERT_DIR: /run/mtls",
          "    volumes:",
          "      - mtls_client_certs:/run/mtls:ro",
          "    restart: unless-stopped",
          "",
          "volumes:",
          "  trailbase_data:",
          "  mtls_client_certs:",
          "",
        ].join("\n"),
      );
      writeMapping(consumerRoot, [
        {
          name: "Compose toss mTLS proxy",
          template: "templates/trailbase/compose/toss-mtls-client-proxy.yml",
          consumer: "apps/trailbase/docker-compose.yml",
          mode: "compose-service",
          service: "toss-mtls-client-proxy",
          volumes: ["mtls_client_certs"],
        },
      ]);

      const result = runCompare(consumerRoot);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("0.1.5");
      expect(result.stdout).toContain(
        "-    image: ghcr.io/imjlk/trailbase-apps-in-toss-kit/toss-mtls-client-proxy:0.1.7",
      );
      expect(result.stdout).toContain(
        "+    image: ghcr.io/imjlk/trailbase-apps-in-toss-kit/toss-mtls-client-proxy:0.1.5",
      );
      expect(result.stdout).toContain(
        "--- templates/trailbase/compose/toss-mtls-client-proxy.yml#toss-mtls-client-proxy",
      );
      expect(result.stdout).toContain("+++ apps/trailbase/docker-compose.yml");
      expect(result.stdout).not.toContain("compare-consumer-templates-");
      expect(result.stdout).not.toContain("-    profiles:");
      expect(result.stdout).not.toContain("  trailbase:");
      expect(result.stdout).not.toContain("trailbase_data");
    });
  });

  test("compose-service mode ignores separator blank lines after scoped entries", () => {
    withConsumer((consumerRoot) => {
      const template = readFileSync(
        path.join(repoRoot, "templates/trailbase/compose/toss-mtls-client-proxy.yml"),
        "utf8",
      );
      writeConsumerFile(
        consumerRoot,
        "apps/trailbase/docker-compose.yml",
        template.replace("\n\nvolumes:\n", "\n\n\nvolumes:\n"),
      );
      writeMapping(consumerRoot, [
        {
          name: "Compose toss mTLS proxy",
          template: "templates/trailbase/compose/toss-mtls-client-proxy.yml",
          consumer: "apps/trailbase/docker-compose.yml",
          mode: "compose-service",
          service: "toss-mtls-client-proxy",
          volumes: ["mtls_client_certs"],
        },
      ]);

      const result = runCompare(consumerRoot);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("status: scoped match");
    });
  });

  test("compose-service mode ignores top-level comments between service entries", () => {
    withConsumer((consumerRoot) => {
      const template = readFileSync(
        path.join(repoRoot, "templates/trailbase/compose/toss-mtls-client-proxy.yml"),
        "utf8",
      );
      writeConsumerFile(
        consumerRoot,
        "apps/trailbase/docker-compose.yml",
        template.replace(
          "  toss-mtls-client-proxy:\n",
          "# app service comments are valid YAML here\n  toss-mtls-client-proxy:\n",
        ),
      );
      writeMapping(consumerRoot, [
        {
          name: "Compose toss mTLS proxy",
          template: "templates/trailbase/compose/toss-mtls-client-proxy.yml",
          consumer: "apps/trailbase/docker-compose.yml",
          mode: "compose-service",
          service: "toss-mtls-client-proxy",
          volumes: ["mtls_client_certs"],
        },
      ]);

      const result = runCompare(consumerRoot);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("status: scoped match");
    });
  });

  test("compose-service mode ignores root comments after scoped entries", () => {
    withConsumer((consumerRoot) => {
      const template = readFileSync(
        path.join(repoRoot, "templates/trailbase/compose/toss-mtls-client-proxy.yml"),
        "utf8",
      );
      writeConsumerFile(
        consumerRoot,
        "apps/trailbase/docker-compose.yml",
        `${template.replace(
          "\nvolumes:\n",
          "\n# app-owned root comment before volumes\nvolumes:\n",
        )}# app-owned trailing root comment\n`,
      );
      writeMapping(consumerRoot, [
        {
          name: "Compose toss mTLS proxy",
          template: "templates/trailbase/compose/toss-mtls-client-proxy.yml",
          consumer: "apps/trailbase/docker-compose.yml",
          mode: "compose-service",
          service: "toss-mtls-client-proxy",
          volumes: ["mtls_client_certs"],
        },
      ]);

      const result = runCompare(consumerRoot);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("status: scoped match");
    });
  });

  test("compose-service mode matches quoted service and volume keys", () => {
    withConsumer((consumerRoot) => {
      const template = readFileSync(
        path.join(repoRoot, "templates/trailbase/compose/toss-mtls-client-proxy.yml"),
        "utf8",
      );
      writeConsumerFile(
        consumerRoot,
        "apps/trailbase/docker-compose.yml",
        template
          .replace("  toss-mtls-client-proxy:\n", '  "toss-mtls-client-proxy":\n')
          .replace("  mtls_client_certs:\n", "  'mtls_client_certs':\n"),
      );
      writeMapping(consumerRoot, [
        {
          name: "Compose toss mTLS proxy",
          template: "templates/trailbase/compose/toss-mtls-client-proxy.yml",
          consumer: "apps/trailbase/docker-compose.yml",
          mode: "compose-service",
          service: "toss-mtls-client-proxy",
          volumes: ["mtls_client_certs"],
        },
      ]);

      const result = runCompare(consumerRoot);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("status: scoped match");
    });
  });

  test("compose-service mode matches direct services instead of nested keys", () => {
    withConsumer((consumerRoot) => {
      const template = readFileSync(
        path.join(repoRoot, "templates/trailbase/compose/toss-mtls-client-proxy.yml"),
        "utf8",
      );
      writeConsumerFile(
        consumerRoot,
        "apps/trailbase/docker-compose.yml",
        template.replace(
          "services:\n",
          [
            "services:",
            "  app:",
            "    image: app/trailbase:local",
            "    depends_on:",
            "      toss-mtls-client-proxy:",
            "        condition: service_started",
            "",
          ].join("\n"),
        ),
      );
      writeMapping(consumerRoot, [
        {
          name: "Compose toss mTLS proxy",
          template: "templates/trailbase/compose/toss-mtls-client-proxy.yml",
          consumer: "apps/trailbase/docker-compose.yml",
          mode: "compose-service",
          service: "toss-mtls-client-proxy",
          volumes: ["mtls_client_certs"],
        },
      ]);

      const result = runCompare(consumerRoot);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("status: scoped match");
    });
  });

  test("env-subset mode accepts required template keys inside a larger env file", () => {
    withConsumer((consumerRoot) => {
      writeConsumerFile(
        consumerRoot,
        "apps/trailbase/.env.production.example",
        [
          "PM_APP_ENV=production",
          "COMPOSE_PROFILES=worker,toss-proxy",
          "TOSS_LOGIN_MODE=proxy",
          "MTLS_PROXY_TOKEN=replace-with-internal-proxy-token",
          "APP_SPECIFIC_VALUE=ok",
          "",
        ].join("\n"),
      );
      writeMapping(consumerRoot, [
        {
          name: "Proxy env example",
          template: "templates/trailbase/env/toss-mtls-client-proxy.env.example",
          consumer: "apps/trailbase/.env.production.example",
          mode: "env-subset",
        },
      ]);

      const result = runCompare(consumerRoot);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("status: env subset present");
      expect(result.stdout).not.toContain("APP_SPECIFIC_VALUE");
    });
  });

  test("env-subset mode accepts forward Toss login mode", () => {
    withConsumer((consumerRoot) => {
      writeConsumerFile(
        consumerRoot,
        "apps/trailbase/.env.production.example",
        [
          "COMPOSE_PROFILES=toss-proxy",
          "TOSS_LOGIN_MODE=forward",
          "MTLS_PROXY_TOKEN=app-owned-secret",
          "",
        ].join("\n"),
      );
      writeMapping(consumerRoot, [
        {
          name: "Proxy env example",
          template: "templates/trailbase/env/toss-mtls-client-proxy.env.example",
          consumer: "apps/trailbase/.env.production.example",
          mode: "env-subset",
        },
      ]);

      const result = runCompare(consumerRoot);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("status: env subset present");
    });
  });

  test("env-subset mode accepts quoted values with inline comments", () => {
    withConsumer((consumerRoot) => {
      writeConsumerFile(
        consumerRoot,
        "apps/trailbase/.env.production.example",
        [
          'COMPOSE_PROFILES="worker,toss-proxy" # production compose profiles',
          "TOSS_LOGIN_MODE='forward' # route SANDBOX through the proxy path",
          "MTLS_PROXY_TOKEN=app-owned-secret",
          "",
        ].join("\n"),
      );
      writeMapping(consumerRoot, [
        {
          name: "Proxy env example",
          template: "templates/trailbase/env/toss-mtls-client-proxy.env.example",
          consumer: "apps/trailbase/.env.production.example",
          mode: "env-subset",
        },
      ]);

      const result = runCompare(consumerRoot);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("status: env subset present");
    });
  });

  test("env-subset mode reports fixed template value drift", () => {
    withConsumer((consumerRoot) => {
      writeConsumerFile(
        consumerRoot,
        "apps/trailbase/.env.production.example",
        [
          "PM_APP_ENV=production",
          "COMPOSE_PROFILES=worker",
          "TOSS_LOGIN_MODE=stub",
          "MTLS_PROXY_TOKEN=app-owned-secret",
          "",
        ].join("\n"),
      );
      writeMapping(consumerRoot, [
        {
          name: "Proxy env example",
          template: "templates/trailbase/env/toss-mtls-client-proxy.env.example",
          consumer: "apps/trailbase/.env.production.example",
          mode: "env-subset",
        },
      ]);

      const result = runCompare(consumerRoot);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("env subset mismatched fixed values:");
      expect(result.stdout).toContain(
        'COMPOSE_PROFILES must include toss-proxy (found "worker")',
      );
      expect(result.stdout).toContain(
        'TOSS_LOGIN_MODE must be one of proxy, forward (found "stub")',
      );
      expect(result.stdout).not.toContain("MTLS_PROXY_TOKEN");
    });
  });

  test("env-subset mode uses the final dotenv assignment for duplicate keys", () => {
    withConsumer((consumerRoot) => {
      writeConsumerFile(
        consumerRoot,
        "apps/trailbase/.env.production.example",
        [
          "COMPOSE_PROFILES=toss-proxy",
          "COMPOSE_PROFILES=worker",
          "TOSS_LOGIN_MODE=proxy",
          "MTLS_PROXY_TOKEN=app-owned-secret",
          "",
        ].join("\n"),
      );
      writeMapping(consumerRoot, [
        {
          name: "Proxy env example",
          template: "templates/trailbase/env/toss-mtls-client-proxy.env.example",
          consumer: "apps/trailbase/.env.production.example",
          mode: "env-subset",
        },
      ]);

      const result = runCompare(consumerRoot);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        'COMPOSE_PROFILES must include toss-proxy (found "worker")',
      );
    });
  });

  test("exact mode keeps identical-file behavior", () => {
    withConsumer((consumerRoot) => {
      const template = readFileSync(
        path.join(repoRoot, "templates/trailbase/scripts/toss-proxy-smoke.sh"),
        "utf8",
      );
      const smokeScriptPath = "apps/trailbase/scripts/toss-proxy-smoke.sh";
      writeConsumerFile(consumerRoot, smokeScriptPath, template);
      chmodSync(path.join(consumerRoot, smokeScriptPath), 0o755);
      writeMapping(consumerRoot, [
        {
          name: "Proxy smoke script",
          template: "templates/trailbase/scripts/toss-proxy-smoke.sh",
          consumer: "apps/trailbase/scripts/toss-proxy-smoke.sh",
        },
      ]);

      const result = runCompare(consumerRoot);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("status: identical");
    });
  });
});

function withConsumer(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "trailbase-consumer-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeConsumerFile(root, relativePath, content) {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function writeMapping(root, checks) {
  writeConsumerFile(root, "apps/trailbase/kit-template-map.json", JSON.stringify({ checks }, null, 2));
}

function runCompare(consumerRoot) {
  return spawnSync(
    process.execPath,
    [
      compareScript,
      consumerRoot,
      "--mapping",
      "apps/trailbase/kit-template-map.json",
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
}
