import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
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
