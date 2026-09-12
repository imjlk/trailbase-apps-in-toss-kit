import { expect, test } from "bun:test";
import semver from "semver"; // Test oracle only; runtime imports no external packages.
import { compareVersions, parseVersion } from "../src/internal/semver.mjs";

test("bounded strict versions follow the SemVer precedence examples and npm oracle", () => {
  const versions = ["0.0.0", "1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta",
    "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0", "1.0.0+build.0001", "1.0.1", "1.10.0", "2.0.0"];
  for (const a of versions) for (const b of versions) {
    expect(parseVersion(a)).not.toBeNull();
    expect(compareVersions(a, b)).toBe(Math.sign(semver.compare(a, b)));
  }
});

test("strict syntax rejects ambiguous and unbounded inputs", () => {
  for (const value of [null, 3, "", "v1.2.3", "=1.2.3", " 1.2.3", "1.2.3\n", "01.2.3", "1.02.3", "1.2",
    "1.2.3-01", "1.2.3-a.01", "1.2.3-", "1.2.3+", "1.2.3-a..b", "1.2.3+a..b", "1.2.3-한", "1.2.3-a_b",
    "1.2.3+" + "a".repeat(123), "9007199254740992.0.0"]) {
    expect(parseVersion(value)).toBeNull();
  }
  expect(() => compareVersions("bad", "1.2.3")).toThrow("Invalid semantic version");
});

test("numeric prerelease ordering remains exact above safe integer precision", () => {
  expect(compareVersions("1.0.0-9007199254740992", "1.0.0-9007199254740993")).toBe(-1);
  expect(compareVersions("1.0.0-999999999999999999999", "1.0.0-a")).toBe(-1);
});
