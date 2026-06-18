import { describe, expect, test } from "bun:test";
import {
  buildAppsInTossShareMessage,
  createAppsInTossShareBridge,
  extractAppsInTossSchemeValue,
  normalizeAppsInTossOgImageUrl,
  prewarmAppsInTossOgImage,
  resolveAppsInTossDeepLink,
  type AppsInTossGetTossShareLink,
  type AppsInTossShare,
} from "../src/share";

describe("AppsInToss share helpers", () => {
  test("resolves app deep links and preserves existing intoss links", () => {
    expect(
      resolveAppsInTossDeepLink({
        appName: "my-app",
        path: "/about",
        query: { flag: true, name: "test", skip: null },
      }),
    ).toBe("intoss://my-app/about?flag=true&name=test");
    expect(
      resolveAppsInTossDeepLink({
        deepLink: "intoss://my-app/polls/poll_123",
      }),
    ).toBe("intoss://my-app/polls/poll_123");
    expect(
      resolveAppsInTossDeepLink({
        appName: "my-app",
        deepLink: "polls/poll_123",
      }),
    ).toBe("intoss://my-app/polls/poll_123");

    const privateLink = resolveAppsInTossDeepLink({
      deepLink: "intoss-private://appsintoss?_deploymentId=dep_123",
      query: { categoryKey: "daily", tag: ["a", "b"] },
    });
    const privateUrl = new URL(privateLink);
    expect(privateUrl.searchParams.get("_deploymentId")).toBe("dep_123");
    expect(
      JSON.parse(privateUrl.searchParams.get("queryParams") ?? "{}"),
    ).toEqual({
      categoryKey: "daily",
      tag: ["a", "b"],
    });

    const editedPrivateLink = resolveAppsInTossDeepLink({
      deepLink:
        "intoss-private://appsintoss?_deploymentId=dep_123&categoryKey=weekly&queryParams=%7B%22mode%22%3A%22preview%22%7D",
      query: { categoryKey: "daily" },
    });
    const editedPrivateUrl = new URL(editedPrivateLink);
    expect(editedPrivateUrl.searchParams.get("_deploymentId")).toBe("dep_123");
    expect(editedPrivateUrl.searchParams.get("categoryKey")).toBeNull();
    expect(
      JSON.parse(editedPrivateUrl.searchParams.get("queryParams") ?? "{}"),
    ).toEqual({
      categoryKey: "daily",
      mode: "preview",
    });
  });

  test("normalizes OG image URLs with explicit dev/local allowances", () => {
    expect(
      normalizeAppsInTossOgImageUrl("https://example.com/og.png"),
    ).toBe("https://example.com/og.png");
    expect(normalizeAppsInTossOgImageUrl("http://example.com/og.png")).toBe(
      undefined,
    );
    expect(
      normalizeAppsInTossOgImageUrl("http://localhost:3000/og.png", {
        allowLocalHttp: true,
      }),
    ).toBe("http://localhost:3000/og.png");
    expect(
      normalizeAppsInTossOgImageUrl("http://example.com/og.png", {
        allowDevHttp: true,
        dev: true,
      }),
    ).toBe("http://example.com/og.png");
  });

  test("prewarms OG images without surfacing fetch errors", async () => {
    let calls = 0;
    await expect(
      prewarmAppsInTossOgImage("https://example.com/og.png", {
        fetcher: async () => {
          calls += 1;
          throw new Error("network failed");
        },
        timeoutMs: 1,
      }),
    ).resolves.toBeUndefined();
    expect(calls).toBe(1);
  });

  test("builds share messages and extracts scheme values", () => {
    expect(
      buildAppsInTossShareMessage({
        message: "hello",
        messageLines: ["world", " "],
        tossLink: "https://toss.example/share",
      }),
    ).toBe("hello\n\nworld\n\nhttps://toss.example/share");
    expect(
      extractAppsInTossSchemeValue("intoss://poll-maker/polls/poll%201", {
        pathPattern: /\/polls\/([^/?#]+)/,
      }),
    ).toBe("poll 1");
    expect(
      extractAppsInTossSchemeValue("intoss://poll-maker?pid=poll_abc", {
        queryKeys: ["pollId", "pid"],
      }),
    ).toBe("poll_abc");
  });

  test("creates share links, prewarms OG images, shares messages, and returns the link", async () => {
    const generatedLinks: Array<[string, string | undefined]> = [];
    const sharedMessages: string[] = [];
    const prewarmedUrls: string[] = [];
    const getTossShareLink: AppsInTossGetTossShareLink = async (
      url,
      ogImageUrl,
    ) => {
      generatedLinks.push([url, ogImageUrl]);
      return `https://toss.example/share?target=${encodeURIComponent(url)}`;
    };
    const share: AppsInTossShare = async ({ message }) => {
      sharedMessages.push(message);
    };
    const bridge = createAppsInTossShareBridge({
      fetcher: async (url) => {
        prewarmedUrls.push(url);
      },
      getSchemeUri: () => "intoss://my-app/from-scheme",
      getTossShareLink,
      share,
    });

    const { shareLink } = bridge;
    const tossLink = await shareLink({
      appName: "my-app",
      message: "play now",
      ogImageUrl: "https://example.com/og.png",
      path: "/rounds/current",
    });

    expect(generatedLinks).toEqual([
      ["intoss://my-app/rounds/current", "https://example.com/og.png"],
    ]);
    expect(prewarmedUrls).toEqual(["https://example.com/og.png"]);
    expect(tossLink).toBe(
      "https://toss.example/share?target=intoss%3A%2F%2Fmy-app%2Frounds%2Fcurrent",
    );
    expect(sharedMessages).toEqual([`play now\n\n${tossLink}`]);
    await expect(bridge.safeGetSchemeUri()).resolves.toBe(
      "intoss://my-app/from-scheme",
    );
  });
});
