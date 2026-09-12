import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const json = file => JSON.parse(readFileSync(new URL(file, root), "utf8"));
const alias = "@apps-in-toss/framework-min-supported";
const spec = json("package.json").devDependencies[alias];
const match = /^npm:@apps-in-toss\/framework@(\d+\.\d+\.\d+)$/.exec(spec ?? "");
assert(match, "Minimum SDK must be pinned as an exact npm alias");
const version = match[1];
const peer = json("packages/ait-rn/package.json").peerDependencies["@apps-in-toss/framework"];
assert.equal(/^>=(\d+\.\d+\.\d+)(?:\s|$)/.exec(peer ?? "")?.[1], version,
  "Minimum SDK fixture must match the RN adapter peer lower bound");
const installed = json(`node_modules/${alias}/package.json`);
assert.equal(installed.name, "@apps-in-toss/framework");
assert.equal(installed.version, version, "Installed minimum SDK does not match its fixture pin");
assert.deepEqual(json("tsconfig.sdk-min.json").compilerOptions.paths["@apps-in-toss/framework"],
  [`./node_modules/${alias}`], "Minimum typecheck must compile kit imports against the minimum SDK");
console.log(`Minimum RN SDK fixture: ${installed.name}@${version}`);
