---
"npm/@trailbase-apps-in-toss-kit/toss-mtls-client-proxy": patch
"cargo/trailbase-guest-common": patch
---

Normalize AppsInToss smart-message responses around official `resultType`, delivery counts, detail,
failure, and reach-failure fields, and add shared functional-message helpers plus SQL/docs templates
for template registry, SDK notification agreement tracking, and reusable outbox provider summaries.
The message `templateSetCode` and notification agreement SDK `templateCode` are stored separately so
consumer apps can gate user-requested functional alerts before dispatching through the proxy.
