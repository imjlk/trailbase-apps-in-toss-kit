import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createAppsInTossWebAdapter } from "../src/index";

/**
 * Consumer fixture: the web adapter's public surface stays constructible
 * after the @ait-kit/sdk delegation, and a web consumer never acquires a
 * transitive dependency on the React Native SDK.
 */
describe("web consumer fixture", () => {
  test("public API surface builds and stays constructible", async () => {
    const adapter = createAppsInTossWebAdapter({ appKey: "sample" });
    expect(typeof adapter.login).toBe("function");
    expect(typeof adapter.anonymousHash).toBe("function");
    expect(typeof adapter.storage.getItem).toBe("function");
    expect(typeof adapter.requestNotificationAgreement).toBe("function");
    expect(typeof adapter.purchase).toBe("function");
    expect(typeof adapter.subscribe).toBe("function");
    expect(typeof adapter.getPendingOrders).toBe("function");
    expect(typeof adapter.createShareLink).toBe("function");
    expect(typeof adapter.share).toBe("function");

    expect(() => createAppsInTossWebAdapter({ appKey: "" })).toThrow();
  });

  test("web sources never import the React Native SDK entry", () => {
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
        if (content.includes("@ait-kit/sdk/rn") || content.includes('import("@apps-in-toss/framework")')) {
          offenders.push(entryPath);
        }
      }
    };
    visit(join(import.meta.dir, "../src"));
    expect(offenders).toEqual([]);
  });
});
