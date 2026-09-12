import { execFileSync } from "node:child_process";
import { resolve, relative, dirname, basename, sep, isAbsolute } from "node:path";
import { existsSync, realpathSync } from "node:fs";
export function sourceState(root, output) {
  const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trimEnd();
  const paths = args => git(args).split("\0").filter(Boolean);
  return {
    commit: git(["rev-parse", "HEAD"]),
    trackedChanges: paths(["diff", "HEAD", "--name-only", "-z"]),
    untrackedSource: paths(["ls-files", "--others", "--exclude-standard", "-z"])
      .filter(path => !/(^|\/)\.DS_Store$/.test(path) && resolve(root, path) !== output),
  };
}
export function requireStableSource(start, end) {
  if (start.commit !== end.commit || end.trackedChanges.length || end.untrackedSource.length) {
    throw new Error("Source changed during reference verification; rerun from committed inputs");
  }
}

function canonicalDestination(path) {
  const missing = []; let parent = path;
  while (!existsSync(parent)) { missing.unshift(basename(parent)); parent = dirname(parent); }
  return resolve(realpathSync(parent), ...missing);
}
export function requireReportDestination(root, output) {
  const base = realpathSync(root); const destination = canonicalDestination(output);
  if (destination === resolve(base, ".git")) throw new Error("Report output must not overwrite Git metadata");
  const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trimEnd();
  const tracked = git(["ls-files", "-z"]).split("\0").filter(Boolean);
  if (tracked.some(path => resolve(base, path) === destination)) throw new Error("Report output must not overwrite tracked source");
  for (const directory of [git(["rev-parse", "--absolute-git-dir"]), git(["rev-parse", "--git-common-dir"])]) {
    const metadata = canonicalDestination(resolve(root, directory));
    const child = relative(metadata, destination);
    if (!child || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child))) throw new Error("Report output must not overwrite Git metadata");
  }
}
export function parseFixtureEvidence(stdout) {
  let result;
  try { result = JSON.parse(stdout.slice(stdout.indexOf("{"))); } catch { throw new Error("Invalid reference fixture report"); }
  if (!result || Array.isArray(result) || result.ok !== true) throw new Error("Reference fixture did not report success");
  return result;
}
