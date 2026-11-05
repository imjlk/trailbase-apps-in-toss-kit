export type AppsInTossBridgeCleanup = (() => void) | void;

export function createCleanupOnce(cleanup?: AppsInTossBridgeCleanup) {
  let called = false;
  return () => {
    if (called || typeof cleanup !== "function") {
      return;
    }
    called = true;
    cleanup();
  };
}

export function withBridgeTimeout({
  onTimeout,
  timeoutMs,
}: {
  onTimeout: () => void;
  timeoutMs: number;
}) {
  const timeout = setTimeout(onTimeout, timeoutMs);
  return () => clearTimeout(timeout);
}

export function isAppsInTossBridgeSupported(
  bridgeFunction?: { isSupported?: () => boolean } | null,
) {
  if (!bridgeFunction?.isSupported) {
    return true;
  }
  try {
    return bridgeFunction.isSupported();
  } catch {
    return false;
  }
}
