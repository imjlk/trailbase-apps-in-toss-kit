import { describe, expect, test } from "bun:test";
import {
  createAppsInTossShoppingBridge,
  normalizeAppsInTossShoppingLink,
} from "../src/shopping";

describe("operator-configured shopping links", () => {
  test("preserves the issued URL including encoded affiliate parameters", () => {
    const link = "https://toss.shopping/t/example?k=example%2Bcode&referrer=affiliate";
    expect(normalizeAppsInTossShoppingLink(` ${link} `)).toBe(link);
    expect(normalizeAppsInTossShoppingLink("https://toss.im/_m/example"))
      .toBe("https://toss.im/_m/example");
  });

  test("rejects unsafe or unsupported destinations", () => {
    for (const link of [
      undefined, null, {}, "", "TODO_LINK", "http://toss.shopping/t/x",
      "https://toss.shopping.evil.test/t/x", "https://evil.test/toss.shopping",
      "https://user:secret@toss.shopping/t/x", "https://evil.test@toss.im/_m/x",
      "https://toss.im:8080/_m/x", "https://toss.im:443/_m/x", "https://toss.im./_m/x",
      "https://toss.im%2eevil.test/_m/x", "https://toss.im@evil.test/_m/x",
      "https://toss.im\\@evil.test", "https://toss.im/\nx", "https:toss.im/x",
      "javascript:alert(1)", "intoss://shopping", `https://toss.im/${"x".repeat(4096)}`,
    ]) expect(normalizeAppsInTossShoppingLink(link)).toBeNull();
  });

  test("does not require the browser URL API or parse query text as authority", () => {
    const original = globalThis.URL;
    try {
      globalThis.URL = class {
        get protocol(): string { throw new Error("URL.protocol is not implemented"); }
      } as unknown as typeof URL;
      const link = "https://toss.im/_m/example?note=user@host:123#section";
      expect(normalizeAppsInTossShoppingLink(link)).toBe(link);
      expect(normalizeAppsInTossShoppingLink("HTTPS://TOSS.SHOPPING/t/example"))
        .toBe("HTTPS://TOSS.SHOPPING/t/example");
    } finally {
      globalThis.URL = original;
    }
  });

  test("does not open anything without a valid link", async () => {
    let calls = 0;
    const bridge = createAppsInTossShoppingBridge({ openURL: async () => { calls++; } });
    expect(await bridge.open("")).toEqual({ status: "unavailable" });
    expect(await bridge.open("https://evil.test")).toEqual({ status: "unavailable" });
    expect(calls).toBe(0);
  });

  test("suppresses concurrent taps but allows a new gesture after settlement", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const opened: string[] = [];
    const bridge = createAppsInTossShoppingBridge({ openURL: async (url) => {
      opened.push(url);
      await pending;
    } });
    const first = bridge.open("https://toss.im/_m/example");
    expect(await bridge.open("https://toss.shopping/t/example"))
      .toEqual({ status: "busy" });
    expect(opened).toEqual(["https://toss.im/_m/example"]);
    release();
    expect(await first).toEqual({ status: "dispatched" });
    expect(await bridge.open("https://toss.shopping/t/example"))
      .toEqual({ status: "dispatched" });
    expect(opened.length).toBe(2);
  });

  test("sanitizes synchronous/native failures and releases the tap guard", async () => {
    let calls = 0;
    const bridge = createAppsInTossShoppingBridge({ openURL: () => {
      if (++calls === 1) throw new Error("native failure containing sensitive URL");
      return Promise.resolve();
    } });
    expect(await bridge.open("https://toss.im/_m/example"))
      .toEqual({ status: "failed" });
    expect(await bridge.open("https://toss.im/_m/example"))
      .toEqual({ status: "dispatched" });
  });
});
