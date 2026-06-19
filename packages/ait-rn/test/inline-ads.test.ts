import { describe, expect, test } from "bun:test";
import {
  decideAppsInTossInlineAdPlaceholder,
  getAppsInTossInlineAdTestAdGroupId,
  isAppsInTossInlineAdSupported,
  type AppsInTossInlineAd,
} from "../src/inline-ads";

describe("AppsInToss inline ad helpers", () => {
  test("checks InlineAd support and minimum Toss app versions", async () => {
    await expect(isAppsInTossInlineAdSupported()).resolves.toBe(false);

    await expect(
      isAppsInTossInlineAdSupported({
        InlineAd: { isSupported: () => false },
      }),
    ).resolves.toBe(false);

    await expect(
      isAppsInTossInlineAdSupported({
        InlineAd: { isSupported: () => true },
        isMinVersionSupported: () => false,
      }),
    ).resolves.toBe(false);

    await expect(
      isAppsInTossInlineAdSupported({
        InlineAd: { isSupported: () => true },
        isMinVersionSupported: ({ android, ios }) =>
          android === "5.241.0" && ios === "5.241.0",
      }),
    ).resolves.toBe(true);

    await expect(
      isAppsInTossInlineAdSupported({
        InlineAd: { isSupported: () => true },
        isMinVersionSupported: () => true,
        operationalEnvironment: "sandbox",
      }),
    ).resolves.toBe(false);
    await expect(
      isAppsInTossInlineAdSupported({
        InlineAd: { isSupported: () => true },
        getOperationalEnvironment: () => "sandbox",
        isMinVersionSupported: () => true,
      }),
    ).resolves.toBe(false);
    await expect(
      isAppsInTossInlineAdSupported({
        InlineAd: { isSupported: () => true },
        isMinVersionSupported: () => true,
        operationalEnvironment: "toss",
      }),
    ).resolves.toBe(true);
    await expect(
      isAppsInTossInlineAdSupported({
        InlineAd: (() => undefined) satisfies AppsInTossInlineAd,
        isMinVersionSupported: () => true,
        operationalEnvironment: "toss",
      }),
    ).resolves.toBe(true);
    await expect(
      isAppsInTossInlineAdSupported({
        InlineAd: null,
        isMinVersionSupported: () => true,
        operationalEnvironment: "toss",
      }),
    ).resolves.toBe(false);

    const throwingInlineAd = {
      isSupported: () => {
        throw new Error("unsupported runtime");
      },
    } satisfies AppsInTossInlineAd;
    await expect(
      isAppsInTossInlineAdSupported({ InlineAd: throwingInlineAd }),
    ).resolves.toBe(false);
  });

  test("returns RN banner test ad ids", () => {
    expect(getAppsInTossInlineAdTestAdGroupId("banner")).toBe(
      "ait-ad-test-banner-id",
    );
    expect(getAppsInTossInlineAdTestAdGroupId("nativeImage")).toBe(
      "ait-ad-test-native-image-id",
    );
  });

  test("decides whether to reserve a non-component placeholder", () => {
    expect(
      decideAppsInTossInlineAdPlaceholder({
        renderState: "loading",
        supported: true,
      }),
    ).toEqual({
      height: 96,
      reason: "loading",
      shouldRenderPlaceholder: true,
    });

    expect(
      decideAppsInTossInlineAdPlaceholder({
        height: 120,
        renderState: "failed",
        supported: true,
      }),
    ).toEqual({
      height: 120,
      reason: "failed",
      shouldRenderPlaceholder: true,
    });

    expect(
      decideAppsInTossInlineAdPlaceholder({
        renderState: "noFill",
        supported: true,
      }),
    ).toEqual({
      reason: "none",
      shouldRenderPlaceholder: false,
    });

    expect(
      decideAppsInTossInlineAdPlaceholder({
        reserveSpace: false,
        supported: false,
      }),
    ).toEqual({
      reason: "disabled",
      shouldRenderPlaceholder: false,
    });
  });

  test("exports the inline-ads subpath", async () => {
    const module = await import(
      "@trailbase-apps-in-toss-kit/ait-rn/inline-ads"
    );
    expect(module.isAppsInTossInlineAdSupported).toBeFunction();
    expect(module.getAppsInTossInlineAdTestAdGroupId).toBeFunction();
    expect(module.decideAppsInTossInlineAdPlaceholder).toBeFunction();
  });
});
