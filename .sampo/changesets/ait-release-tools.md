---
npm/@trailbase-apps-in-toss-kit/release-tools: minor
---

Add build-time release helpers for RN consumer apps: discover every package in the app's Sampo fixed group, verify stable lockstep versions, synchronize only local Cargo package versions, and generate deduplicated release notes. Validate the packaged AIT bytes, production settings, supported runtime/platform bundles, source commit and tag before uploading an explicit artifact with redacted CLI failures. Consumers retain their app settings, SDK runtime policy, secrets and workflow triggers; these tools do not publish private packages or deploy TrailBase.
