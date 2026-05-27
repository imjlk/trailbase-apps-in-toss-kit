# Sampo Release Notes

Sampo changesets are the source material for this kit's package changelogs and
operator-facing release notes. Write each changeset as if it may be read by a
consumer app maintainer, not only by the package author.

## When to Add a Changeset

Add a changeset when a PR changes behavior that downstream services may notice:

- Rust WASM helper APIs, auth flow helpers, DB helper behavior, or SQL templates.
- TypeScript client/runtime APIs or startup behavior.
- mTLS proxy request/response behavior, environment variables, retry policy, or
  image runtime assumptions.
- Deployment, migration, security, compatibility, or operational guidance.

Skip changesets for purely internal docs, comments, tests, or CI-only changes
that do not change a released package or operator workflow.

## Writing Good Release Note Text

Use the body of the changeset as release-note draft text.

- Lead with the user-visible outcome.
- Mention required migrations, env vars, secrets, image tags, smoke tests, or
  rollback notes when operators need them.
- Keep implementation detail only when it explains a compatibility risk.
- Do not claim consumer compatibility until the relevant consumer smoke tests
  have passed.
- Do not include raw secrets, Toss identifiers, real logs, certificate data, or
  production-only URLs.

Example:

```md
---
cargo/trailbase-guest-common: minor
npm/@trailbase-apps-in-toss-kit/toss-mtls-client-proxy: patch
---

Add shared promotion reward validation helpers and proxy retry controls. Apps
that copied the promotion SQL template should reconcile the new index before
raising their supported kit version.
```

## Draft Release Notes Locally

Generate a Markdown draft from pending `.sampo/changesets/*.md` files:

```bash
bun run sampo:release-notes:draft
```

Write the draft to a file when preparing a PR, GitHub Release body, or internal
handoff note:

```bash
bun run sampo:release-notes:draft -- --output RELEASE_NOTES_DRAFT.md
```

The draft contains a one-entry-per-changeset highlights section, package impact
sections, source changeset paths, and a short review checklist. It is a writing
aid; `sampo release` remains the source of truth for package version bumps and
package changelog updates.

## Use From a Consumer Repository

Consumer apps can reuse the draft script through the kit submodule:

```bash
node vendor/trailbase-apps-in-toss-kit/scripts/draft-sampo-release-notes.mjs --root .
```

If the consumer stores changesets somewhere other than `.sampo/changesets`, pass
the directory explicitly:

```bash
node vendor/trailbase-apps-in-toss-kit/scripts/draft-sampo-release-notes.mjs \
  --root . \
  --changesets .sampo/changesets \
  --output RELEASE_NOTES_DRAFT.md
```

Use consumer changesets for consumer-visible app behavior. A kit submodule
pointer update does not need a consumer changeset by itself unless it changes
the consumer's runtime behavior, copied templates, deployment steps, or user
experience.

## Release Flow

1. Add or review pending changesets with `sampo add`.
2. Run `bun run sampo:release-notes:draft` and edit the draft for the intended
   audience.
3. Move polished text into the PR summary, release issue, GitHub Release body,
   or internal rollout note.
4. Run `sampo release` only when preparing the actual package version/changelog
   release commit.
5. After release, verify generated changelogs and package versions before
   publishing or relying on image release automation.

## Agent Guidance

No new repo-specific agent skill is required for normal release-note drafting.
Use the general `$sampo` skill for Sampo changeset, release, publish, or bot
work. Load `trailbase-ops` only when the release note touches TrailBase
migrations, Record API exposure, WASM auth behavior, deployment, production
reset, or mTLS certificate handling.
