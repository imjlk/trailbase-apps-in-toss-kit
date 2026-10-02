/** Only accepts operator-provided Toss Shopping/share HTTPS links.
 * This validates the destination, not affiliate enrollment or attribution.
 */
export function normalizeAppsInTossShoppingLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const link = value.trim();
  if (!link || link.length > 4096 || /[\s\\\u0000-\u001f\u007f]/u.test(link)) {
    return null;
  }
  try {
    const url = new URL(link);
    if (
      url.protocol !== "https:" ||
      !/^https:\/\//i.test(link) ||
      !["toss.shopping", "toss.im"].includes(url.hostname) ||
      url.username || url.password || url.port
    ) return null;
    // Do not reconstruct the URL: affiliate query encoding and order may matter.
    return link;
  } catch {
    return null;
  }
}

export type AppsInTossShoppingOpenResult =
  | { status: "dispatched" }
  | { status: "unavailable" }
  | { status: "busy" }
  | { status: "failed" };

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
