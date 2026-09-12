import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sourceState, requireStableSource, requireReportDestination, parseFixtureEvidence } from "./source-state.mjs";

test("evidence rejects modified and untracked source while allowing its output and Finder metadata", () => {
  const root = mkdtempSync(join(tmpdir(), "kit-source-evidence-"));
  const git = args => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  try {
    git(["init"]); writeFileSync(join(root, "source.mjs"), "export const value=1;\n");
    git(["add", "source.mjs"]);
    git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture"]);
    const output = join(root, "report.json");
    const clean = sourceState(root, output);
    expect(() => requireReportDestination(root, join(root, "source.mjs"))).toThrow("tracked source");
    expect(() => requireReportDestination(root, join(root, ".git", "HEAD"))).toThrow("Git metadata");
    symlinkSync(root, join(root, "alias"), "dir");
    expect(() => requireReportDestination(root, join(root, "alias", "source.mjs"))).toThrow("tracked source");
    rmSync(join(root, "alias"));
    requireReportDestination(root, output);
    writeFileSync(output, "{}"); writeFileSync(join(root, ".DS_Store"), "fixture");
    expect(sourceState(root, output).untrackedSource).toEqual([]);
    writeFileSync(join(root, "new.mjs"), "export const uncommitted=1;");
    expect(sourceState(root, output).untrackedSource).toEqual(["new.mjs"]);
    expect(() => requireStableSource(clean, sourceState(root, output))).toThrow("Source changed");
    rmSync(join(root, "new.mjs"));
    writeFileSync(join(root, "source.mjs"), "export const value=2;\n");
    expect(sourceState(root, output).trackedChanges).toEqual(["source.mjs"]);
    expect(() => requireStableSource(clean, sourceState(root, output))).toThrow("Source changed");
    expect(() => requireStableSource(clean, { ...clean, commit: "different" })).toThrow("Source changed");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("structured fixture failures cannot be promoted by a zero command exit", () => {
  expect(parseFixtureEvidence('progress\n{"ok":true,"checks":["fixture"]}').ok).toBe(true);
  for (const value of ['{"ok":false}', '{}', '[]', 'not JSON']) {
    expect(() => parseFixtureEvidence(value)).toThrow();
  }
});
