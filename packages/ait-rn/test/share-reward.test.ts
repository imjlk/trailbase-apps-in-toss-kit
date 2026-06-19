import { describe, expect, test } from "bun:test";
import {
  AppsInTossContactsViralBridgeError,
  createAppsInTossContactsViralBridge,
  normalizeAppsInTossContactsViralEvent,
  runContactsViralReward,
  type AppsInTossContactsViral,
} from "../src/share-reward";

describe("AppsInToss contactsViral share reward bridge", () => {
  test("normalizes sendViral and close events while cleaning up once", async () => {
    let cleanupCalls = 0;
    const contactsViral: AppsInTossContactsViral = ({ onEvent }) => {
      onEvent({
        data: { rewardAmount: 100, rewardUnit: "coin" },
        type: "sendViral",
      });
      onEvent({
        data: {
          closeReason: "clickBackButton",
          rewardUnit: "coin",
          sendableRewardsCount: 2,
          sentRewardAmount: 100,
          sentRewardsCount: 1,
        },
        type: "close",
      });
      return () => {
        cleanupCalls += 1;
      };
    };

    await expect(
      runContactsViralReward({
        contactsViral,
        moduleId: " invite-module ",
      }),
    ).resolves.toMatchObject({
      close: {
        closeReason: "clickBackButton",
        sentRewardAmount: 100,
        sentRewardsCount: 1,
        type: "close",
      },
      moduleId: "invite-module",
      rewardUnit: "coin",
      rewards: [
        {
          rewardAmount: 100,
          rewardUnit: "coin",
          type: "sendViral",
        },
      ],
      sendableRewardsCount: 2,
      sentRewardAmount: 100,
      sentRewardsCount: 1,
      source: "apps_in_toss_sdk",
    });
    expect(cleanupCalls).toBe(1);
  });

  test("derives sent reward amount from sendViral events when close omits it", async () => {
    const contactsViral: AppsInTossContactsViral = ({ onEvent }) => {
      onEvent({
        data: { rewardAmount: "5", rewardUnit: "ticket" },
        type: "sendViral",
      });
      onEvent({
        data: { rewardAmount: 7, rewardUnit: "ticket" },
        type: "sendViral",
      });
      onEvent({
        data: { closeReason: "noReward", sentRewardsCount: "2" },
        type: "close",
      });
      return () => undefined;
    };

    await expect(
      runContactsViralReward({ contactsViral, moduleId: "module-1" }),
    ).resolves.toMatchObject({
      rewardUnit: "ticket",
      sentRewardAmount: 12,
      sentRewardsCount: 2,
    });
  });

  test("fails closed when SDK is unavailable, unsupported, or version unsupported", async () => {
    const missingBridge = createAppsInTossContactsViralBridge({
      contactsViral: undefined,
      isMinVersionSupported: undefined,
    });
    await expect(
      missingBridge.runContactsViralReward({ moduleId: "module-1" }),
    ).rejects.toMatchObject({ code: "CONTACTS_VIRAL_UNAVAILABLE" });

    const unsupportedContactsViral = Object.assign(
      () => () => undefined,
      { isSupported: () => false },
    ) as AppsInTossContactsViral;
    const unsupportedBridge = createAppsInTossContactsViralBridge({
      contactsViral: unsupportedContactsViral,
    });
    await expect(
      unsupportedBridge.runContactsViralReward({ moduleId: "module-1" }),
    ).rejects.toMatchObject({ code: "CONTACTS_VIRAL_UNSUPPORTED" });

    const unsupportedReturnBridge = createAppsInTossContactsViralBridge({
      contactsViral: (() => undefined) as AppsInTossContactsViral,
    });
    await expect(
      unsupportedReturnBridge.runContactsViralReward({
        moduleId: "module-1",
        timeoutMs: 10,
      }),
    ).rejects.toMatchObject({ code: "CONTACTS_VIRAL_UNSUPPORTED" });

    let called = false;
    const versionBridge = createAppsInTossContactsViralBridge({
      contactsViral: (() => {
        called = true;
        return () => undefined;
      }) as AppsInTossContactsViral,
      isMinVersionSupported: () => false,
    });
    await expect(
      versionBridge.runContactsViralReward({ moduleId: "module-1" }),
    ).rejects.toMatchObject({ code: "CONTACTS_VIRAL_UNSUPPORTED_VERSION" });
    expect(called).toBe(false);
  });

  test("cleans up once on SDK errors, invalid events, and timeouts", async () => {
    let errorCleanupCalls = 0;
    await expect(
      runContactsViralReward({
        contactsViral: ({ onError }) => {
          onError(new Error("bridge failed"));
          return () => {
            errorCleanupCalls += 1;
          };
        },
        moduleId: "module-1",
      }),
    ).rejects.toThrow(AppsInTossContactsViralBridgeError);
    expect(errorCleanupCalls).toBe(1);

    let invalidCleanupCalls = 0;
    await expect(
      runContactsViralReward({
        contactsViral: ({ onEvent }) => {
          onEvent({ type: "futureEvent" });
          return () => {
            invalidCleanupCalls += 1;
          };
        },
        moduleId: "module-1",
      }),
    ).rejects.toMatchObject({ code: "CONTACTS_VIRAL_INVALID_EVENT" });
    expect(invalidCleanupCalls).toBe(1);

    let invalidCloseCleanupCalls = 0;
    await expect(
      runContactsViralReward({
        contactsViral: ({ onEvent }) => {
          onEvent({ data: { closeReason: "noReward" }, type: "close" });
          return () => {
            invalidCloseCleanupCalls += 1;
          };
        },
        moduleId: "module-1",
      }),
    ).rejects.toMatchObject({ code: "CONTACTS_VIRAL_INVALID_EVENT" });
    expect(invalidCloseCleanupCalls).toBe(1);
    expect(
      normalizeAppsInTossContactsViralEvent(
        { data: { sentRewardsCount: 0 }, type: "close" },
        "module-1",
      ),
    ).toBeNull();

    let timeoutCleanupCalls = 0;
    await expect(
      runContactsViralReward({
        contactsViral: () => {
          return () => {
            timeoutCleanupCalls += 1;
          };
        },
        moduleId: "module-1",
        timeoutMs: 1,
      }),
    ).rejects.toMatchObject({ code: "CONTACTS_VIRAL_TIMEOUT" });
    expect(timeoutCleanupCalls).toBe(1);
  });

  test("rejects empty module ids before calling the SDK", async () => {
    let called = false;
    await expect(
      runContactsViralReward({
        contactsViral: (() => {
          called = true;
          return () => undefined;
        }) as AppsInTossContactsViral,
        moduleId: "  ",
      }),
    ).rejects.toMatchObject({ code: "CONTACTS_VIRAL_MODULE_ID_REQUIRED" });
    expect(called).toBe(false);
  });

  test("normalizes snake_case SDK payloads without exposing raw payloads", () => {
    const event = normalizeAppsInTossContactsViralEvent(
      {
        data: {
          close_reason: "noReward",
          reward_unit: "coin",
          sendable_rewards_count: "4",
          sent_reward_amount: "30",
          sent_rewards_count: "3",
          userKey: "raw-user-key",
        },
        type: "close",
      },
      "module-1",
    );

    expect(event).toMatchObject({
      closeReason: "noReward",
      rewardUnit: "coin",
      sendableRewardsCount: 4,
      sentRewardAmount: 30,
      sentRewardsCount: 3,
    });
    expect(event).not.toHaveProperty("providerPayload");
  });

  test("exports the share-reward subpath", async () => {
    const module = await import(
      "@trailbase-apps-in-toss-kit/ait-rn/share-reward"
    );
    expect(module.createAppsInTossContactsViralBridge).toBeFunction();
    expect(module.runContactsViralReward).toBeFunction();
  });
});
