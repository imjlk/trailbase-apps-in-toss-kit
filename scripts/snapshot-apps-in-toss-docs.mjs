import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { assertValidDocumentSnapshot } from "./apps-in-toss-snapshot-validation.mjs";

const OUT_DIR = "data/upstream/apps-in-toss";
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
    url: "https://developers-apps-in-toss.toss.im/documentation/integration/sdk-3.x.md",
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
    url: "https://developers-apps-in-toss.toss.im/api/auth.md",
    expectedText: "# 인증"
  },
  {
    key: "toss-login-api",
    title: "Toss Login API",
    url: "https://developers-apps-in-toss.toss.im/api/toss-login.md",
    expectedText: "# 토스 로그인"
  },
  {
    key: "iap-api",
    title: "In-app purchase API",
    url: "https://developers-apps-in-toss.toss.im/api/iap.md",
    expectedText: "# 인앱 결제"
  },
  {
    key: "promotion-api",
    title: "Promotion API",
    url: "https://developers-apps-in-toss.toss.im/api/promotion.md",
    expectedText: "# 프로모션(토스 포인트)"
  },
  {
    key: "push-api",
    title: "Push and Smart Message API",
    url: "https://developers-apps-in-toss.toss.im/api/push.md",
    expectedText: "# 푸시, 알림"
  },
  {
    key: "smart-message-guide",
    title: "Smart Message overview and notification agreement policy",
    url: "https://developers-apps-in-toss.toss.im/documentation/common/growth/smart-message.md",
    expectedText: "# 스마트 발송"
  },
  {
    key: "review-guide",
    title: "Review request guide",
    url: "https://developers-apps-in-toss.toss.im/documentation/common/growth/review.md",
    expectedText: "# 리뷰 요청"
  },
  {
    key: "review-request-sdk",
    title: "Review.request SDK",
    url: "https://developers-apps-in-toss.toss.im/documentation/sdk/domains-api/review/review.request.md",
    expectedText: "# Review"
  },
  {
    key: "promotion-grant-reward-sdk",
    title: "Promotion.grantReward SDK",
    url: "https://developers-apps-in-toss.toss.im/documentation/sdk/domains-api/promotion/promotion.grantreward.md",
    expectedText: "# Promotion.grantReward"
  },
  {
    key: "promotion-guide",
    title: "Promotion operations guide",
    url: "https://developers-apps-in-toss.toss.im/guide/marketing/promotion.md",
    expectedText: "# 프로모션"
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
    key: "anonymous-user-key-api",
    title: "Anonymous user key verification API",
    url: "https://developers-apps-in-toss.toss.im/api/user-key.md",
    expectedText: "# 사용자 식별 키"
  },
  {
    key: "iap-subscription-guide",
    title: "In-app subscription guide",
    url: "https://developers-apps-in-toss.toss.im/documentation/common/monetization/iap/in-app-subscription.md",
    expectedText: "# IAP 정기결제"
  },
  {
    key: "tds-react-native",
    title: "TDS React Native docs",
    url: "https://tossmini-docs.toss.im/tds-react-native/",
    expectedText: "Toss Design System | React Native"
  }
];

const NPM_PACKAGES = [
  { packageName: "@ait-kit/sdk", optional: false },
  { packageName: "@apps-in-toss/web-framework", optional: false },
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

async function readResponse(url, { optional = false, json = false } = {}) {
  // Keep the timeout active until the body has been consumed as well.
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!res.ok) {
    if (optional && res.status === 404) {
      return { unavailable: true, status: res.status };
    }
    throw new Error(`${url} returned ${res.status}`);
  }
  return json ? res.json() : res.text();
}

async function snapshotDocs() {
  const docs = [];

  for (const source of DOC_SOURCES) {
    const body = await readResponse(source.url);
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
    const result = await readResponse(registryUrl(source.packageName), { optional: source.optional, json: true });
    if (!result.unavailable && (typeof result.version !== "string" || !result.version)) {
      throw new Error(`${source.packageName} did not return a package version`);
    }
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

async function readExistingText(path) {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

async function writeFileIfChanged(path, contents) {
  if ((await readExistingText(path)) === contents) return;
  await writeFile(path, contents);
}

function formatSnapshotMarkdown(snapshot, kind) {
  const lines = [
    `# Apps in Toss Upstream ${kind === "documents" ? "Document" : "Package"} Snapshot`,
    "",
    `- Fetched at: ${snapshot.fetchedAt}`,
    "",
    "Discovery only. Reviewed reference versions are maintained in docs/en/apps-in-toss-tracking.md.",
    ""
  ];
  for (const entry of snapshot[kind]) {
    if (kind === "documents") {
      lines.push(`- ${entry.title}`, `  - URL: ${entry.url}`, `  - SHA-256: \`${entry.sha256}\``, `  - Bytes: ${entry.bytes}`);
    } else {
      const status = entry.unavailable ? `unavailable on public npm latest (${entry.status})` : entry.version;
      lines.push(`- \`${entry.packageName}\`: ${status}`);
    }
  }
  return [...lines, ""].join("\n");
}

async function persistSnapshot(outDir, kind, entries, now) {
  const basename = kind === "documents" ? "docs-snapshot" : "packages-snapshot";
  const jsonPath = `${outDir}/${basename}.json`;
  const previousText = await readExistingText(jsonPath);
  const previous = previousText ? JSON.parse(previousText) : null;
  const snapshot = {
    fetchedAt: previous && JSON.stringify(previous[kind]) === JSON.stringify(entries)
      ? previous.fetchedAt : now(),
    [kind]: entries
  };
  await mkdir(outDir, { recursive: true });
  await writeFileIfChanged(jsonPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  await writeFileIfChanged(`${outDir}/${basename}.md`, formatSnapshotMarkdown(snapshot, kind));
}

// Each source family commits its own validated result. A moved document must not
// discard successful npm discovery; failures retain that family's last good file.
export async function runSnapshots({
  outDir = OUT_DIR,
  documents = snapshotDocs,
  packages = snapshotPackages,
  now = () => new Date().toISOString()
} = {}) {
  const results = await Promise.allSettled(
    Object.entries({ documents, packages }).map(async ([kind, collect]) => {
      const entries = await collect();
      await persistSnapshot(outDir, kind, entries, now);
      return `${kind}: ${entries.length}`;
    })
  );
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) {
    throw new AggregateError(failures.map((result) => result.reason),
      failures.map((result) => result.reason.message).join("\n"));
  }
  return results.map((result) => result.value);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log((await runSnapshots()).join("\n"));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
