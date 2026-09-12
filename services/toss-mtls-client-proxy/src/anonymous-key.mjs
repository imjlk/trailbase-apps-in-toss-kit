import { clientError } from "@ait-kit/api-core";

export const ANONYMOUS_KEY_VERIFY_PATH = "/internal/apps-in-toss/anonymous-key/verify";
export const TOSS_ANONYMOUS_KEY_VERIFY_PATH = "/api-partner/v1/apps-in-toss/users/anon-key/verify";

export function requireAnonymousKey(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 4096 || /[\r\n\x00]/.test(value)) {
    throw clientError("INVALID_ANONYMOUS_KEY", "anonKey must be a non-empty header value");
  }
  return value.trim();
}

export async function verifyAnonymousKey(body, core, mode) {
  const anonKey = requireAnonymousKey(body?.anonKey);
  if (mode === "stub") return { ok: true, valid: true, resultType: "SUCCESS", mode: "stub" };
  const result = await core.genericMtlsRequest({
    method: "POST", path: TOSS_ANONYMOUS_KEY_VERIFY_PATH, headers: { "x-anon-key": anonKey },
  });
  if (result.status >= 200 && result.status < 300 && result.body?.resultType === "SUCCESS"
      && typeof result.body.success === "boolean") {
    return { ok: true, valid: result.body.success, resultType: "SUCCESS", mode: "forward" };
  }
  // Never relay provider error text: it may echo the supplied identifier.
  return { ok: false, valid: false, error: "ANONYMOUS_KEY_VERIFICATION_FAILED", mode: "forward" };
}
