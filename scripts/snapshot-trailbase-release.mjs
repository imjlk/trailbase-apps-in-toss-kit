import { mkdir, writeFile } from "node:fs/promises";

const OWNER = "trailbaseio";
const REPO = "trailbase";
const OUT_DIR = "data/upstream/trailbase";
const REQUEST_TIMEOUT_MS = 30_000;

const headers = {
  accept: "application/vnd.github+json",
  "user-agent": "trailbase-apps-in-toss-kit-upstream-watch"
};

if (process.env.GITHUB_TOKEN) {
  headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, { headers, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`${url} timed out after ${REQUEST_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function readJson(url) {
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new Error(`${url} returned ${res.status}`);
  }
  return res.json();
}

async function readText(url) {
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new Error(`${url} returned ${res.status}`);
  }
  return res.text();
}

function normalizeVersion(value) {
  return String(value ?? "").trim().replace(/^v/i, "");
}

function splitChangelogSections(changelog) {
  const headings = [...changelog.matchAll(/^##\s+(v?\d+\.\d+\.\d+)\b[^\n]*(?:\n|$)/gm)];

  return headings.map((heading, index) => {
    const next = headings[index + 1];
    return {
      version: normalizeVersion(heading[1]),
      text: changelog.slice(heading.index, next?.index ?? changelog.length)
    };
  });
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function extractRustPolicy(text) {
  const original = String(text ?? "");
  const normalized = original.replace(/\s+/g, " ");

  const minimumRustVersion = firstMatch(normalized, [
    /Rust\s+MVRV[^\d]*(\d+\.\d+(?:\.\d+)?)/i,
    /Rust\s+MSRV[^\d]*(\d+\.\d+(?:\.\d+)?)/i,
    /M[SV]RV[^\d]*(\d+\.\d+(?:\.\d+)?)/i,
    /minimum\s+supported\s+Rust\s+version[^\d]*(\d+\.\d+(?:\.\d+)?)/i,
    /minimal\s+Rust\s+version[^\d]*(\d+\.\d+(?:\.\d+)?)/i
  ]);

  const rustToolchain = firstMatch(normalized, [
    /Rust\s+toolchain[^\d]*(\d+\.\d+(?:\.\d+)?)/i,
    /toolchain\s+to\s+(?:latest\s+stable:?\s*)?v?(\d+\.\d+(?:\.\d+)?)/i,
    /latest\s+stable:?\s*(\d+\.\d+(?:\.\d+)?)/i
  ]);

  if (!minimumRustVersion && !rustToolchain) {
    return null;
  }

  return {
    minimumRustVersion,
    rustToolchain,
    rawTextLines: original
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 40)
  };
}

function findLatestRustPolicy(changelog, latestReleaseBody) {
  const latestPolicy = extractRustPolicy(latestReleaseBody);
  if (latestPolicy) {
    return {
      source: "latest-release",
      sourceVersion: null,
      ...latestPolicy
    };
  }

  for (const section of splitChangelogSections(changelog)) {
    const policy = extractRustPolicy(section.text);
    if (policy) {
      return {
        source: "CHANGELOG.md",
        sourceVersion: section.version,
        ...policy
      };
    }
  }

  return {
    source: null,
    sourceVersion: null,
    minimumRustVersion: null,
    rustToolchain: null,
    rawTextLines: null
  };
}

const latest = await readJson(`https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`);
const changelog = await readText(
  `https://raw.githubusercontent.com/${OWNER}/${REPO}/main/CHANGELOG.md`
);

const latestVersion = normalizeVersion(latest.tag_name);
const rustPolicy = findLatestRustPolicy(changelog, latest.body ?? "");

await mkdir(OUT_DIR, { recursive: true });

await writeFile(
  `${OUT_DIR}/latest-release.md`,
  [
    `# TrailBase ${latest.tag_name}`,
    "",
    `- Published at: ${latest.published_at}`,
    `- Release URL: ${latest.html_url}`,
    "",
    "## Release notes",
    "",
    latest.body ?? ""
  ].join("\n")
);

await writeFile(
  `${OUT_DIR}/version-policy.json`,
  `${JSON.stringify(
    {
      latestTrailbaseVersion: latestVersion,
      latestReleaseTag: latest.tag_name,
      latestReleasePublishedAt: latest.published_at,
      latestReleaseUrl: latest.html_url,
      rustPolicySource: rustPolicy.source,
      rustPolicySourceVersion: rustPolicy.sourceVersion,
      upstreamMinimumRustVersion: rustPolicy.minimumRustVersion,
      upstreamRustToolchain: rustPolicy.rustToolchain,
      rawRustPolicyTextLines: rustPolicy.rawTextLines
    },
    null,
    2
  )}\n`
);

console.log(`TrailBase latest: ${latest.tag_name}`);
console.log(`Rust policy source: ${rustPolicy.source ?? "not found"}`);
console.log(`Upstream minimum Rust: ${rustPolicy.minimumRustVersion ?? "not found"}`);
console.log(`Upstream Rust toolchain: ${rustPolicy.rustToolchain ?? "not found"}`);
