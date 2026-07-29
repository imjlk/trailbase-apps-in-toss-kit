import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { assertValidDocumentSnapshot } from "./apps-in-toss-snapshot-validation.mjs";

const OUT_DIR = "data/upstream/apps-in-toss";
const JSON_OUT = `${OUT_DIR}/docs-snapshot.json`;
const MARKDOWN_OUT = `${OUT_DIR}/docs-snapshot.md`;
const REQUEST_TIMEOUT_MS = 30_000;

const DOC_SOURCES = [
  {
    key: "release-notes",
    title: "Apps in Toss release notes",
    url: "https://developers-apps-in-toss.toss.im/release-note/release-note.md",
    expectedText: "# 릴리즈 노트"
  },
  {
    key: "llms",
    title: "Apps in Toss llms.txt",
    url: "https://developers-apps-in-toss.toss.im/llms.txt",
    expectedText: "# 앱인토스 개발자센터"
  },
  {
    key: "react-native-tutorial",
    title: "React Native tutorial",
    url: "https://developers-apps-in-toss.toss.im/ai-vibe-coding/tutorials/react-native.md",
    expectedText: "# React Native 시작하기"
  },
  {
    key: "react-native-reference",
    title: "React Native reference",
    url: "https://developers-apps-in-toss.toss.im/documentation/react-native.md",
    expectedText: "# React Native"
  },
  {
    key: "client-sdk-overview",
    title: "WebView Client SDK overview",
    url: "https://developers-apps-in-toss.toss.im/documentation/sdk.md",
    expectedText: "# Client SDK"
  },
  {
    key: "webview-sdk-3-migration",
    title: "WebView SDK 3.x migration",
    url: "https://developers-apps-in-toss.toss.im/development/sdk-3.x.md",
    expectedText: "# SDK 3.x 마이그레이션"
  },
  {
    key: "api-overview",
    title: "API overview",
    url: "https://developers-apps-in-toss.toss.im/documentation/overview.md",
    expectedText: "# API & SDK 한 눈에 보기"
  },
  {
    key: "integration-getting-started",
    title: "Apps in Toss integration getting started",
    url: "https://developers-apps-in-toss.toss.im/documentation/integration/getting-started.md",
    expectedText: "# 시작하기"
  },
  {
    key: "server-api-integration",
    title: "Server API integration",
    url: "https://developers-apps-in-toss.toss.im/documentation/integration/server-api.md",
    expectedText: "# 서버 API 이용하기"
  },
  {
    key: "api-auth",
    title: "API authentication and mTLS",
    url: "https://developers-apps-in-toss.toss.im/documentation/api/auth.md",
    expectedText: "# 인증"
  },
  {
    key: "toss-login-api",
    title: "Toss Login API",
    url: "https://developers-apps-in-toss.toss.im/documentation/api/toss-login.md",
    expectedText: "# 토스 로그인"
  },
  {
    key: "iap-api",
    title: "In-app purchase API",
    url: "https://developers-apps-in-toss.toss.im/documentation/api/iap.md",
    expectedText: "# 인앱 결제"
  },
  {
    key: "promotion-api",
    title: "Promotion API",
    url: "https://developers-apps-in-toss.toss.im/documentation/api/promotion.md",
    expectedText: "# 프로모션(토스 포인트)"
  },
  {
    key: "push-api",
    title: "Push and Smart Message API",
    url: "https://developers-apps-in-toss.toss.im/documentation/api/push.md",
    expectedText: "# 푸시, 알림"
  },
  {
    key: "smart-message-guide",
    title: "Smart Message overview and notification agreement policy",
    url: "https://developers-apps-in-toss.toss.im/documentation/common/growth/smart-message.md",
    expectedText: "# 스마트 발송"
  },
  {
    key: "notification-agreement-sdk",
    title: "Notification agreement SDK requestNotificationAgreement",
    url: "https://developers-apps-in-toss.toss.im/documentation/sdk/domains-api/notification/notification.requestagreement.md",
    expectedText: "# Notification.requestAgreement"
  },
  {
    key: "anonymous-user-key-sdk",
    title: "Anonymous user key SDK getAnonymousKey",
    url: "https://developers-apps-in-toss.toss.im/documentation/sdk/domains-api/user/user.getanonymouskey.md",
    expectedText: "# User.getAnonymousKey"
  },
  {
    key: "tds-react-native",
    title: "TDS React Native docs",
    url: "https://tossmini-docs.toss.im/tds-react-native/",
    expectedText: "Toss Design System | React Native"
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

async function snapshotDocs() {
  const docs = [];

  for (const source of DOC_SOURCES) {
    const body = await readText(source.url);
    assertValidDocumentSnapshot(source, body);
    docs.push({
      key: source.key,
      title: source.title,
      url: source.url,
      sha256: sha256(body),
      bytes: Buffer.byteLength(body, "utf8")
    });
  }

  return docs;
}

async function snapshotPackages() {
  const packages = [];

  for (const source of NPM_PACKAGES) {
    const result = await readJson(registryUrl(source.packageName), { optional: source.optional });
    packages.push({
      packageName: source.packageName,
      version: result.version ?? null,
      unavailable: result.unavailable === true,
      status: result.status ?? null,
      registryUrl: registryUrl(source.packageName)
    });
  }

  return packages;
}

async function readExistingSnapshot() {
  try {
    return JSON.parse(await readFile(JSON_OUT, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

async function readExistingText(path) {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

async function writeFileIfChanged(path, contents) {
  if ((await readExistingText(path)) === contents) {
    return false;
  }
  await writeFile(path, contents);
  return true;
}

function comparableSnapshot(snapshot) {
  return {
    documents: (snapshot?.documents ?? []).map((doc) => ({
      key: doc.key,
      title: doc.title,
      url: doc.url,
      sha256: doc.sha256,
      bytes: doc.bytes
    })),
    packages: (snapshot?.packages ?? []).map((pkg) => ({
      packageName: pkg.packageName,
      version: pkg.version ?? null,
      unavailable: pkg.unavailable === true,
      status: pkg.status ?? null,
      registryUrl: pkg.registryUrl
    }))
  };
}

function snapshotsHaveSameContent(left, right) {
  return JSON.stringify(comparableSnapshot(left)) === JSON.stringify(comparableSnapshot(right));
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

const existingSnapshot = await readExistingSnapshot();
const [documents, packages] = await Promise.all([
  snapshotDocs(),
  snapshotPackages()
]);

const nextSnapshot = {
  documents,
  packages
};

const snapshot = {
  fetchedAt:
    existingSnapshot && snapshotsHaveSameContent(existingSnapshot, nextSnapshot)
      ? existingSnapshot.fetchedAt
      : new Date().toISOString(),
  documents,
  packages
};

const nextJson = `${JSON.stringify(snapshot, null, 2)}\n`;
const nextMarkdown = formatSnapshotMarkdown(snapshot);

await mkdir(OUT_DIR, { recursive: true });
const jsonChanged = await writeFileIfChanged(JSON_OUT, nextJson);
const markdownChanged = await writeFileIfChanged(MARKDOWN_OUT, nextMarkdown);

console.log(`Apps in Toss docs tracked: ${documents.length}`);
console.log(
  `Snapshot files changed: ${jsonChanged || markdownChanged ? "yes" : "no"}`
);
for (const pkg of packages) {
  const status = pkg.unavailable ? `unavailable (${pkg.status})` : pkg.version;
  console.log(`${pkg.packageName}: ${status}`);
}
