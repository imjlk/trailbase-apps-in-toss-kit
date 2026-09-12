import assert from "node:assert/strict";
import test from "node:test";
import { checkTracking } from "./check-apps-in-toss-tracking.mjs";

const entries = [
  ["@apps-in-toss/framework", "apps-in-toss-framework"],
  ["@toss/tds-react-native", "tds-react-native"],
  ["create-granite-app", "create-granite-app"],
  ["@granite-js/react-native", "granite-js-react-native"]
];
function fixture() {
  const markdown = entries.map(([pkg, marker]) => `<!-- renovate: datasource=npm depName=${pkg} versioning=npm -->\n- \`${marker}\`: \`1.0.0\``).join("\n");
  return {
    snapshot: { packages: entries.map(([packageName]) => ({ packageName, version: "2.0.0" })) },
    packageJson: { devDependencies: { "@apps-in-toss/framework": "1.0.0" } },
    trackingDocs: [{ path: "en", markdown }, { path: "ko", markdown }]
  };
}
test("new discoveries do not silently raise or invalidate reviewed references", () => {
  const result = checkTracking(fixture());
  assert.deepEqual(result.failures, []);
  assert.equal(result.discoveries.length, 4);
});
test("reviewed root and translated references must still agree", () => {
  const input = fixture();
  input.packageJson.devDependencies["@apps-in-toss/framework"] = "1.1.0";
  input.trackingDocs[1].markdown = input.trackingDocs[1].markdown.replaceAll("`1.0.0`", "`1.2.0`");
  const result = checkTracking(input);
  assert.equal(result.failures.length, 5);
});
