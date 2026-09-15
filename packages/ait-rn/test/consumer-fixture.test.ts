import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as aitRn from "../src/index";

/**
 * Consumer fixture: every public export of the RN package must stay
 * constructible/callable through its documented surface after the
 * @ait-kit/sdk delegation, and an RN consumer must never acquire a
 * transitive dependency on the web SDK.
 */
describe("RN consumer fixture", () => {
  test("public API surface builds and stays constructible", async () => {
    expect(typeof aitRn.createAppsInTossLoginBridge).toBe("function");
    expect(typeof aitRn.createAppsInTossFullScreenAdBridge).toBe("function");
    expect(typeof aitRn.createAppsInTossIapBridge).toBe("function");
    expect(typeof aitRn.createAppsInTossSessionStorage).toBe("function");
    expect(typeof aitRn.resolveAppsInTossAnonymousHash).toBe("function");
    expect(typeof aitRn.createAppsInTossSdkStorageBridge).toBe("function");

    const login = aitRn.createAppsInTossLoginBridge({ production: true });
    expect(typeof login.appLogin).toBe("function");
    expect(typeof login.getIsTossLoginIntegratedService).toBe("function");

    const ads = aitRn.createAppsInTossFullScreenAdBridge();
    expect(typeof ads.preload).toBe("function");
    expect(typeof ads.show).toBe("function");
    expect(typeof ads.preloadAndShow).toBe("function");
    expect(typeof ads.clear).toBe("function");

    const iap = aitRn.createAppsInTossIapBridge();
    expect(typeof iap.purchaseOneTime).toBe("function");
    expect(typeof iap.purchaseSubscription).toBe("function");
    expect(typeof iap.restorePendingOrders).toBe("function");
    expect(typeof iap.getProducts).toBe("function");
    expect(typeof iap.getSubscriptionInfo).toBe("function");
    expect(typeof iap.completeProductGrant).toBe("function");

    const storage = aitRn.createAppsInTossSessionStorage({ appKey: "sample" });
    expect(storage.anonymousHashStorageKey).toBe("sample.anonymousHash");
    expect(storage.appSessionStorageKey).toBe("sample.appSession");
    expect(typeof storage.storage.getItem).toBe("function");
  });

  test("RN sources never import the web SDK entry", () => {
    const offenders: string[] = [];
    const visit = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const entryPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          visit(entryPath);
          continue;
        }
        if (!/\.ts$/.test(entry.name)) continue;
        const content = readFileSync(entryPath, "utf8");
        if (content.includes("@ait-kit/sdk/web") || content.includes("@apps-in-toss/web-framework")) {
          offenders.push(entryPath);
        }
      }
    };
    visit(join(import.meta.dir, "../src"));
    expect(offenders).toEqual([]);
  });
});
