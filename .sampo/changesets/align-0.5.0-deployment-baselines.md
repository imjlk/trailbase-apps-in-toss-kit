---
npm/@trailbase-apps-in-toss-kit/toss-mtls-client-proxy: patch
---

Align deployment baselines with the released 0.5.0 image.

- The copy-in Compose template now pins
  `toss-mtls-client-proxy:0.5.0` (was 0.2.0) and its comment describes the
  actual baseline — @ait-kit api-core/api-client 0.4.2 contracts, message
  UNKNOWN outcomes, three-step promotion rewards — instead of the stale
  "API Core 0.2" note. Consumers reconcile their copied Compose file with
  this pin; consumers on older images keep working, but the UNKNOWN outcome
  quarantine in the Rust ledger requires the 0.11.0 guest crates.
- New bilingual rollout and verification record
  (`docs/en/ait-kit-rollout.md`, `docs/ko/ait-kit-rollout.md`): version
  matrix (proxy 0.5.0 image digest, api 0.4.2 pins, SDK 0.3.0, RN minimum
  2.10.10, crates 0.11.0), rollout order (proxy → WASM guests → capability
  check → client apps), rollback cautions, the 2026-09-17 verification
  record, and the consumer-owned real-device checks that remain. No schema
  migrations ship in this cycle.
