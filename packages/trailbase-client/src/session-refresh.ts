import { joinTrailBaseUrl, normalizeTrailBaseAuthTokens, requestJson, type TrailBaseAuthTokens } from "./index";

/** Official TrailBase refresh endpoint. Does not authenticate using a password. */
export function createTrailBaseTokenRefresher({
  baseUrl, fetchImpl = globalThis.fetch,
}: { baseUrl: string; fetchImpl?: typeof fetch }) {
  const url = joinTrailBaseUrl(baseUrl, "/api/auth/v1/refresh");
  return async (tokens: TrailBaseAuthTokens, { signal }: { signal: AbortSignal }): Promise<TrailBaseAuthTokens> => {
    if (!tokens.refreshToken) throw new Error("No refresh token available");
    const response = await requestJson<unknown>(url, {
      fetchImpl, signal, method: "POST", body: { refresh_token: tokens.refreshToken },
    });
    const next = normalizeTrailBaseAuthTokens(response);
    if (!next) throw new Error("Invalid TrailBase refresh response");
    // TrailBase normally returns only a new access/CSRF token; support rotation too.
    return { ...next, refreshToken: next.refreshToken ?? tokens.refreshToken };
  };
}

/** Scheduling hint only; signature/authorization validation always remains server-side. */
export function trailBaseTokenExpiresAt(token: string | null | undefined): number | null {
  const payload = token?.split(".")[1];
  if (!payload) return null;
  try {
    // Hermes environments do not always provide atob/Buffer.
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let buffer = 0, bits = 0, encoded = "";
    for (const char of payload.replace(/-/g, "+").replace(/_/g, "/")) {
      if (char === "=") break;
      const index = alphabet.indexOf(char);
      if (index < 0) return null;
      buffer = (buffer << 6) | index;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        encoded += `%${((buffer >> bits) & 255).toString(16).padStart(2, "0")}`;
      }
    }
    const { exp } = JSON.parse(decodeURIComponent(encoded));
    if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
    return exp > 1e12 ? exp : exp * 1000;
  } catch { return null; }
}
