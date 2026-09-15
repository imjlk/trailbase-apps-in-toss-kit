import { TOSS_ENDPOINTS, clientError } from "@ait-kit/api-core";

export const ANONYMOUS_KEY_VERIFY_PATH = "/internal/apps-in-toss/anonymous-key/verify";
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
