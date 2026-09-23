import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as aitRn from "../src/index";

const packageRoot = join(import.meta.dir, "..");

describe("retired contacts viral reward surface", () => {
  test("cannot be imported through the package root or former subpath", () => {
    const packageJson = JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    ) as { exports: Record<string, string> };

    expect(packageJson.exports["./share-reward"]).toBeUndefined();
    expect(existsSync(join(packageRoot, "src/share-reward.ts"))).toBe(false);
    expect(Object.keys(aitRn)).not.toContain(
      "createAppsInTossContactsViralBridge",
    );
    expect(Object.keys(aitRn)).not.toContain("runContactsViralReward");
  });

  test("RN source has no legacy SDK call path", () => {
    const sourceRoot = join(packageRoot, "src");
    const visit = (directory: string): string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory()
          ? visit(path)
          : entry.name.endsWith(".ts")
            ? [path]
            : [];
      });

    const callers = visit(sourceRoot).filter((path) =>
      /\bcontactsViral\b|\bContactsViral\b/.test(readFileSync(path, "utf8")),
    );
    expect(callers).toEqual([]);
  });
});
