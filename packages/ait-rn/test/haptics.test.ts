import { describe, expect, test } from "bun:test";
import { ensureAppsInTossHapticFallback } from "../src/haptics";

describe("AppsInToss RN haptic fallback", () => {
  test("installs haptic fallbacks only when native modules need one", async () => {
    const generateHapticFeedback = () => undefined;
    const nativeModules = {
      GraniteModule: { generateHapticFeedback },
    };
    expect(ensureAppsInTossHapticFallback({ nativeModules })).toBe(true);
    expect(nativeModules.GraniteModule.generateHapticFeedback).toBe(
      generateHapticFeedback,
    );

    const missingNativeModules: {
      GraniteModule?: {
        generateHapticFeedback?: (
          options: { type: string },
        ) => void | Promise<void>;
      };
    } = {};
    expect(
      ensureAppsInTossHapticFallback({ nativeModules: missingNativeModules }),
    ).toBe(true);
    const installedHapticFallback =
      missingNativeModules.GraniteModule?.generateHapticFeedback;
    expect(typeof installedHapticFallback).toBe("function");
    if (!installedHapticFallback) {
      throw new Error("Expected haptic fallback to be installed.");
    }
    await expect(
      Promise.resolve(installedHapticFallback({ type: "tap" })),
    ).resolves.toBeUndefined();

    const legacyNativeModules: {
      BedrockModule: {
        appVersion: string;
        generateHapticFeedback?: (
          options: { type: string },
        ) => void | Promise<void>;
      };
      GraniteModule?: {
        appVersion?: string;
        generateHapticFeedback?: (
          options: { type: string },
        ) => void | Promise<void>;
      };
    } = { BedrockModule: { appVersion: "legacy" } };
    expect(
      ensureAppsInTossHapticFallback({
        nativeModules: legacyNativeModules,
      }),
    ).toBe(true);
    expect(typeof legacyNativeModules.BedrockModule.generateHapticFeedback).toBe(
      "function",
    );
    expect(typeof legacyNativeModules.GraniteModule?.generateHapticFeedback).toBe(
      "function",
    );
    expect(
      ensureAppsInTossHapticFallback({ nativeModules: Object.freeze({}) }),
    ).toBe(false);
  });
});

