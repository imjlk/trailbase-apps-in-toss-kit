import { describe, expect, test } from "bun:test";
import { createAppsInTossLoginBridge } from "../src/login";

describe("AppsInToss RN login bridge", () => {
  test("fails closed when production appLogin is unavailable", async () => {
    const bridge = createAppsInTossLoginBridge({ production: true });

    await expect(bridge.appLogin()).rejects.toMatchObject({
      code: "APP_LOGIN_UNAVAILABLE",
      name: "AppsInTossLoginBridgeError",
    });
  });

  test("wraps production appLogin throws", async () => {
    const bridge = createAppsInTossLoginBridge({
      appLogin: async () => {
        throw new Error("bridge failed");
      },
      production: true,
    });

    await expect(bridge.appLogin()).rejects.toMatchObject({
      code: "APP_LOGIN_THROWN",
    });
  });

  test("returns explicit dev appLogin fallbacks outside production", async () => {
    const bridge = createAppsInTossLoginBridge({
      createDevFallback: () => ({
        authorizationCode: "dev-auth-code",
        referrer: "SANDBOX",
      }),
      production: false,
    });

    await expect(bridge.appLogin()).resolves.toEqual({
      authorizationCode: "dev-auth-code",
      referrer: "SANDBOX",
    });
  });

  test("normalizes login integration check failures by runtime", async () => {
    const devBridge = createAppsInTossLoginBridge({
      getIsTossLoginIntegratedService: async () => {
        throw new Error("not configured");
      },
      production: false,
    });
    const prodBridge = createAppsInTossLoginBridge({
      getIsTossLoginIntegratedService: async () => {
        throw new Error("not configured");
      },
      production: true,
    });
    const disabledBridge = createAppsInTossLoginBridge({
      getIsTossLoginIntegratedService: async () => false,
      production: true,
    });

    await expect(
      devBridge.getIsTossLoginIntegratedService(),
    ).resolves.toBeUndefined();
    await expect(
      prodBridge.getIsTossLoginIntegratedService(),
    ).rejects.toMatchObject({
      code: "TOSS_LOGIN_INTEGRATION_CHECK_THROWN",
    });
    await expect(
      disabledBridge.getIsTossLoginIntegratedService(),
    ).resolves.toBeUndefined();
  });
});

