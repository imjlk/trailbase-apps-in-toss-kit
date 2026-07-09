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

Set `"required": false` to report a failed check as a warning instead of failing
the whole doctor run. The template keeps template drift and changeset checks as
warnings by default because those policies often become strict only after a
service has reconciled its copied files and release process.

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
