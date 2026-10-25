import { TOSS_ENDPOINTS, clientError } from "@ait-kit/api-core";
import { PROXY_ENDPOINTS } from "@ait-kit/api-client";

export const ANONYMOUS_KEY_VERIFY_PATH = "/internal/apps-in-toss/anonymous-key/verify";
// Alias for @ait-kit/api-client's anonKeyVerify spelling; same handler as ANONYMOUS_KEY_VERIFY_PATH.
export const ANONYMOUS_KEY_VERIFY_ALIAS_PATH = PROXY_ENDPOINTS.anonKeyVerify;
export const ANONYMOUS_AUTH_CODE_EXCHANGE_PATH = "/internal/apps-in-toss/anonymous-key/exchange";
export const TOSS_ANONYMOUS_KEY_VERIFY_PATH = TOSS_ENDPOINTS.anonKeyVerify;

export function requireAnonymousKey(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 4096 || /[\r\n\x00]/.test(value)) {
    throw clientError("INVALID_ANONYMOUS_KEY", "anonKey must be a non-empty header value");
  }
  return value.trim();
}

// Thin compatibility layer over api-core's verifyAnonKey: preserves the
// proxy's public response shape ({ok, valid, resultType, mode}) and never
// relays provider error text (it may echo the supplied identifier).
export async function verifyAnonymousKey(body, core, mode) {
  const anonKey = requireAnonymousKey(body?.anonKey);
  const result = await core.verifyAnonKey({ anonKey });
  if (result.ok) {
    return { ok: true, valid: result.valid, resultType: "SUCCESS", mode };
  }
  // Provider failures (transport, FAIL envelopes, malformed payloads) stay
  // opaque: "no verdict" is never "invalid", and reasons stay internal.
  return { ok: false, valid: false, error: "ANONYMOUS_KEY_VERIFICATION_FAILED", mode };
}

// Code exchange authenticates the caller; the old verify route only checks key validity.
export async function exchangeAnonymousAuthCode(body, core, mode) {
  const code = body?.code;
  if (typeof code !== "string" || !code.trim() || code.length > 4096 || /[\x00-\x1f\x7f]/.test(code)) {
    return { ok: false, error: "INVALID_AUTH_CODE", mode };
  }
  if (mode !== "forward") return { ok: false, error: "FORWARD_MODE_REQUIRED", mode };
  const result = await core.exchangeAnonAuthCode({ code });
  if (result.ok) {
    const key = result.anonKey;
    if (typeof key !== "string" || !key || key.trim() !== key || key.length > 4096 || /[\x00-\x1f\x7f]/.test(key)) {
      return { ok: false, error: "INVALID_RESPONSE", mode };
    }
    // Raw identity is returned only over the authenticated private backend boundary.
    return { ok: true, anonKey: key, mode };
  }
  const allowed = ["ABORTED", "INVALID_AUTH_CODE", "FORWARD_MODE_REQUIRED", "UPSTREAM_UNAVAILABLE", "EXCHANGE_REJECTED", "INVALID_RESPONSE"];
  return { ok: false, error: allowed.includes(result.error) ? result.error : "INVALID_RESPONSE", mode };
}
