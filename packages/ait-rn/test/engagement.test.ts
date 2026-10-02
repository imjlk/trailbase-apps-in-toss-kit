import { describe, expect, test } from "bun:test";
import { createExposureTracker, createForegroundRefreshController, entryReferrerFromScheme, normalizeNetworkAvailability } from "../src/engagement";
import { safeGetAppsInTossNetworkStatus } from "../src/runtime";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("entry attribution", () => {
  test("retains only known channels and rejects duplicate/malformed/private data", () => {
    expect(entryReferrerFromScheme("intoss://app/poll/123?referrer=external_share&token=secret")).toBe("external_share");
    expect(entryReferrerFromScheme("intoss://app?referrer=%70ush")).toBe("push");
    for (const url of [null, "intoss://app#?referrer=push", "intoss://app?referrer=push&referrer=search", "intoss://app?referrer=%zz", "intoss://app?referrer=private-user", "intoss://app?referrer=https://secret"]) {
      expect(entryReferrerFromScheme(url)).toBe("unknown");
    }
  });
});

test("exposure requires continuous visibility and stops on unmount", async () => {
  let calls = 0;
  const tracker = createExposureTracker({ minimumVisibleMs: 8, onExposure: () => { calls++; } });
  await new Promise((r) => setTimeout(r, 12));
  expect(calls).toBe(0);
  tracker.setVisible(true);
  tracker.setVisible(false);
  await new Promise((r) => setTimeout(r, 12));
  expect(calls).toBe(0);
  tracker.setVisible(true);
  await new Promise((r) => setTimeout(r, 12));
  tracker.setVisible(false);
  tracker.setVisible(true);
  await new Promise((r) => setTimeout(r, 12));
  expect(calls).toBe(1);
  const disposed = createExposureTracker({ minimumVisibleMs: 0, onExposure: () => { calls++; } });
  disposed.setVisible(true); disposed.dispose();
  await tick();
  expect(calls).toBe(1);
});

test("native probes fail open as unknown, including timeouts", async () => {
  expect(normalizeNetworkAvailability("UNKNOWN")).toBe("unknown");
  expect(normalizeNetworkAvailability("OFFLINE")).toBe("offline");
  expect(normalizeNetworkAvailability("WWAN")).toBe("online");
  expect(await safeGetAppsInTossNetworkStatus({ getNetworkStatus: async () => { throw Error("private"); } })).toBe("UNKNOWN");
  expect(await safeGetAppsInTossNetworkStatus({ getNetworkStatus: () => new Promise(() => {}), timeoutMs: 5 })).toBe("UNKNOWN");
});

test("foreground refresh skips mount/offline, throttles returns, and allows explicit retry", async () => {
  let calls = 0;
  let time = 1;
  let network = "OFFLINE";
  const statuses: unknown[] = [];
  const controller = createForegroundRefreshController({
    getNetworkStatus: async () => network,
    refresh: async () => { calls++; }, now: () => time,
    onStatus: (status) => statuses.push(status),
  });
  controller.setActive(true, "a"); await tick();
  expect(calls).toBe(0);
  controller.setActive(false, "a"); controller.setActive(true, "a"); await tick();
  expect(calls).toBe(0);
  network = "UNKNOWN";
  controller.retry(); await tick();
  expect(calls).toBe(1);
  controller.setActive(false, "a"); controller.setActive(true, "a"); await tick();
  expect(calls).toBe(1);
  time += 15_000;
  controller.setActive(false, "a"); controller.setActive(true, "a"); await tick();
  expect(calls).toBe(2);
  expect(statuses).toContainEqual({ network: "offline", refreshing: false, failed: false });
  controller.dispose(); controller.retry(); await tick();
  expect(calls).toBe(2);
});

test("a stale native result cannot refresh another account and new returns are not lost", async () => {
  let resolve!: (value: unknown) => void;
  let probes = 0;
  let refreshes = 0;
  const controller = createForegroundRefreshController({
    getNetworkStatus: () => ++probes === 1 ? new Promise((done) => { resolve = done; }) : Promise.resolve("WIFI"),
    refresh: async () => { refreshes++; },
  });
  controller.setActive(true, "a");
  controller.setActive(false, "a");
  controller.setActive(true, "b");
  resolve("OFFLINE"); await tick();
  expect(probes).toBe(2);
  expect(refreshes).toBe(1);
  controller.dispose();
});

test("a failed read refresh is contained and retryable", async () => {
  const statuses: unknown[] = [];
  let calls = 0;
  const controller = createForegroundRefreshController({
    getNetworkStatus: async () => "WIFI",
    refresh: async () => { if (++calls === 1) throw Error("failed read"); },
    onStatus: (state) => statuses.push(state),
  });
  controller.setActive(true); await tick();
  controller.retry(); await tick();
  expect(statuses.at(-1)).toEqual({ network: "online", refreshing: false, failed: true });
  controller.retry(); await tick();
  expect(statuses.at(-1)).toEqual({ network: "online", refreshing: false, failed: false });
  controller.dispose();
});

test("an account switch while inactive cannot inherit the previous account throttle", async () => {
  let refreshes = 0;
  const controller = createForegroundRefreshController({
    getNetworkStatus: async () => "WIFI",
    refresh: async () => { refreshes++; },
    now: () => 1_000,
  });
  controller.setActive(true, "a"); await tick();
  controller.retry(); await tick();
  expect(refreshes).toBe(1);
  controller.setActive(false, "a");
  controller.setActive(false, "b");
  controller.setActive(true, "b"); await tick();
  expect(refreshes).toBe(2);
  controller.dispose();
});

for (const phase of [false, true]) {
  for (const action of ["deactivate", "dispose", "switch"] as const) {
    test(`onStatus ${action} at refreshing=${phase} cancels the old refresh`, async () => {
      let armed = false;
      let probes = 0;
      const refreshedProbes: number[] = [];
      const controller = createForegroundRefreshController({
        getNetworkStatus: async () => { probes++; return "WIFI"; },
        refresh: async () => { refreshedProbes.push(probes); },
        now: () => 1_000,
        onStatus: (state) => {
          if (!armed || state.refreshing !== phase) return;
          armed = false;
          if (action === "dispose") controller.dispose();
          else controller.setActive(action === "switch", action === "switch" ? "b" : "a");
        },
      });
      controller.setActive(true, "a"); await tick();
      armed = true;
      controller.retry(); await tick();
      expect(refreshedProbes).toEqual(action === "switch" ? [3] : []);
      if (action === "deactivate") {
        controller.setActive(true, "a"); await tick();
        // A canceled request must not consume the current account's throttle.
        expect(refreshedProbes).toEqual([3]);
      }
      controller.dispose();
    });
  }
}
