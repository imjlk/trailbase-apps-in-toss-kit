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
    expect(typeof nativeModules.BedrockModule?.generateHapticFeedback).toBe(
      "function",
    );

    const bedrockOnlyGenerateHapticFeedback = () => undefined;
    const bedrockOnlyNativeModules = {
      BedrockModule: {
        generateHapticFeedback: bedrockOnlyGenerateHapticFeedback,
      },
    };
    expect(
      ensureAppsInTossHapticFallback({
        nativeModules: bedrockOnlyNativeModules,
      }),
    ).toBe(true);
    expect(
      bedrockOnlyNativeModules.BedrockModule.generateHapticFeedback,
    ).toBe(bedrockOnlyGenerateHapticFeedback);
    expect(
      typeof bedrockOnlyNativeModules.GraniteModule?.generateHapticFeedback,
    ).toBe("function");

    const missingNativeModules: {
      GraniteModule?: {
        generateHapticFeedback?: (
          options: { type: string },
        ) => void | Promise<void>;
      };
      BedrockModule?: {
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
    expect(typeof missingNativeModules.BedrockModule?.generateHapticFeedback).toBe(
      "function",
    );
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
