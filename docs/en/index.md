# Documentation

This documentation is for people integrating or maintaining the kit in an
AppsInToss service. It explains what the kit provides, what the consuming app
still owns, and which checks to run before shipping changes.

TrailBase is the backend runtime assumed by most of this kit. A consumer app
uses TrailBase for its SQLite data store, Record API, Rust WASM handlers, jobs,
and runtime directory (`traildepot`). The kit provides shared pieces around that runtime so
multiple AppsInToss services do not each reimplement the same glue.

The Toss mTLS proxy is the main exception: it is reusable by non-TrailBase
backends too, as long as they can call it over a private network.

If you are an AI coding agent, read `AGENTS.md` first and load the
`trailbase-ops` skill for TrailBase migration, deployment, or mTLS work.

## Start Here

| Goal | Read |
| --- | --- |
| Add the kit to an existing service | [consumer-migration.md](consumer-migration.md) |
| Understand container startup helpers | [trailbase-runtime.md](trailbase-runtime.md) |
| Run the Toss mTLS proxy safely | [toss-mtls-client-proxy.md](toss-mtls-client-proxy.md) |
| Validate production env files | [production-env-validation.md](production-env-validation.md) |
| Design SQL migrations and Record API access | [schema-patterns.md](schema-patterns.md) |
| Link anonymous users to Toss Login | [toss-identity.md](toss-identity.md) |
| Model Toss promotion reward campaigns | [promotion-campaigns.md](promotion-campaigns.md) |
| Use RN/client-side adapters | [client-adapters.md](client-adapters.md) |
| Release versions and GHCR images | [versioning.md](versioning.md) and [publishing.md](publishing.md) |
| Draft release notes from Sampo changesets | [sampo-release-notes.md](sampo-release-notes.md) |
| Track TrailBase upstream compatibility | [trailbase-tracking.md](trailbase-tracking.md) |
| Track Apps in Toss SDK/API docs | [apps-in-toss-tracking.md](apps-in-toss-tracking.md) |
| Install or contribute agent skills | [agent-skills.md](agent-skills.md) |

## Mental Model

The kit is a shared toolbox, not a hosted platform. Consumer apps usually use it
in three ways:

1. Source-consume Rust and TypeScript helpers through a git submodule.
2. Copy SQL, Compose, env, and smoke templates into the app repo before editing.
3. Run the shared mTLS proxy container as a private internal service.

Copied files are app-owned after they leave `templates/`. Updating the submodule
does not update migrations, Compose files, or production env files that were
copied into a consumer app.

## External References

These links are useful when you need the upstream behavior rather than this
kit's integration opinion:

- TrailBase: [home](https://trailbase.io/),
  [Record APIs](https://trailbase.io/documentation/apis_record/),
  [migrations](https://trailbase.io/documentation/migrations/),
  [production](https://trailbase.io/documentation/production/).
- AppsInToss: [Developer Center](https://developers-apps-in-toss.toss.im/).
- Deployment/runtime: [Coolify Docker Compose](https://coolify.io/docs/knowledge-base/docker/compose),
  [Bun](https://bun.com/docs).
- Client adapters: [TanStack DB](https://tanstack.com/db/latest/docs),
  [TanStack Query](https://tanstack.com/query/latest/docs/framework/react/overview).

## Language

English docs live in `docs/en/`. Korean translations with the same filenames
live in `docs/ko/`.
