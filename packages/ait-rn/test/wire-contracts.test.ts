import { expect, test } from "bun:test";
import fixtures from "../../../fixtures/contracts/apps-in-toss.v1.json";
import { createAppsInTossIapGrantClient } from "../src/iap";

test("IAP backend query transport preserves wire outcomes without inventing grant success", async () => {
  for (const row of fixtures.iap) {
    const client = createAppsInTossIapGrantClient({
      baseUrl: "https://fixture.test",
      endpoints: { grantEndpoint: "/grant", completeEndpoint: "/complete", pendingEndpoint: "/pending" },
      getAuthHeaders: () => ({ Authorization: "Bearer fixture-user-token" }),
      fetcher: async (url, init) => {
        expect(url).toBe("https://fixture.test/pending");
        expect(new Headers(init.headers).get("authorization")).toBe("Bearer fixture-user-token");
        return Response.json(row.proxyResponse);
      },
    });
    expect(await client.pending()).toEqual(row.proxyResponse);
  }
});
