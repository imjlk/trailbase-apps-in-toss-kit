import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  detectMtlsCertificatePair,
  parseEnv,
  validateProductionEnv,
} from "../src/production-env.mjs";

describe("production env validator", () => {
  test("parses dotenv values", () => {
    expect(
      parseEnv(`
# comment
export APP_ENV=production
APP_BASE_URL="https://example.com"
TOKEN='abc'
INLINE=value # ignored
`),
    ).toEqual({
      APP_ENV: "production",
      APP_BASE_URL: "https://example.com",
      TOKEN: "abc",
      INLINE: "value",
    });
  });

  test("rejects moving proxy image tags outside placeholder mode", () => {
    const result = validateProductionEnv({
      raw: [
        "APP_ENV=production",
        "TOSS_MTLS_CLIENT_PROXY_IMAGE=ghcr.io/example/proxy:edge",
      ].join("\n"),
      appEnvKey: "APP_ENV",
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain(
      "TOSS_MTLS_CLIENT_PROXY_IMAGE must not use latest or edge in production",
    );
  });

  test("validates fresh-start confirmation pairing", () => {
    const result = validateProductionEnv({
      raw: ["APP_ENV=production", "TRAILBASE_FRESH_START_CONFIRM=DELETE_TRAILBASE_DATA"].join(
        "\n",
      ),
      appEnvKey: "APP_ENV",
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain(
      "TRAILBASE_FRESH_START_CONFIRM is set without TRAILBASE_FRESH_START_TOKEN",
    );
  });

  test("detects a matching Toss Console certificate pair", () => {
    withTempDir((dir) => {
      writeFileSync(path.join(dir, "service_public.crt"), "cert");
      writeFileSync(path.join(dir, "service_private.key"), "key");

      expect(detectMtlsCertificatePair(dir)).toEqual({
        found: true,
        kind: "toss-console",
        clientCertPath: path.join(dir, "service_public.crt"),
        clientKeyPath: path.join(dir, "service_private.key"),
      });
    });
  });

  test("rejects unmatched Toss Console certificate filenames", () => {
    withTempDir((dir) => {
      writeFileSync(path.join(dir, "first_public.crt"), "cert");
      writeFileSync(path.join(dir, "second_private.key"), "key");

      expect(detectMtlsCertificatePair(dir).found).toBe(false);
    });
  });

  test("rejects empty-prefix Toss Console certificate filenames", () => {
    withTempDir((dir) => {
      writeFileSync(path.join(dir, "_public.crt"), "cert");
      writeFileSync(path.join(dir, "_private.key"), "key");

      expect(detectMtlsCertificatePair(dir).found).toBe(false);
    });
  });

  test("detects generic client certificate fallback filenames", () => {
    withTempDir((dir) => {
      writeFileSync(path.join(dir, "client-cert.pem"), "cert");
      writeFileSync(path.join(dir, "client-key.pem"), "key");

      expect(detectMtlsCertificatePair(dir)).toEqual({
        found: true,
        kind: "generic",
        clientCertPath: path.join(dir, "client-cert.pem"),
        clientKeyPath: path.join(dir, "client-key.pem"),
      });
    });
  });

  test("treats missing certificate directories as not found", () => {
    expect(detectMtlsCertificatePair(path.join(tmpdir(), "missing-mtls-dir")).found).toBe(false);
  });

  test("validates an explicit local mTLS certificate directory when requested", () => {
    withTempDir((dir) => {
      writeFileSync(path.join(dir, "client-cert.pem"), "cert");
      writeFileSync(path.join(dir, "client-key.pem"), "key");

      const result = validateProductionEnv({
        raw: [
          "APP_ENV=production",
          "MTLS_PROXY_MODE=forward",
          "MTLS_PROXY_TOKEN=12345678901234567890123456789012",
          "MTLS_UPSTREAM_BASE_URL=https://apps-in-toss-api.toss.im",
        ].join("\n"),
        appEnvKey: "APP_ENV",
        mtlsCertificatePairDir: dir,
      });

      expect(result.ok).toBe(true);
    });
  });

  test("accepts explicit mTLS certificate paths instead of directory auto-detection", () => {
    withTempDir((dir) => {
      const result = validateProductionEnv({
        raw: [
          "APP_ENV=production",
          "MTLS_PROXY_MODE=forward",
          "MTLS_PROXY_TOKEN=12345678901234567890123456789012",
          "MTLS_UPSTREAM_BASE_URL=https://apps-in-toss-api.toss.im",
          "MTLS_CLIENT_CERT_PATH=/run/mtls/custom_public.crt",
          "MTLS_CLIENT_KEY_PATH=/run/mtls/custom_private.key",
        ].join("\n"),
        appEnvKey: "APP_ENV",
        mtlsCertificatePairDir: dir,
      });

      expect(result.ok).toBe(true);
    });
  });

  test("prefers a detected Toss Console certificate pair over incomplete explicit fallback paths", () => {
    withTempDir((dir) => {
      writeFileSync(path.join(dir, "service_public.crt"), "cert");
      writeFileSync(path.join(dir, "service_private.key"), "key");

      const result = validateProductionEnv({
        raw: [
          "APP_ENV=production",
          "MTLS_PROXY_MODE=forward",
          "MTLS_PROXY_TOKEN=12345678901234567890123456789012",
          "MTLS_UPSTREAM_BASE_URL=https://apps-in-toss-api.toss.im",
          "MTLS_CLIENT_CERT_PATH=/run/mtls/stale_public.crt",
        ].join("\n"),
        appEnvKey: "APP_ENV",
        mtlsCertificatePairDir: dir,
      });

      expect(result.ok).toBe(true);
    });
  });

  test("rejects incomplete explicit mTLS certificate path settings", () => {
    withTempDir((dir) => {
      const result = validateProductionEnv({
        raw: [
          "APP_ENV=production",
          "MTLS_PROXY_MODE=forward",
          "MTLS_PROXY_TOKEN=12345678901234567890123456789012",
          "MTLS_UPSTREAM_BASE_URL=https://apps-in-toss-api.toss.im",
          "MTLS_CLIENT_CERT_PATH=/run/mtls/custom_public.crt",
        ].join("\n"),
        appEnvKey: "APP_ENV",
        mtlsCertificatePairDir: dir,
      });

      expect(result.ok).toBe(false);
      expect(result.failures).toContain(
        "MTLS_CLIENT_KEY_PATH is required when MTLS_CLIENT_CERT_PATH is set",
      );
    });
  });

  test("still rejects incomplete explicit paths when only generic fallback files exist", () => {
    withTempDir((dir) => {
      writeFileSync(path.join(dir, "client-cert.pem"), "cert");
      writeFileSync(path.join(dir, "client-key.pem"), "key");

      const result = validateProductionEnv({
        raw: [
          "APP_ENV=production",
          "MTLS_PROXY_MODE=forward",
          "MTLS_PROXY_TOKEN=12345678901234567890123456789012",
          "MTLS_UPSTREAM_BASE_URL=https://apps-in-toss-api.toss.im",
          "MTLS_CLIENT_CERT_PATH=/run/mtls/stale_public.crt",
        ].join("\n"),
        appEnvKey: "APP_ENV",
        mtlsCertificatePairDir: dir,
      });

      expect(result.ok).toBe(false);
      expect(result.failures).toContain(
        "MTLS_CLIENT_KEY_PATH is required when MTLS_CLIENT_CERT_PATH is set",
      );
    });
  });

  test("rejects missing mTLS certificate files when no explicit paths are configured", () => {
    withTempDir((dir) => {
      const result = validateProductionEnv({
        raw: [
          "APP_ENV=production",
          "MTLS_PROXY_MODE=forward",
          "MTLS_PROXY_TOKEN=12345678901234567890123456789012",
          "MTLS_UPSTREAM_BASE_URL=https://apps-in-toss-api.toss.im",
        ].join("\n"),
        appEnvKey: "APP_ENV",
        mtlsCertificatePairDir: dir,
      });

      expect(result.ok).toBe(false);
      expect(result.failures).toContain(
        "Provide mTLS certificates in mTLS certificate directory: expected one Toss Console pair (*_public.crt + *_private.key) or client-cert.pem + client-key.pem",
      );
    });
  });

  test("skips mTLS certificate directory validation outside forward mode", () => {
    withTempDir((dir) => {
      const result = validateProductionEnv({
        raw: [
          "APP_ENV=production",
          "MTLS_PROXY_MODE=stub",
        ].join("\n"),
        appEnvKey: "APP_ENV",
        mtlsCertificatePairDir: dir,
      });

      expect(result.ok).toBe(true);
    });
  });
});

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "trailbase-runtime-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
