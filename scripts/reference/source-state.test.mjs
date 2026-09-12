import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sourceState, requireStableSource } from "./source-state.mjs";

test("evidence rejects modified and untracked source while allowing its output and Finder metadata", () => {
  const root = mkdtempSync(join(tmpdir(), "kit-source-evidence-"));
  const git = args => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  try {
    git(["init"]); writeFileSync(join(root, "source.mjs"), "export const value=1;\n");
    git(["add", "source.mjs"]);
    git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture"]);
    const output = join(root, "report.json");
    const clean = sourceState(root, output);
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
