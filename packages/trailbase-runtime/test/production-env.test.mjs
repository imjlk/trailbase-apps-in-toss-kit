import { describe, expect, test } from "bun:test";
import {
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
});
