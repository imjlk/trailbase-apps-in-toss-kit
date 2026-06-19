import {
  defaultFrameworkFunction,
  type AppsInTossContactsViral,
  type AppsInTossIsMinVersionSupported,
} from "./internal/framework";
import {
  createCleanupOnce,
  isAppsInTossBridgeSupported,
  withBridgeTimeout,
} from "./internal/event-bridge";
import {
  isAppsInTossRuntimeSupported,
  type AppsInTossMinVersionRequirement,
} from "./runtime";

export type { AppsInTossContactsViral } from "./internal/framework";

export const APPS_IN_TOSS_CONTACTS_VIRAL_SDK_SOURCE = "apps_in_toss_sdk";
export const APPS_IN_TOSS_CONTACTS_VIRAL_MIN_VERSION = "5.223.0";

export type AppsInTossContactsViralEventType = "close" | "sendViral";

export interface AppsInTossContactsViralRewardEvent {
  moduleId: string;
  providerPayload: unknown;
  rewardAmount: number;
  rewardUnit: string;
  source: typeof APPS_IN_TOSS_CONTACTS_VIRAL_SDK_SOURCE;
  type: "sendViral";
}

export interface AppsInTossContactsViralCloseEvent {
  closeReason?: string;
  moduleId: string;
  providerPayload: unknown;
  rewardUnit?: string;
  sendableRewardsCount?: number;
  sentRewardAmount?: number;
  sentRewardsCount?: number;
  source: typeof APPS_IN_TOSS_CONTACTS_VIRAL_SDK_SOURCE;
  type: "close";
}

export type AppsInTossContactsViralNormalizedEvent =
  | AppsInTossContactsViralCloseEvent
  | AppsInTossContactsViralRewardEvent;

export interface AppsInTossContactsViralRewardResult {
  close: AppsInTossContactsViralCloseEvent;
  events: AppsInTossContactsViralNormalizedEvent[];
  moduleId: string;
  rewardUnit?: string;
  rewards: AppsInTossContactsViralRewardEvent[];
  sendableRewardsCount?: number;
  sentRewardAmount?: number;
  sentRewardsCount?: number;
  source: typeof APPS_IN_TOSS_CONTACTS_VIRAL_SDK_SOURCE;
}

export type AppsInTossContactsViralBridgeErrorCode =
  | "CONTACTS_VIRAL_FAILED"
  | "CONTACTS_VIRAL_INVALID_EVENT"
  | "CONTACTS_VIRAL_MODULE_ID_REQUIRED"
  | "CONTACTS_VIRAL_TIMEOUT"
  | "CONTACTS_VIRAL_UNAVAILABLE"
  | "CONTACTS_VIRAL_UNSUPPORTED"
  | "CONTACTS_VIRAL_UNSUPPORTED_VERSION";

export class AppsInTossContactsViralBridgeError extends Error {
  code: AppsInTossContactsViralBridgeErrorCode;
  override cause?: unknown;

  constructor({
    cause,
    code,
    message,
  }: {
    cause?: unknown;
    code: AppsInTossContactsViralBridgeErrorCode;
    message: string;
  }) {
    super(message);
    this.name = "AppsInTossContactsViralBridgeError";
    this.code = code;
    this.cause = cause;
  }
}

export interface CreateAppsInTossContactsViralBridgeOptions {
  contactsViral?: AppsInTossContactsViral;
  isMinVersionSupported?: AppsInTossIsMinVersionSupported;
  minAndroid?: AppsInTossMinVersionRequirement;
  minIos?: AppsInTossMinVersionRequirement;
  timeoutMs?: number;
}

export interface AppsInTossContactsViralRewardOptions {
  moduleId: string;
  timeoutMs?: number;
}

export interface AppsInTossContactsViralBridge {
  runContactsViralReward(
    options: AppsInTossContactsViralRewardOptions,
  ): Promise<AppsInTossContactsViralRewardResult>;
}

export function createAppsInTossContactsViralBridge({
  contactsViral,
  isMinVersionSupported,
  minAndroid = APPS_IN_TOSS_CONTACTS_VIRAL_MIN_VERSION,
  minIos = APPS_IN_TOSS_CONTACTS_VIRAL_MIN_VERSION,
  timeoutMs = 60_000,
}: CreateAppsInTossContactsViralBridgeOptions = {}): AppsInTossContactsViralBridge {
  return {
    runContactsViralReward(options) {
      return runContactsViralReward({
        contactsViral,
        isMinVersionSupported,
        minAndroid,
        minIos,
        timeoutMs,
        ...options,
      });
    },
  };
}

export interface RunAppsInTossContactsViralRewardOptions
  extends AppsInTossContactsViralRewardOptions {
  contactsViral?: AppsInTossContactsViral;
  isMinVersionSupported?: AppsInTossIsMinVersionSupported;
  minAndroid?: AppsInTossMinVersionRequirement;
  minIos?: AppsInTossMinVersionRequirement;
}

export async function runContactsViralReward({
  contactsViral,
  isMinVersionSupported,
  minAndroid = APPS_IN_TOSS_CONTACTS_VIRAL_MIN_VERSION,
  minIos = APPS_IN_TOSS_CONTACTS_VIRAL_MIN_VERSION,
  moduleId,
  timeoutMs = 60_000,
}: RunAppsInTossContactsViralRewardOptions): Promise<AppsInTossContactsViralRewardResult> {
  const normalizedModuleId = normalizeRequiredModuleId(moduleId);
  const resolvedIsMinVersionSupported =
    isMinVersionSupported ??
    (await defaultFrameworkFunction("isMinVersionSupported"));
  if (resolvedIsMinVersionSupported) {
    const runtimeSupported = await isAppsInTossRuntimeSupported({
      isMinVersionSupported: resolvedIsMinVersionSupported,
      minAndroid,
      minIos,
    });
    if (!runtimeSupported) {
      throw new AppsInTossContactsViralBridgeError({
        code: "CONTACTS_VIRAL_UNSUPPORTED_VERSION",
        message:
          "Apps in Toss contactsViral is not supported by this Toss app version.",
      });
    }
  }

  const resolvedContactsViral =
    contactsViral ?? (await defaultFrameworkFunction("contactsViral"));
  if (!resolvedContactsViral) {
    throw new AppsInTossContactsViralBridgeError({
      code: "CONTACTS_VIRAL_UNAVAILABLE",
      message: "Apps in Toss contactsViral is not available in this runtime.",
    });
  }
  if (!isAppsInTossBridgeSupported(resolvedContactsViral)) {
    throw new AppsInTossContactsViralBridgeError({
      code: "CONTACTS_VIRAL_UNSUPPORTED",
      message: "Apps in Toss contactsViral is not supported in this runtime.",
    });
  }

  return requestContactsViralReward({
    contactsViral: resolvedContactsViral,
    moduleId: normalizedModuleId,
    timeoutMs,
  });
}

export function normalizeAppsInTossContactsViralEvent(
  event: unknown,
  moduleId: string,
): AppsInTossContactsViralNormalizedEvent | null {
  const record = objectCandidate(event);
  const type = stringCandidate(record?.type, event);
  const data = objectCandidate(record?.data);
  const normalizedModuleId = normalizeRequiredModuleId(moduleId);

  if (type === "sendViral") {
    const rewardAmount = numberCandidate(
      data?.rewardAmount,
      data?.reward_amount,
      record?.rewardAmount,
      record?.reward_amount,
    );
    const rewardUnit = stringCandidate(
      data?.rewardUnit,
      data?.reward_unit,
      record?.rewardUnit,
      record?.reward_unit,
    );
    if (rewardAmount === undefined || !rewardUnit) {
      return null;
    }
    return {
      moduleId: normalizedModuleId,
      providerPayload: event,
      rewardAmount,
      rewardUnit,
      source: APPS_IN_TOSS_CONTACTS_VIRAL_SDK_SOURCE,
      type: "sendViral",
    };
  }

  if (type === "close") {
    return {
      closeReason: stringCandidate(data?.closeReason, data?.close_reason),
      moduleId: normalizedModuleId,
      providerPayload: event,
      rewardUnit: stringCandidate(data?.rewardUnit, data?.reward_unit),
      sendableRewardsCount: numberCandidate(
        data?.sendableRewardsCount,
        data?.sendable_rewards_count,
      ),
      sentRewardAmount: numberCandidate(
        data?.sentRewardAmount,
        data?.sent_reward_amount,
      ),
      sentRewardsCount: numberCandidate(
        data?.sentRewardsCount,
        data?.sent_rewards_count,
      ),
      source: APPS_IN_TOSS_CONTACTS_VIRAL_SDK_SOURCE,
      type: "close",
    };
  }

  return null;
}

function requestContactsViralReward({
  contactsViral,
  moduleId,
  timeoutMs,
}: {
  contactsViral: AppsInTossContactsViral;
  moduleId: string;
  timeoutMs: number;
}) {
  return new Promise<AppsInTossContactsViralRewardResult>(
    (resolve, reject) => {
      const events: AppsInTossContactsViralNormalizedEvent[] = [];
      const rewards: AppsInTossContactsViralRewardEvent[] = [];
      let cleanup = createCleanupOnce();
      let settled = false;
      const clearTimeout = withBridgeTimeout({
        onTimeout: () => {
          settleReject(
            new AppsInTossContactsViralBridgeError({
              code: "CONTACTS_VIRAL_TIMEOUT",
              message: "Apps in Toss contactsViral timed out.",
            }),
          );
        },
        timeoutMs,
      });

      try {
        const nextCleanup = contactsViral({
          onError: (error) => {
            settleReject(
              new AppsInTossContactsViralBridgeError({
                cause: error,
                code: "CONTACTS_VIRAL_FAILED",
                message: "Apps in Toss contactsViral failed.",
              }),
            );
          },
          onEvent: (event) => {
            if (settled) {
              return;
            }
            const normalizedEvent = normalizeAppsInTossContactsViralEvent(
              event,
              moduleId,
            );
            if (!normalizedEvent) {
              settleReject(
                new AppsInTossContactsViralBridgeError({
                  cause: event,
                  code: "CONTACTS_VIRAL_INVALID_EVENT",
                  message: "Apps in Toss contactsViral event was invalid.",
                }),
              );
              return;
            }

            events.push(normalizedEvent);
            if (normalizedEvent.type === "sendViral") {
              rewards.push(normalizedEvent);
              return;
            }

            settleResolve(resultFromCloseEvent(normalizedEvent, events, rewards));
          },
          options: { moduleId },
        });
        cleanup = createCleanupOnce(nextCleanup);
        if (settled) {
          cleanupBestEffort();
        }
      } catch (error) {
        settleReject(
          new AppsInTossContactsViralBridgeError({
            cause: error,
            code: "CONTACTS_VIRAL_FAILED",
            message: "Apps in Toss contactsViral failed.",
          }),
        );
      }

      function settleResolve(result: AppsInTossContactsViralRewardResult) {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout();
        resolve(result);
        cleanupBestEffort();
      }

      function settleReject(error: unknown) {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout();
        reject(error);
        cleanupBestEffort();
      }

      function cleanupBestEffort() {
        try {
          cleanup();
        } catch {
          // SDK listener cleanup is best-effort and should not hide the result.
        }
      }
    },
  );
}

function resultFromCloseEvent(
  close: AppsInTossContactsViralCloseEvent,
  events: AppsInTossContactsViralNormalizedEvent[],
  rewards: AppsInTossContactsViralRewardEvent[],
): AppsInTossContactsViralRewardResult {
  return {
    close,
    events: [...events],
    moduleId: close.moduleId,
    rewardUnit: close.rewardUnit ?? rewards.at(-1)?.rewardUnit,
    rewards: [...rewards],
    sendableRewardsCount: close.sendableRewardsCount,
    sentRewardAmount:
      close.sentRewardAmount ?? totalRewardAmountForSingleUnit(rewards),
    sentRewardsCount: close.sentRewardsCount,
    source: APPS_IN_TOSS_CONTACTS_VIRAL_SDK_SOURCE,
  };
}

function totalRewardAmountForSingleUnit(
  rewards: AppsInTossContactsViralRewardEvent[],
) {
  if (rewards.length === 0) {
    return undefined;
  }
  const rewardUnit = rewards[0].rewardUnit;
  if (!rewards.every((reward) => reward.rewardUnit === rewardUnit)) {
    return undefined;
  }
  return rewards.reduce((sum, reward) => sum + reward.rewardAmount, 0);
}

function normalizeRequiredModuleId(value: string) {
  const normalized = stringCandidate(value);
  if (!normalized) {
    throw new AppsInTossContactsViralBridgeError({
      code: "CONTACTS_VIRAL_MODULE_ID_REQUIRED",
      message: "Apps in Toss contactsViral moduleId is required.",
    });
  }
  return normalized;
}

function objectCandidate(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringCandidate(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }
  return undefined;
}

function numberCandidate(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        continue;
      }
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}
