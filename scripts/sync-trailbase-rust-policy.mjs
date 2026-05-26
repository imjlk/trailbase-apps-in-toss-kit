import { readFile, writeFile } from "node:fs/promises";

const CHECK = process.argv.includes("--check");
const POLICY_PATH = "data/upstream/trailbase/version-policy.json";
const CARGO_TOML = "Cargo.toml";
const CRATE_MANIFESTS = [
  "crates/trailbase-guest-common/Cargo.toml",
  "crates/trailbase-toss-identity/Cargo.toml"
];
const RUST_TOOLCHAIN = "rust-toolchain.toml";
const MISE_TOML = ".mise.toml";

function warning(message) {
  console.warn(`::warning title=TrailBase Rust policy::${message}`);
}

async function readUtf8(path) {
  return readFile(path, "utf8");
}

async function readPolicy() {
  const policy = JSON.parse(await readUtf8(POLICY_PATH));
  const msrv = policy.upstreamMinimumRustVersion;
  const toolchain = policy.upstreamRustToolchain;

  if (!msrv || !toolchain) {
    warning(
      `Missing upstream Rust policy in ${POLICY_PATH}; leaving repo Rust policy unchanged.`
    );
    return null;
  }

  return { msrv, toolchain };
}

function updateTomlSectionValue(content, sectionName, key, value, afterKey) {
  const sectionRegex = new RegExp(`^\\[${sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\s*$`, "m");
  const match = content.match(sectionRegex);

  if (!match || match.index == null) {
    throw new Error(`Missing [${sectionName}] section`);
  }

  const sectionStart = match.index;
  const bodyStart = sectionStart + match[0].length;
  const nextSectionMatch = content.slice(bodyStart).match(/^\[[^\]]+\]\s*$/m);
  const sectionEnd = nextSectionMatch?.index == null ? content.length : bodyStart + nextSectionMatch.index;
  const before = content.slice(0, bodyStart);
  const sectionBody = content.slice(bodyStart, sectionEnd);
  const after = content.slice(sectionEnd);
  const lines = sectionBody.split("\n");
  const keyRegex = new RegExp(`^(\\s*)${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=.*$`);
  const nextLine = `${key} = "${value}"`;

  const existingIndex = lines.findIndex((line) => keyRegex.test(line));
  if (existingIndex !== -1) {
    lines[existingIndex] = nextLine;
    return `${before}${lines.join("\n")}${after}`;
  }

  const afterIndex = afterKey
    ? lines.findIndex((line) => new RegExp(`^\\s*${afterKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`).test(line))
    : -1;

  if (afterIndex !== -1) {
    lines.splice(afterIndex + 1, 0, nextLine);
  } else {
    lines.splice(lines[0] === "" ? 1 : 0, 0, nextLine);
  }

  return `${before}${lines.join("\n")}${after}`;
}

function updatePackageWorkspaceRustVersion(content) {
  return updateTomlSectionValue(
    content,
    "package",
    "rust-version.workspace",
    "true",
    "edition.workspace"
  ).replace(/rust-version\.workspace = "true"/, "rust-version.workspace = true");
}

function rustToolchainToml(toolchain) {
  return [
    "[toolchain]",
    `channel = "${toolchain}"`,
    'profile = "minimal"',
    'targets = ["wasm32-wasip2"]',
    'components = ["rustfmt", "clippy"]',
    ""
  ].join("\n");
}

function updateMiseRustToolchain(content, toolchain) {
  const sectionRegex = /^\[tools\]\s*$/m;
  const match = content.match(sectionRegex);
  const rustLine = `"rust" = { version = "${toolchain}", profile = "minimal", components = "rustfmt,clippy", targets = "wasm32-wasip2" }`;

  if (!match || match.index == null) {
    return ["[tools]", rustLine, ""].join("\n");
  }

  const bodyStart = match.index + match[0].length;
  const nextSectionMatch = content.slice(bodyStart).match(/^\[[^\]]+\]\s*$/m);
  const sectionEnd = nextSectionMatch?.index == null ? content.length : bodyStart + nextSectionMatch.index;
  const before = content.slice(0, bodyStart);
  const sectionBody = content.slice(bodyStart, sectionEnd);
  const after = content.slice(sectionEnd);
  const lines = sectionBody.split("\n");
  const rustIndex = lines.findIndex((line) => /^\s*"?rust"?\s*=/.test(line));

  if (rustIndex !== -1) {
    lines[rustIndex] = rustLine;
  } else {
    lines.push(rustLine);
  }

  return `${before}${lines.join("\n")}${after}`;
}

async function writeOrCheck(path, nextContent) {
  let current = "";
  try {
    current = await readUtf8(path);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }

  if (current === nextContent) {
    return false;
  }

  if (CHECK) {
    throw new Error(`${path} is not synchronized with ${POLICY_PATH}`);
  }

  await writeFile(path, nextContent);
  return true;
}

const policy = await readPolicy();
if (!policy) {
  process.exit(0);
}

let changed = false;

changed =
  (await writeOrCheck(
    CARGO_TOML,
    updateTomlSectionValue(await readUtf8(CARGO_TOML), "workspace.package", "rust-version", policy.msrv, "edition")
  )) || changed;

for (const manifest of CRATE_MANIFESTS) {
  changed = (await writeOrCheck(manifest, updatePackageWorkspaceRustVersion(await readUtf8(manifest)))) || changed;
}

changed = (await writeOrCheck(RUST_TOOLCHAIN, rustToolchainToml(policy.toolchain))) || changed;
changed = (await writeOrCheck(MISE_TOML, updateMiseRustToolchain(await readUtf8(MISE_TOML), policy.toolchain))) || changed;

if (CHECK) {
  console.log("TrailBase Rust policy is synchronized.");
} else if (changed) {
  console.log("Synchronized TrailBase Rust policy.");
} else {
  console.log("TrailBase Rust policy was already synchronized.");
}
