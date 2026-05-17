# @trailbase-apps-in-toss-kit/toss-mtls-client-proxy

## 0.1.3 — 2026-05-18

### Patch changes

- [91cd21b](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/91cd21b40d12fc12c0b65776eb9494079e011c72) Retry transient Apps in Toss IAP order-status responses and preserve the requested SKU when Toss omits it. — Thanks @imjlk!

## 0.1.2 — 2026-05-16

### Patch changes

- Auto-detect a single Toss Console mTLS certificate pair named `*_public.crt` and `*_private.key`
  from the mounted certificate directory before falling back to explicit path env vars.

## 0.1.1 — 2026-05-11

### Patch changes

- Harden the mTLS proxy runtime validation, request limits, upstream timeout handling, and operator
  documentation.
