# TrailBase Client Adapters

The `trailbase-client` package is not a replacement for the official TrailBase
SDK. It contains AppsInToss and React Native glue that repeats across consumer
apps.

Use the official `trailbase` JavaScript SDK for auth state, token refresh, and
Record API access. The kit only normalizes token payloads returned by
AppsInToss bootstrap endpoints and can convert them into the SDK's
`{ auth_token, refresh_token, csrf_token }` shape.

Use it when consumer apps are repeating request handling, TrailBase error
normalization, anonymous hash storage, or React Native SSE bridging. Keep
product-specific API methods in the app.

## Core Utilities

Shared client utilities include:

- base URL normalization
- JSON request and response parsing
- automatic JSON serialization for plain request bodies
- TrailBase error normalization
- anonymous hash resolution through a storage adapter
- TrailBase auth token normalization and `trailbase` SDK token option helpers
- SSE parsing
- XMLHttpRequest-backed stream helpers for React Native runtimes

Consumers should keep domain-specific client methods in their app packages. The
kit should only provide reusable transport and adapter pieces.

## TanStack DB

The TanStack DB adapter is intentionally thin. It helps build TrailBase Record
API collections with a React Native friendly SSE bridge, snapshot loading, and
reconnect hooks while leaving table names, query filters, and record models in
the consumer app.

XHR-backed SSE subscriptions support caller-provided headers for authenticated
Record APIs and surface HTTP failures as `TrailBaseHttpError` instead of silently
closing the stream.

`@tanstack/react-db`, `@tanstack/react-query`, and `trailbase` are peer
dependencies. The supported `trailbase` peer range starts at `0.12.1`, which is
the current SDK version verified for `client.login()`, `client.tokens()`, and
`client.headers()`. Consumers already using those packages can opt in to the
adapter without pulling them into apps that do not need them.

## TanStack Query

The TanStack Query subpath provides small defaults and option helpers. It avoids
wrapping application queries because query keys, stale times, and mutation
behavior should remain app-owned.

## Compatibility

Consumer apps can adopt the subpaths independently. Use the core utilities first
when an app only needs request/error/storage helpers, add the TanStack Query
helpers when shared query defaults become useful, and add the TanStack DB adapter
only after the app has repeated Record API snapshot and realtime collection code.

If an app already has a stable client layer, migrate one repeated concern at a
time. The expected result is less transport code, not a different application
data model.
