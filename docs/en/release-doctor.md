# Release Doctor

The release doctor is a small orchestration helper for preQA and release
checklists. It lets a service run shared TrailBase safety checks and app-owned
commands through one normalized result format.

Use it for checks that should run before a release candidate, production deploy,
or smoke-test handoff. Keep product-specific policy in the consuming service;
the kit only provides reusable check plumbing and common TrailBase checks.

## CLI

Run a single production env check:

```bash
node vendor/trailbase-apps-in-toss-kit/packages/trailbase-runtime/bin/release-doctor.mjs \
  --env-file apps/trailbase/.env.production \
  --app-env-key APP_ENV
```

Run a JSON config:

```bash
node vendor/trailbase-apps-in-toss-kit/packages/trailbase-runtime/bin/release-doctor.mjs \
  --config apps/trailbase/release-doctor.json
```

Add `--json` when CI should consume the normalized result.

## Config Shape

Copy the template when a service wants a starting point that combines production
env validation, copied-template drift, and release-note reminders:

```bash
cp vendor/trailbase-apps-in-toss-kit/templates/trailbase/release/release-doctor.config.example.json \
  apps/trailbase/release-doctor.json
cp vendor/trailbase-apps-in-toss-kit/templates/trailbase/release/kit-template-map.example.json \
  apps/trailbase/kit-template-map.json
```

The template assumes the copied file lives at `apps/trailbase/release-doctor.json`
and sets `"root": "../.."` so command checks run from the repository root.
Adjust paths, app-specific env keys, and the copied `kit-template-map.json`
before using it in CI or a release checklist. If the service is not ready to
maintain an explicit mapping file, remove the `--mapping` argument pair to use
automatic candidate discovery.

```json
{
  "root": "../..",
  "checks": [
    {
      "type": "production-env",
      "name": "Production env",
      "file": "apps/trailbase/.env.production",
      "appEnvKey": "APP_ENV",
      "optionalHttps": ["APP_BASE_URL", "TRAILBASE_PUBLIC_URL"]
    },
    {
      "type": "command",
      "name": "Template drift",
      "command": "bun",
      "captureOutput": "failure",
      "timeout": 300000,
      "required": false,
      "args": [
        "vendor/trailbase-apps-in-toss-kit/scripts/compare-consumer-templates.mjs",
        ".",
        "--mapping",
        "apps/trailbase/kit-template-map.json",
        "--strict",
        "--summary"
      ]
    },
    {
      "type": "changeset",
      "name": "Pending Sampo changeset",
      "required": false
    }
  ]
}
```

Relative paths are resolved from the config file's directory. Add `root` when a
config file lives below the repository root but commands should run from the
repository root.

Supported check types are:

- `production-env`: runs the shared production env validator.
- `command`: runs an app-owned command and treats exit code `0` as success by default. Command output is captured only on failure unless `captureOutput` is set to `always` or `none`; `timeout` defaults to 300,000 ms.
- `changeset`: checks for pending `.sampo/changesets/*.md` files.
- `owned-currency-close-manifest`: validates a close manifest against the exact report bytes, including the report hash, period, timestamp unit, source/tool metadata, policy versions, and ordered close records.

Set `"required": false` to report a failed check as a warning instead of failing
the whole doctor run. The template keeps template drift and changeset checks as
warnings by default because those policies often become strict only after a
service has reconciled its copied files and release process.

The close-manifest check takes report and manifest paths from the Release Doctor
configuration. It does not store those paths in the manifest and it never writes
to the database. Add it during adoption with `required: false`, then make it
required after the consumer has an operator-owned approval workflow:

```json
{
  "type": "owned-currency-close-manifest",
  "name": "Owned currency close evidence",
  "manifest": "apps/trailbase/reports/2026-09.manifest.json",
  "report": "apps/trailbase/reports/2026-09.json",
  "required": false
}
```

## JavaScript Helpers

Consumer scripts can import the same helpers when they need custom rules:

```js
import {
  createCommandCheck,
  createProductionEnvCheck,
  runReleaseDoctor,
} from "@trailbase-apps-in-toss-kit/trailbase-runtime/release-doctor";

const summary = await runReleaseDoctor({
  checks: [
    createProductionEnvCheck({
      file: "apps/trailbase/.env.production",
      appEnvKey: "APP_ENV",
    }),
    createCommandCheck({
      name: "Smoke",
      command: "bun",
      args: ["run", "smoke"],
    }),
  ],
});

process.exit(summary.ok ? 0 : 1);
```

Do not put secrets in command arguments or output. The doctor keeps command
output short for failure context by default, but app-owned commands should
still avoid printing tokens, certificates, raw Toss identifiers, HMACs, or
sealed values.

For private IAP, promotion and message inquiries, use the [read-only Ledger Doctor](ledger-doctor.md).

## Proxy Capability Preflight

Use `createProxyCapabilitiesCheck` from `trailbase-runtime/release-doctor` or
`trailbase-runtime/proxy-capabilities` to verify the internal proxy before enabling
a new adapter flow. JSON configuration supports the same check:

```json
{
  "type": "proxy-capabilities",
  "name": "Required proxy adapters",
  "urlEnv": "MTLS_PROXY_URL",
  "tokenEnv": "MTLS_PROXY_TOKEN",
  "expectedMode": "forward",
  "requiredCapabilities": [
    "anonymous-key.verify",
    "promotion.prepare.v2",
    "promotion.execute.v2",
    "promotion.status.v2",
    "promotion.anonymous-recipient"
  ],
  "timeout": 5000
}
```

Provide the token in the process environment; config accepts its variable name,
never an inline token or custom fetch function. The URL must be an HTTP(S) origin
with no credentials, path, query or fragment. The check sends only an authenticated
GET to `/internal/apps-in-toss/health`, rejects redirects, bounds the entire request
including response-body reads, and limits the response to 16 KiB. Error reports omit
the token, URL, response body and transport error details.

`minimumVersion` optionally requires a minimum SemVer proxy version. Prerelease
precedence is respected (`0.3.0-rc.1` is below `0.3.0`); build metadata does not
change precedence. Without a minimum, valid prerelease metadata is accepted.
Feature names are checked independently of the version. Invalid/missing metadata,
unknown contract versions, a different mode or missing required capabilities fail
the check. Proxy 0.2.0 and earlier do not expose this new metadata. Publish and select
an image containing capability support before making this check mandatory. During
a staged adoption, an explicit `"required": false` reports failures as warnings.

Capabilities identify adapter contracts implemented by the running binary. They do
not establish upstream availability, certificate validity, campaign configuration,
notification agreement, payment evidence or user eligibility. Keep those checks in
the existing application and integration flows. This preflight never grants, sends
or invokes an upstream API.

The Node CLI remains self-contained when run from a git submodule; no npm install is required. Minimum versions use strict SemVer precedence (including prereleases and ignoring build metadata), limited to 128 characters and safe integer core components.

## Promotion Rollout Preflight

For anonymous reward flows, copy
`templates/trailbase/release/promotion-release-doctor.config.example.json` into
your deployment configuration and run it from a host on the private proxy network:

```sh
node vendor/trailbase-apps-in-toss-kit/packages/trailbase-runtime/bin/release-doctor.mjs --config path/to/promotion-release-doctor.config.json
```

Provide `MTLS_PROXY_URL` and `MTLS_PROXY_TOKEN` through the process environment.
The required health-only check verifies forward mode, anonymous-key verification,
anonymous promotion recipients, and **all three** `promotion.*.v2` capabilities.
A healthy proxy or a high version number alone does not pass. Missing metadata,
a legacy protocol, or any missing step fails the check without invoking a payment.
For a login-only flow, omit the two anonymous capabilities but keep all three v2 steps.

Run this before enabling the new caller, and fail the deployment gate on failure.
It is an opt-in recipe, not a new default requirement for unrelated apps. Migrate
legacy single-call grant consumers to the persisted prepare/execute/status flow
before upgrading their proxy: the current proxy returns `410 PROMOTION_GRANT_REMOVED`
on the old grant route. Copying a Compose template or updating a submodule pointer
does not update an independently deployed proxy instance.
