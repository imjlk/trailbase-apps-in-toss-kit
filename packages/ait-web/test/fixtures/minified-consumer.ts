import { createAppsInTossWebAdapter } from "../../src/index";

// Explicit synthetic issuer for the browser build regression. All other SDK
// namespaces come from the installed official WebView SDK; no native call runs.
export function createConsumer(scenario = "success") {
  const calls = { loads: 0, codes: 0, hashes: 0 };
  const adapter = createAppsInTossWebAdapter({
    appKey: "minified-consumer",
    loadSdk: async () => {
      calls.loads++;
      if (scenario === "load-failure") throw new Error("fixture-private-loader-error");
      // Keep User separate before spreading the remaining namespace: Bun 1.4.2
      // can lose a binding reused by outer and nested spreads after await.
      const { User, ...sdk } = await import("@apps-in-toss/web-framework");
      return {
        ...sdk,
        User: {
          ...User,
          getAnonymousKey: Object.assign(async () => { calls.hashes++; return { type: "HASH" as const, hash: "fixture-hash" }; },
            User.getAnonymousKey, { isSupported: () => true }),
          createAnonymousKeyAuthCode: Object.assign(async () => {
            calls.codes++;
            if (scenario === "issue-failure") throw new Error("fixture-private-provider-error");
            return { code: `fixture-code-${calls.codes}`, expiresIn: scenario === "invalid-result" ? 0 : 300 };
          }, { isSupported: () => scenario !== "unsupported" }),
        },
      };
    },
  });
  return { adapter, calls };
}
