/** Safe entry-channel values. Never send the launch URL or arbitrary query values. */
const ENTRY_REFERRERS = new Set([
  "gamehome", "search", "miniapphome", "store", "all_tab", "all_tab_recent",
  "all_tab_recent_all", "all_tab_reco_random", "all_tab_reco_organic",
  "all_tab_reco_inorganic", "airdrop", "gamehome_via_airdrop", "miniapphome_via_airdrop",
  "store_via_airdrop", "home_intelligence", "game_countdown", "gamehome_via_intelli",
  "miniapphome_via_intelli", "store_via_intelli", "tossads", "inbox", "push",
  "benefit_tab", "contacts_module", "external__owned_social", "external__partner_social",
  "external_ads", "external_link", "external_search", "external_share",
  "minihome_appsintoss", "shortcut", "toss_news", "tosspay_paybenefit", "etc", "test",
]);

export function normalizeEntryReferrer(value: unknown): string {
  return typeof value === "string" && ENTRY_REFERRERS.has(value) ? value : "unknown";
}

/** Parse only the outer referrer parameter, without depending on native URL getters. */
export function entryReferrerFromScheme(scheme: unknown): string {
  if (typeof scheme !== "string" || scheme.length > 16_384) return "unknown";
  const query = (scheme.split("#", 1)[0] ?? "").split("?").slice(1).join("?");
  const matches = query.split("&").filter((part) => part.startsWith("referrer="));
  const match = matches[0];
  if (matches.length !== 1 || !match) return "unknown";
  try {
    return normalizeEntryReferrer(decodeURIComponent(match.slice(9).replace(/\+/g, " ")));
  } catch {
    return "unknown";
  }
}

/** The app supplies actual viewport + foreground visibility, never mount state. */
export function createExposureTracker({
  onExposure,
  minimumVisibleMs = 1_000,
}: {
  onExposure: () => unknown;
  minimumVisibleMs?: number;
}) {
  if (!Number.isSafeInteger(minimumVisibleMs) || minimumVisibleMs < 0) {
    throw new TypeError("minimumVisibleMs must be a non-negative integer");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let emitted = false;
  function clear() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }
  return {
    setVisible(visible: boolean) {
      if (!visible) { clear(); return; }
      if (disposed || emitted || timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (disposed || emitted) return;
        emitted = true;
        void Promise.resolve().then(onExposure).catch(() => {});
      }, minimumVisibleMs);
    },
    dispose() { disposed = true; clear(); },
  };
}

export type NetworkAvailability = "online" | "offline" | "unknown";

export function normalizeNetworkAvailability(value: unknown): NetworkAvailability {
  if (value === "OFFLINE") return "offline";
  return ["WIFI", "2G", "3G", "4G", "5G", "WWAN"].includes(value as string)
    ? "online" : "unknown";
}

/** Caller supplies SDK probing and read-only refresh. No mutations are retried here. */
export function createForegroundRefreshController({
  getNetworkStatus,
  refresh,
  onStatus = () => {},
  now = Date.now,
  minimumIntervalMs = 15_000,
}: {
  getNetworkStatus: () => Promise<unknown>;
  refresh: () => Promise<unknown>;
  onStatus?: (state: { network: NetworkAvailability; refreshing: boolean; failed: boolean }) => void;
  now?: () => number;
  minimumIntervalMs?: number;
}) {
  if (!Number.isSafeInteger(minimumIntervalMs) || minimumIntervalMs < 0) {
    throw new TypeError("minimumIntervalMs must be a non-negative integer");
  }
  let active = false;
  let initialized = false;
  let disposed = false;
  let context: unknown;
  let revision = 0;
  let running = false;
  let queued: { refresh: boolean; force: boolean } | undefined;
  let lastRefreshAt = -Infinity;
  let network: NetworkAvailability = "unknown";
  function report(refreshing: boolean, failed: boolean) {
    try { onStatus({ network, refreshing, failed }); } catch { /* Optional UI observer. */ }
  }
  async function drain() {
    if (running) return;
    running = true;
    try {
      while (active && !disposed && queued) {
        const request = queued;
        queued = undefined;
        const startedRevision = revision;
        let status: unknown;
        try { status = await getNetworkStatus(); } catch { status = "UNKNOWN"; }
        if (disposed || !active || startedRevision !== revision) continue;
        const previousNetwork = network;
        network = normalizeNetworkAvailability(status);
        report(false, false);
        if (network === "offline" || !request.refresh) continue;
        if (!request.force && previousNetwork !== "offline" && now() - lastRefreshAt < minimumIntervalMs) continue;
        lastRefreshAt = now();
        report(true, false);
        let failed = false;
        try { await refresh(); } catch { failed = true; }
        if (!disposed && active && startedRevision === revision) report(false, failed);
      }
    } finally { running = false; }
  }
  return {
    setActive(next: boolean, contextKey?: unknown) {
      if (disposed || (next === active && Object.is(context, contextKey))) return;
      const changedContext = !Object.is(context, contextKey);
      context = contextKey;
      revision++;
      active = next;
      if (changedContext) lastRefreshAt = -Infinity;
      if (!active) { queued = undefined; return; }
      queued = { refresh: initialized, force: false };
      initialized = true;
      void drain();
    },
    retry() {
      if (disposed || !active) return;
      queued = { refresh: true, force: true };
      void drain();
    },
    dispose() { disposed = true; active = false; queued = undefined; revision++; },
  };
}
