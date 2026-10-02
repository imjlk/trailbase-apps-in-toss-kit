/** Only accepts operator-provided Toss Shopping/share HTTPS links.
 * This validates the destination, not affiliate enrollment or attribution.
 */
export function normalizeAppsInTossShoppingLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const link = value.trim();
  if (!link || link.length > 4096 || /[\s\\\u0000-\u001f\u007f]/u.test(link)) {
    return null;
  }
  // A literal HTTPS authority plus a URL delimiter leaves no room for userinfo,
  // ports, encoded hosts or suffix lookalikes. Do not rely on native URL getters:
  // some supported RN runtimes have incomplete/non-WHATWG implementations.
  if (!/^https:\/\/(?:toss\.shopping|toss\.im)(?:[/?#]|$)/i.test(link)) return null;
  // Do not reconstruct the URL: affiliate query encoding and order may matter.
  return link;
}

export type AppsInTossShoppingOpenResult =
  | { status: "dispatched" }
  | { status: "unavailable" }
  | { status: "busy" }
  | { status: "failed" };

export type AppsInTossShoppingOffer = {
  provider: "toss-shopping";
  productId: string;
  title: string;
  url: string | null;
  preview: boolean;
  source: "category-best" | "today-deals" | "overall-best";
  reason: "related" | "default-category" | "overall-best";
  expiresAt: number;
};

/** Parse a server offer without broadening the URL allowlist. Preview offers may
 * only be enabled explicitly by a development consumer; they have no open URL. */
export function normalizeAppsInTossShoppingOffer(value: unknown, {
  now = Date.now(), allowPreview = false,
}: { now?: number; allowPreview?: boolean } = {}): AppsInTossShoppingOffer | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const preview = item.preview === true;
  const url = normalizeAppsInTossShoppingLink(item.url);
  if (item.provider !== "toss-shopping" || typeof item.productId !== "string" ||
    !/^[a-zA-Z0-9_-]{1,80}$/.test(item.productId) || typeof item.title !== "string" ||
    !item.title.trim() || item.title.length > 180 || /[\u0000-\u001f\u007f]/u.test(item.title) ||
    !["category-best", "today-deals", "overall-best"].includes(String(item.source)) ||
    !["related", "default-category", "overall-best"].includes(String(item.reason)) ||
    typeof item.expiresAt !== "number" || !Number.isFinite(item.expiresAt) || item.expiresAt <= now ||
    (preview ? !allowPreview || item.url !== null : !url)) return null;
  return { provider: "toss-shopping", productId: item.productId, title: item.title,
    url: preview ? null : url, preview,
    source: item.source as AppsInTossShoppingOffer["source"],
    reason: item.reason as AppsInTossShoppingOffer["reason"], expiresAt: item.expiresAt };
}

/** Share one bridge per app to suppress concurrent opens across placements.
 * Invoke open only from an explicit user gesture. A dispatched URL is not a
 * confirmed landing, purchase, conversion, or reward entitlement.
 */
export function createAppsInTossShoppingBridge({
  openURL,
}: {
  openURL: (url: string) => Promise<unknown>;
}) {
  let opening = false;
  return {
    async open(value: unknown): Promise<AppsInTossShoppingOpenResult> {
      const link = normalizeAppsInTossShoppingLink(value);
      if (!link) return { status: "unavailable" };
      if (opening) return { status: "busy" };
      opening = true;
      try {
        await openURL(link);
        return { status: "dispatched" };
      } catch {
        // Never expose native errors that may contain the full affiliate URL.
        return { status: "failed" };
      } finally {
        opening = false;
      }
    },
  };
}
