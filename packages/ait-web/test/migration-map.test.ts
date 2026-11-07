import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * Keeps data/webview-migration-map.json exact. The consumer migration checker
 * trusts this file, so every ait-rn runtime export must be classified, every
 * "same" name must really be exported for WebView, and a "pending" name must
 * be reclassified as soon as a WebView export with that name lands.
 */
const packagesRoot = join(import.meta.dir, "..", "..");
const kitRoot = join(packagesRoot, "..");

type Replacement = { use: string; gap?: string };
type Entry = {
  webview: string | null;
  same: string[];
  replaced: Record<string, Replacement>;
  pending: string[];
  sdk3: string[];
  note: string;
};
type MigrationMap = { schemaVersion: number; subpaths: Record<string, Entry> };

const map = JSON.parse(readFileSync(join(kitRoot, "data", "webview-migration-map.json"), "utf8")) as MigrationMap;
const rnPackage = JSON.parse(readFileSync(join(packagesRoot, "ait-rn", "package.json"), "utf8")) as { exports: Record<string, string> };
const webPackage = JSON.parse(readFileSync(join(packagesRoot, "ait-web", "package.json"), "utf8")) as { exports: Record<string, string> };

const rnSubpaths = Object.keys(rnPackage.exports)
  .filter((key) => key !== "." && key !== "./package.json")
  .map((key) => key.slice(2))
  .sort();

async function runtimeExports(modulePath: string): Promise<Set<string>> {
  return new Set(Object.keys(await import(modulePath)));
}

async function webRuntimeExports(): Promise<Set<string>> {
  const names = new Set<string>();
  for (const [key, target] of Object.entries(webPackage.exports)) {
    if (key === "./package.json") continue;
    for (const name of await runtimeExports(join(packagesRoot, "ait-web", target))) names.add(name);
  }
  return names;
}

/** Parse the SDK's declaration file so a test-only mock.module cannot mask it. */
function webSdkRuntimeExports(): Set<string> {
  const require = createRequire(join(packagesRoot, "ait-web", "package.json"));
  const sdkRoot = dirname(require.resolve("@apps-in-toss/web-framework/package.json"));
  const declarations = readFileSync(join(sdkRoot, "dist", "index.d.ts"), "utf8");
  const names = new Set<string>();
  for (const block of declarations.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const raw of block[1].split(",")) {
      const item = raw.trim();
      if (!item || item.startsWith("type ")) continue;
      const alias = item.split(/\s+as\s+/).at(-1)?.trim();
      if (alias) names.add(alias);
    }
  }
  return names;
}

describe("data/webview-migration-map.json", () => {
  test("uses schema 1 and covers exactly the ait-rn subpaths", () => {
    expect(map.schemaVersion).toBe(1);
    expect(Object.keys(map.subpaths).sort()).toEqual(rnSubpaths);
  });

  test("classifies every ait-rn runtime export exactly once", async () => {
    for (const subpath of rnSubpaths) {
      const entry = map.subpaths[subpath];
      const classified = [...entry.same, ...Object.keys(entry.replaced), ...entry.pending];
      expect({ subpath, duplicates: classified.filter((name, index) => classified.indexOf(name) !== index) })
        .toEqual({ subpath, duplicates: [] });
      const actual = [...await runtimeExports(join(packagesRoot, "ait-rn", rnPackage.exports[`./${subpath}`]))].sort();
      expect({ subpath, names: [...classified].sort() }).toEqual({ subpath, names: actual });
    }
  });

  test("same-name exports exist for WebView and pending names do not", async () => {
    const web = await webRuntimeExports();
    for (const [subpath, entry] of Object.entries(map.subpaths)) {
      expect({ subpath, missing: entry.same.filter((name) => !web.has(name)) }).toEqual({ subpath, missing: [] });
      // A pending name that now exists for WebView must move to "same".
      expect({ subpath, stale: entry.pending.filter((name) => web.has(name)) }).toEqual({ subpath, stale: [] });
    }
  });

  test("the named WebView import exists and interim SDK 3 APIs are real", () => {
    const sdk = webSdkRuntimeExports();
    expect(sdk.size).toBeGreaterThan(50);
    const webImports = new Set(Object.keys(webPackage.exports)
      .filter((key) => key !== "./package.json")
      .map((key) => key === "." ? "@trailbase-apps-in-toss-kit/ait-web" : `@trailbase-apps-in-toss-kit/ait-web/${key.slice(2)}`));
    for (const [subpath, entry] of Object.entries(map.subpaths)) {
      if (entry.webview !== null && entry.webview.startsWith("@trailbase-apps-in-toss-kit/")) {
        expect({ subpath, webview: webImports.has(entry.webview) }).toEqual({ subpath, webview: true });
      }
      expect({ subpath, unknown: entry.sdk3.filter((name) => !sdk.has(name)) }).toEqual({ subpath, unknown: [] });
      expect(entry.note.trim().length).toBeGreaterThan(0);
    }
  });

  test("replacement text names only real adapter methods and exports", async () => {
    const { createAppsInTossWebAdapter } = await import("../src/index");
    const adapter = createAppsInTossWebAdapter({
      appKey: "migration-map",
      loadSdk: async () => { throw new Error("not loaded by this test"); },
    });
    const adapterKeys = new Set(Object.keys(adapter));
    const known = new Set([...await webRuntimeExports(), ...webSdkRuntimeExports()]);
    for (const [subpath, entry] of Object.entries(map.subpaths)) {
      for (const [name, replacement] of Object.entries(entry.replaced)) {
        const text = `${replacement.use} ${replacement.gap ?? ""}`;
        expect(replacement.use.trim().length).toBeGreaterThan(0);
        const methods = [...text.matchAll(/\bait\.(\w+)/g)].map((match) => match[1]);
        expect({ subpath, name, missing: methods.filter((method) => !adapterKeys.has(method)) })
          .toEqual({ subpath, name, missing: [] });
        const calls = [...text.matchAll(/(?<![.\w])((?:create|get|is)\w*)\(/g)].map((match) => match[1]);
        expect({ subpath, name, missing: calls.filter((call) => !known.has(call)) })
          .toEqual({ subpath, name, missing: [] });
      }
    }
  });
});
