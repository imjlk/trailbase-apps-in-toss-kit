import packageJson from "../package.json" with { type: "json" };

// Route/adapter contracts implemented by this binary, not upstream readiness.
export const PROXY_CAPABILITIES = Object.freeze([
  "mtls.request",
  "toss-login.complete",
  "toss-login.remove",
  "anonymous-key.verify",
  "iap.order-status",
  "iap.provider-sku-required",
  "promotion.grant",
  "promotion.status",
  "promotion.anonymous-recipient",
  "smart-message.send",
  "smart-message.bulk-send",
  "smart-message.channel-results",
]);

export function proxyCapabilityMetadata() {
  return { contractVersion: 1, proxyVersion: packageJson.version, capabilities: [...PROXY_CAPABILITIES] };
}
