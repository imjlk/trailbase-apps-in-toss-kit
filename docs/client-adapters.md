# TrailBase Client Adapters

The `trailbase-client` package is not a replacement for the official TrailBase
SDK. It contains AppsInToss and React Native glue that repeats across consumer
apps.

## Core Utilities

Shared client utilities include:

- base URL normalization
- JSON request and response parsing
- automatic JSON serialization for plain request bodies
- TrailBase error normalization
- anonymous hash resolution through a storage adapter
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
dependencies. Consumers already using those packages can opt in to the adapter
without pulling them into apps that do not need them.

## TanStack Query

The TanStack Query subpath provides small defaults and option helpers. It avoids
wrapping application queries because query keys, stale times, and mutation
behavior should remain app-owned.

## Compatibility

Consumer apps can adopt the subpaths independently. Use the core utilities first
when an app only needs request/error/storage helpers, add the TanStack Query
helpers when shared query defaults become useful, and add the TanStack DB adapter
only after the app has repeated Record API snapshot and realtime collection code.
