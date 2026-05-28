import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

const OUT_DIR = "data/upstream/apps-in-toss";
const REQUEST_TIMEOUT_MS = 30_000;

const DOC_SOURCES = [
  {
    key: "release-notes",
    title: "Apps in Toss release notes",
    url: "https://developers-apps-in-toss.toss.im/release-note.md"
  },
  {
    key: "llms",
    title: "Apps in Toss llms.txt",
    url: "https://developers-apps-in-toss.toss.im/llms.txt"
  },
  {
    key: "react-native-tutorial",
    title: "React Native tutorial",
    url: "https://developers-apps-in-toss.toss.im/tutorials/react-native.md"
  },
  {
    key: "sdk-overview",
    title: "SDK overview",
    url: "https://developers-apps-in-toss.toss.im/bedrock/reference/framework/시작하기/intro.md"
  },
  {
    key: "api-overview",
    title: "API overview",
    url: "https://developers-apps-in-toss.toss.im/api/overview.md"
  },
  {
    key: "mtls-integration-process",
    title: "mTLS integration process",
    url: "https://developers-apps-in-toss.toss.im/development/integration-process.md"
  },
  {
    key: "login-develop",
    title: "Toss Login development",
    url: "https://developers-apps-in-toss.toss.im/login/develop.md"
  },
  {
    key: "iap-develop",
    title: "In-app purchase development",
    url: "https://developers-apps-in-toss.toss.im/iap/develop.md"
  },
  {
    key: "promotion-develop",
    title: "Promotion development",
    url: "https://developers-apps-in-toss.toss.im/promotion/develop.md"
  },
  {
    key: "smart-message-develop",
    title: "Smart Message development",
    url: "https://developers-apps-in-toss.toss.im/smart-message/develop.md"
  },
  {
    key: "smart-message-intro",
    title: "Smart Message overview and notification agreement policy",
    url: "https://developers-apps-in-toss.toss.im/smart-message/intro.md"
  },
  {
    key: "notification-agreement-sdk",
    title: "Notification agreement SDK requestNotificationAgreement",
    url: "https://developers-apps-in-toss.toss.im/bedrock/reference/framework/인터렉션/requestNotificationAgreement.md"
  },
  {
    key: "tds-react-native",
    title: "TDS React Native docs",
    url: "https://tossmini-docs.toss.im/tds-react-native/"
  }
];

const NPM_PACKAGES = [
  { packageName: "@apps-in-toss/framework", optional: false },
  { packageName: "@toss/tds-react-native", optional: false },
  { packageName: "create-granite-app", optional: false },
  { packageName: "@granite-js/react-native", optional: false },
  { packageName: "@toss-design-system/react-native", optional: true }
];

const headers = {
  accept: "text/plain, text/markdown, application/json, */*",
  "user-agent": "trailbase-apps-in-toss-kit-upstream-watch"
};

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function registryUrl(packageName) {
  return `https://registry.npmjs.org/${packageName.replace("/", "%2F")}/latest`;
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

async function readText(url) {
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new Error(`${url} returned ${res.status}`);
  }
  return res.text();
}

async function readJson(url, { optional = false } = {}) {
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    if (optional) {
      return {
        unavailable: true,
        status: res.status
      };
    }
    throw new Error(`${url} returned ${res.status}`);
  }
  return res.json();
}

async function snapshotDocs(fetchedAt) {
  const docs = [];

  for (const source of DOC_SOURCES) {
    const body = await readText(source.url);
    docs.push({
      key: source.key,
      title: source.title,
      url: source.url,
      fetchedAt,
      sha256: sha256(body),
      bytes: Buffer.byteLength(body, "utf8")
    });
  }

  return docs;
}

async function snapshotPackages(fetchedAt) {
  const packages = [];

  for (const source of NPM_PACKAGES) {
    const result = await readJson(registryUrl(source.packageName), { optional: source.optional });
    packages.push({
      packageName: source.packageName,
      fetchedAt,
      version: result.version ?? null,
      unavailable: result.unavailable === true,
      status: result.status ?? null,
      registryUrl: registryUrl(source.packageName)
    });
  }

  return packages;
}

function formatSnapshotMarkdown(snapshot) {
  const lines = [
    "# Apps in Toss Upstream Snapshot",
    "",
    `- Fetched at: ${snapshot.fetchedAt}`,
    "",
    "## Documents",
    ""
  ];

  for (const doc of snapshot.documents) {
    lines.push(`- ${doc.title}`);
    lines.push(`  - URL: ${doc.url}`);
    lines.push(`  - SHA-256: \`${doc.sha256}\``);
    lines.push(`  - Bytes: ${doc.bytes}`);
  }

  lines.push("", "## Reference Packages", "");

  for (const pkg of snapshot.packages) {
    const status = pkg.unavailable ? `unavailable on public npm latest (${pkg.status})` : pkg.version;
    lines.push(`- \`${pkg.packageName}\`: ${status}`);
  }

  lines.push("");
  return lines.join("\n");
}

const fetchedAt = new Date().toISOString();
const [documents, packages] = await Promise.all([
  snapshotDocs(fetchedAt),
  snapshotPackages(fetchedAt)
]);

const snapshot = {
  fetchedAt,
  documents,
  packages
};

await mkdir(OUT_DIR, { recursive: true });
await writeFile(`${OUT_DIR}/docs-snapshot.json`, `${JSON.stringify(snapshot, null, 2)}\n`);
await writeFile(`${OUT_DIR}/docs-snapshot.md`, formatSnapshotMarkdown(snapshot));

console.log(`Apps in Toss docs tracked: ${documents.length}`);
for (const pkg of packages) {
  const status = pkg.unavailable ? `unavailable (${pkg.status})` : pkg.version;
  console.log(`${pkg.packageName}: ${status}`);
}
