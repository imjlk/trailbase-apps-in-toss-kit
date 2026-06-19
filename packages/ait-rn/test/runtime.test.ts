import { describe, expect, test } from "bun:test";
import {
  isAppsInTossProductionRuntime,
  isAppsInTossRuntimeSupported,
  isAppsInTossSandbox,
  safeGetAppsInTossAppVersion,
  safeGetAppsInTossOperationalEnvironment,
  safeGetAppsInTossPlatformOS,
} from "../src/runtime";

describe("AppsInToss runtime helpers", () => {
  test("safely reads the operational environment", async () => {
    await expect(
      safeGetAppsInTossOperationalEnvironment({
        getOperationalEnvironment: () => "sandbox",
      }),
    ).resolves.toBe("sandbox");
    await expect(
      safeGetAppsInTossOperationalEnvironment({
        getOperationalEnvironment: () => "toss",
      }),
    ).resolves.toBe("toss");
    await expect(
      safeGetAppsInTossOperationalEnvironment({
        getOperationalEnvironment: (() => "local") as never,
      }),
    ).resolves.toBe("unknown");
    await expect(
      safeGetAppsInTossOperationalEnvironment({
        getOperationalEnvironment: () => {
          throw new Error("runtime unavailable");
        },
      }),
    ).resolves.toBe("unknown");
  });

  test("safely reads platform and app version", async () => {
    await expect(
      safeGetAppsInTossPlatformOS({ getPlatformOS: () => "ios" }),
    ).resolves.toBe("ios");
    await expect(
      safeGetAppsInTossPlatformOS({ getPlatformOS: (() => "web") as never }),
    ).resolves.toBe("unknown");
    await expect(
      safeGetAppsInTossPlatformOS({
        getPlatformOS: () => {
          throw new Error("runtime unavailable");
        },
      }),
    ).resolves.toBe("unknown");

    await expect(
      safeGetAppsInTossAppVersion({
        getTossAppVersion: () => " 5.247.0 ",
      }),
    ).resolves.toBe("5.247.0");
    await expect(
      safeGetAppsInTossAppVersion({
        getTossAppVersion: (() => "") as never,
      }),
    ).resolves.toBeNull();
  });

  test("checks runtime support with SDK min-version semantics", async () => {
    const calls: unknown[] = [];
    await expect(
      isAppsInTossRuntimeSupported({
        isMinVersionSupported: (minVersions) => {
          calls.push(minVersions);
          return true;
        },
        minAndroid: "5.247.0",
        minIos: "5.241.0",
      }),
    ).resolves.toBe(true);
    expect(calls).toEqual([{ android: "5.247.0", ios: "5.241.0" }]);

    await expect(
      isAppsInTossRuntimeSupported({
        isMinVersionSupported: () => {
          throw new Error("runtime unavailable");
        },
      }),
    ).resolves.toBe(false);
  });

  test("classifies sandbox and production runtime environments", () => {
    expect(isAppsInTossSandbox("sandbox")).toBe(true);
    expect(isAppsInTossSandbox("toss")).toBe(false);
    expect(isAppsInTossProductionRuntime("toss")).toBe(true);
    expect(isAppsInTossProductionRuntime("unknown")).toBe(false);
  });
});
