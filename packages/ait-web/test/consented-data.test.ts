import { expect, test } from "bun:test";
import { createAppsInTossWebAdapter, type AppsInTossWebSdk } from "../src/index";

function adapter(read: unknown) {
  return createAppsInTossWebAdapter({
    appKey: "consent-test",
    loadSdk: async () => ({ User: { getConsentedData: read } }) as AppsInTossWebSdk,
  });
}

test("consented data preserves missing fields and never persists or reuses a response", async () => {
  const calls: unknown[] = [];
  const read = Object.assign(async (input: unknown) => {
    calls.push(input);
    return calls.length === 1 ? { USER_BIRTHDAY: "19900101" } : {};
  }, { isSupported: () => true });
  const client = adapter(read);
  expect(await client.getConsentedData({ consentedUserDataKey: "cud_fixture" })).toEqual({ USER_BIRTHDAY: "19900101" });
  expect(await client.getConsentedData({ consentedUserDataKey: "cud_fixture", shouldRequestAgreementWhenUserDeclined: true })).toEqual({});
  expect(calls).toEqual([
    { consentedUserDataKey: "cud_fixture", shouldRequestAgreementWhenUserDeclined: false },
    { consentedUserDataKey: "cud_fixture", shouldRequestAgreementWhenUserDeclined: true },
  ]);
});

test("unsupported or missing consent capability never opens native consent UI", async () => {
  for (const supported of [false, undefined]) {
    let calls = 0;
    const read = Object.assign(async () => { calls++; return {}; }, supported === undefined ? {} : { isSupported: () => supported });
    await expect(adapter(read).getConsentedData({ consentedUserDataKey: "cud_fixture" })).rejects.toMatchObject({ code: "UNSUPPORTED" });
    expect(calls).toBe(0);
  }
  await expect(adapter(undefined).getConsentedData({ consentedUserDataKey: "cud_fixture" })).rejects.toMatchObject({ code: "UNSUPPORTED" });
});

test("consent errors redact provider personal data and are not retried", async () => {
  let calls = 0;
  const read = Object.assign(async () => { calls++; throw Error("private-personal-data"); }, { isSupported: () => true });
  const error = await adapter(read).getConsentedData({ consentedUserDataKey: "cud_fixture" }).catch(error => error);
  expect(error.code).toBe("SDK_ERROR");
  expect(String(error)).not.toContain("private-personal-data");
  expect(calls).toBe(1);
});

test("invalid purpose and prompt options fail before the SDK is loaded", async () => {
  let loads = 0;
  const client = createAppsInTossWebAdapter({ appKey: "consent-test", loadSdk: async () => { loads++; throw Error("should not load"); } });
  for (const key of ["", "cud_", "unknown", "cud_test\n", "cud_" + "x".repeat(257)]) {
    await expect(client.getConsentedData({ consentedUserDataKey: key })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  }
  await expect(client.getConsentedData({ consentedUserDataKey: "cud_fixture", shouldRequestAgreementWhenUserDeclined: "yes" as unknown as boolean })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  expect(loads).toBe(0);
});
