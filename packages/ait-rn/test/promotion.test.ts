import { describe, expect, test } from "bun:test";
import {
  AppsInTossPromotionCampaignClientError,
  createAppsInTossPromotionCampaignClient,
  normalizeAppsInTossPromotionClaimResult,
  sanitizePromotionClaimContext,
} from "../src/promotion";

describe("AppsInToss promotion helpers", () => {
  test("posts campaign claim payloads with auth headers and without provider secrets", async () => {
    const calls: Array<{
      body: unknown;
      headers: HeadersInit | undefined;
      url: string;
    }> = [];
    const client = createAppsInTossPromotionCampaignClient({
      baseUrl: "https://api.example.test",
      claimEndpoint: "/api/app/v1/promotions/claim",
      fetcher: async (url, init) => {
        calls.push({
          body: JSON.parse(String(init.body)),
          headers: init.headers,
          url,
        });
        return Response.json({
          campaignId: "daily-attendance",
          providerRequestId: "provider-request-1",
          rewardAmount: 50,
          status: "GRANTED",
        });
      },
      getAuthHeaders: () => ({ Authorization: "Bearer session-token" }),
    });

    await expect(
      client.claim({
        campaignId: " daily-attendance ",
        context: {
          publicReason: "attendance",
          promotionCode: "do-not-send",
          raw_toss_user_key: "raw-user-key",
          "raw-toss-user-key": "raw-user-key",
          TOSS_USER_KEY: "raw-user-key",
          userKey: "raw-user-key",
          nested: { tossUserKey: "raw-user-key", visible: true },
        },
        eligibilityId: "eligibility-1",
        requestId: "claim-1",
      }),
    ).resolves.toMatchObject({
      campaignId: "daily-attendance",
      granted: true,
      providerRequestId: "provider-request-1",
      rewardAmount: 50,
      status: "GRANTED",
    });

    expect(calls).toEqual([
      {
        body: {
          campaignId: "daily-attendance",
          context: {
            nested: { visible: true },
            publicReason: "attendance",
          },
          eligibilityId: "eligibility-1",
          requestId: "claim-1",
        },
        headers: {
          Authorization: "Bearer session-token",
          "Content-Type": "application/json",
        },
        url: "https://api.example.test/api/app/v1/promotions/claim",
      },
    ]);
    expect(JSON.stringify(calls[0]?.body)).not.toContain("promotionCode");
    expect(JSON.stringify(calls[0]?.body)).not.toContain("raw-user-key");
    expect(JSON.stringify(calls[0]?.body)).not.toContain("tossUserKey");
    expect(JSON.stringify(calls[0]?.body)).not.toContain("userKey");
    expect(JSON.stringify(calls[0]?.body)).not.toContain("MTLS_PROXY_TOKEN");
  });

  test("rejects empty campaign ids", async () => {
    let fetcherCalled = false;
    const client = createAppsInTossPromotionCampaignClient({
      claimEndpoint: "/claim",
      fetcher: async () => {
        fetcherCalled = true;
        return Response.json({});
      },
    });

    let error: unknown;
    try {
      await client.claim({ campaignId: "  " });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(AppsInTossPromotionCampaignClientError);
    expect(error).toMatchObject({
      code: "PROMOTION_CAMPAIGN_ID_REQUIRED",
    });
    expect(fetcherCalled).toBe(false);
  });

  test("normalizes claim response statuses and snake/camel provider fields", () => {
    expect(
      normalizeAppsInTossPromotionClaimResult({
        already_granted: true,
        campaign_id: "invite",
        provider_error_code: "4112",
        provider_request_id: "provider-1",
        reward_amount: "100",
      }),
    ).toEqual({
      alreadyGranted: true,
      campaignId: "invite",
      granted: true,
      providerErrorCode: "4112",
      providerRequestId: "provider-1",
      rewardAmount: 100,
      status: "ALREADY_GRANTED",
    });

    expect(
      normalizeAppsInTossPromotionClaimResult({
        campaign_id: "provider-campaign",
        provider_status: "success",
      }),
    ).toMatchObject({
      campaignId: "provider-campaign",
      granted: true,
      status: "GRANTED",
    });

    expect(
      normalizeAppsInTossPromotionClaimResult({
        campaignId: "daily",
        failure_reason: "budget exhausted",
        status: "budget-exhausted",
      }),
    ).toMatchObject({
      campaignId: "daily",
      failureReason: "budget exhausted",
      granted: false,
      status: "EXHAUSTED",
    });

    expect(
      normalizeAppsInTossPromotionClaimResult({
        grant: {
          campaignId: "mission",
          providerErrorCode: "4109",
          status: "notEligible",
        },
      }),
    ).toMatchObject({
      campaignId: "mission",
      providerErrorCode: "4109",
      status: "NOT_ELIGIBLE",
    });
  });

  test("sanitizes forbidden promotion client context keys recursively", () => {
    expect(
      sanitizePromotionClaimContext({
        MTLS_PROXY_TOKEN: "secret",
        keep: "value",
        list: [{ provider_promotion_code: "secret", safe: 1 }],
        "raw-toss-user-key": "raw",
        raw_toss_user_key: "raw",
        TOSS_USER_KEY: "raw",
        userKey: "raw",
      }),
    ).toEqual({
      keep: "value",
      list: [{ safe: 1 }],
    });
  });
});
