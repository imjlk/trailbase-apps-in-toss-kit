import packageJson from "../package.json" with { type: "json" };

// Route/adapter contracts implemented by this binary, not upstream readiness.
// The promotion capabilities carry the persisted three-step contract version
// (recipient-bound prepare, key-required execute, status-only result lookup;
// the batch grant route is removed) — the `.v2` suffix keeps the changed
// contract from presenting as the pre-0.6 names.
export const PROXY_CAPABILITIES = Object.freeze([
  "mtls.request",
  "toss-login.complete",
  "toss-login.remove",
  "anonymous-key.verify",
  "iap.order-status",
  "iap.provider-sku-required",
  "promotion.prepare.v2",
  "promotion.execute.v2",
  "promotion.status.v2",
  "promotion.anonymous-recipient",
  "smart-message.send",
  "smart-message.bulk-send",
  "smart-message.channel-results",
]);

export function proxyCapabilityMetadata() {
  return { contractVersion: 1, proxyVersion: packageJson.version, capabilities: [...PROXY_CAPABILITIES] };
}
