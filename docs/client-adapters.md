# TrailBase Client Adapters

The `trailbase-client` package is not a replacement for the official TrailBase
SDK. It contains AppsInToss and React Native glue that repeats across consumer
apps.

## Core Utilities

Shared client utilities include:

- base URL normalization
- JSON request and response parsing
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

`@tanstack/react-db`, `@tanstack/react-query`, and `trailbase` are peer
dependencies. Consumers already using those packages can opt in to the adapter
without pulling them into apps that do not need them.

## React Query

The React Query subpath provides small defaults and option helpers. It avoids
wrapping application queries because query keys, stale times, and mutation
behavior should remain app-owned.

## Compatibility

The first version follows the patterns already used by `zero-three-three`.
`light-on-off` does not currently use TanStack DB, and `tatatata-cattower` has
the dependency but no live adapter code yet, so those consumers should only use
the runtime helpers until they have repeated client code to migrate.
