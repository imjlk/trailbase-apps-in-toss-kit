import { readFile } from "node:fs/promises";

const SNAPSHOT_PATH = "data/upstream/apps-in-toss/docs-snapshot.json";
const PACKAGE_JSON_PATH = "package.json";
const TRACKING_DOCS = [
  { locale: "en", path: "docs/en/apps-in-toss-tracking.md" },
  { locale: "ko", path: "docs/ko/apps-in-toss-tracking.md" }
];

const TRACKED_PACKAGES = [
  {
    packageName: "@apps-in-toss/framework",
    markerKey: "apps-in-toss-framework",
    rootDevDependency: true
  },
  {
    packageName: "@toss/tds-react-native",
    markerKey: "tds-react-native"
  },
  {
    packageName: "create-granite-app",
    markerKey: "create-granite-app"
  },
  {
    packageName: "@granite-js/react-native",
    markerKey: "granite-js-react-native"
  }
];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function snapshotPackageVersion(snapshot, packageName) {
  const pkg = snapshot.packages?.find((entry) => entry.packageName === packageName);
  if (!pkg) {
    throw new Error(`${SNAPSHOT_PATH} is missing ${packageName}`);
  }

  if (pkg.unavailable || !pkg.version) {
    throw new Error(`${SNAPSHOT_PATH} does not contain an available version for ${packageName}`);
  }

  return String(pkg.version);
}

function trackingMarkerVersion(markdown, docPath, packageName, markerKey) {
  const pattern = new RegExp(
    [
      "<!--\\s*renovate:\\s*datasource=npm\\s+",
      `depName=${escapeRegex(packageName)}`,
      "[^>]*-->\\s*\\r?\\n",
      "-\\s*`",
      escapeRegex(markerKey),
      "`:\\s*`([^`]+)`"
    ].join(""),
    "g"
  );
  const matches = [...markdown.matchAll(pattern)];

  if (matches.length !== 1) {
    throw new Error(
      `${docPath} must contain exactly one Renovate marker for ${packageName} and ${markerKey}; found ${matches.length}`
    );
  }

  return matches[0][1].trim();
}

function rootDevDependencyVersion(packageJson, packageName) {
  const version = packageJson.devDependencies?.[packageName];
  if (!version) {
    throw new Error(`${PACKAGE_JSON_PATH} devDependencies is missing ${packageName}`);
  }
  return String(version);
}

const [snapshot, packageJson, ...trackingDocs] = await Promise.all([
  readJson(SNAPSHOT_PATH),
  readJson(PACKAGE_JSON_PATH),
  ...TRACKING_DOCS.map(async (doc) => ({
    ...doc,
    markdown: await readFile(doc.path, "utf8")
  }))
]);

const failures = [];
const checked = [];

for (const trackedPackage of TRACKED_PACKAGES) {
  const { packageName, markerKey, rootDevDependency } = trackedPackage;
  let snapshotVersion;

  try {
    snapshotVersion = snapshotPackageVersion(snapshot, packageName);
  } catch (err) {
    failures.push(err.message);
    continue;
  }

  const markerVersions = [];

  for (const doc of trackingDocs) {
    try {
      const markerVersion = trackingMarkerVersion(doc.markdown, doc.path, packageName, markerKey);
      markerVersions.push({ ...doc, version: markerVersion });

      if (markerVersion !== snapshotVersion) {
        failures.push(
          `${doc.path} tracks ${packageName}@${markerVersion}, but ${SNAPSHOT_PATH} has ${snapshotVersion}`
        );
      }
    } catch (err) {
      failures.push(err.message);
    }
  }

  const [firstMarker, ...restMarkers] = markerVersions;
  for (const marker of restMarkers) {
    if (firstMarker && marker.version !== firstMarker.version) {
      failures.push(
        `${marker.path} tracks ${packageName}@${marker.version}, but ${firstMarker.path} has ${firstMarker.version}`
      );
    }
  }

  if (rootDevDependency) {
    try {
      const rootVersion = rootDevDependencyVersion(packageJson, packageName);
      if (rootVersion !== snapshotVersion) {
        failures.push(
          `${PACKAGE_JSON_PATH} devDependency ${packageName}@${rootVersion} does not match ${SNAPSHOT_PATH} ${snapshotVersion}`
        );
      }
    } catch (err) {
      failures.push(err.message);
    }
  }

  checked.push(`${packageName}@${snapshotVersion}`);
}

if (failures.length > 0) {
  console.error("Apps in Toss tracking check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Apps in Toss tracking check passed: ${checked.join(", ")}`);
}
