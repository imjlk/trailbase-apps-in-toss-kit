import assert from "node:assert/strict";
import test from "node:test";

import { assertValidDocumentSnapshot } from "./apps-in-toss-snapshot-validation.mjs";

const source = {
  url: "https://developers-apps-in-toss.toss.im/example.md",
  expectedText: "# Expected document"
};

test("accepts the expected Apps in Toss document", () => {
  assert.doesNotThrow(() =>
    assertValidDocumentSnapshot(source, "# Expected document\n\nContent")
  );
});

test("rejects an empty document", () => {
  assert.throws(
    () => assertValidDocumentSnapshot(source, " \n"),
    /returned an empty document/
  );
});

test("rejects GitBook Page Not Found documents returned with HTTP 200", () => {
  assert.throws(
    () =>
      assertValidDocumentSnapshot(
        source,
        "# Page Not Found\n\nThe URL `example` does not exist."
      ),
    /returned a Page Not Found document/
  );
});

test("rejects a response for the wrong document", () => {
  assert.throws(
    () => assertValidDocumentSnapshot(source, "# Another document\n"),
    /did not contain the expected document marker/
  );
});
