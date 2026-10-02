# Device and SDK diagnostics

The Kit complements the [official mini-app test workflow](https://developers-apps-in-toss.toss.im/guide/operation/toss). It does not add its own WebView inspector or infer real device success from local tests.

## RN runtime snapshot

```ts
import { collectAppsInTossRuntimeDiagnostics } from '@trailbase-apps-in-toss-kit/ait-rn/diagnostics';
const report = await collectAppsInTossRuntimeDiagnostics({ enabled: debugEnabled });
```

Disabled by default. When explicitly enabled, four read-only probes report operational environment, OS, host Toss version and network state. Each probe is bounded to three seconds. Unknown, failed and timed-out probes remain distinct. Only fixed enums and a numeric version are returned; no launch URL, user identifier, token, native error or SDK arguments are logged. `deviceFeaturesVerified` is always false. The consumer decides whether to display this in its debug UI or a console. No remote log sink is configured.

For per-operation timing and coarse SDK failures, the adapters now use the published `@ait-kit/sdk` 0.6.0. Consumers can explicitly enable its runtime-neutral observer:

```ts
import { createSdkDiagnostics } from '@ait-kit/sdk';
const diagnostics = createSdkDiagnostics({ enabled: debugEnabled, capacity: 50 });
await diagnostics.run('share.open', () => existingShareAction());
const recentCalls = diagnostics.snapshot();
```

Use the same exact SDK version when declaring a direct consumer dependency. The observer records fixed operation labels, elapsed time and coarse outcomes in bounded memory. It does not retain arguments, results or native errors, configure a remote sink, retry or cancel calls. `resolved` means the supplied call returned; it does not prove sharing, agreement, payment or reward completion. Consumers own the explicit debug opt-in, display and clearing of the history. The runtime snapshot remains independent from this observer.

## WebView preflight

Release Doctor supports an opt-in `webview-network` check:

```json
{
  "checks": [{
    "type": "webview-network", "runtime": "web", "appName": "your-app",
    "sdkVersion": "3.7.0", "endpoint": "https://api.your-service.example/api/read",
    "method": "POST", "requestHeaders": ["authorization", "content-type"]
  }]
}
```

Run through the existing `trailbase-release-doctor --config <file>`. The checker sends header-only OPTIONS requests, follows no redirects and includes no cookies or authorization values. It requires exact origin and explicit requested headers; GET/HEAD/POST follow Fetch's CORS-safelisted method rule, while PUT/PATCH/DELETE require an explicit allowed method. It does not broaden CORS. Supply `origins` explicitly when testing observed console origins or unsupported future SDK versions. Default version mapping follows the current [version-specific notice](https://developers-apps-in-toss.toss.im/guide/operation/toss). `runtime: rn` skips the CORS probe; it is not RN connectivity evidence. `allowLocalHttp: true` is loopback-only for fixtures. Each request has a bounded deadline. A pass verifies preflight only, not application auth, actual API behavior or device SDK support.

## Test schemes and evidence

`release-tools/device-test` exports `inspectAitDeviceMetadata`, `createDeviceTestScheme` and `createDeviceTestPlan`. Inspect actual AIT bytes for app name, deployment ID and SHA256 first. Supply the exact console/CLI-issued private scheme and the deployment ID inspected from the artifact. The scheme host and deployment ID are preserved, routes are bounded, query keys require an explicit allowlist and sensitive key names are rejected. Use synthetic/public fixture values, never credentials. A plan records the app/version/source SHA/bundle hash and starts every check at `not_run`. It does not upload a bundle, open a device or mark checks complete. `intoss://` is not accepted as a pre-release test scheme.

Route query additions preserve the issued scheme's existing `queryParams`; supplied values override matching keys only. Both sets of values must pass validation, and the final merged query must fit the size limit.

## SDK versions and Sentry

The RN reference fixture is 2.10.11; minimum 2.10.10 remains tested because these diagnostics require no new native API. Consumers update framework and native-modules together, then test locally and on their target device. Sampo changesets track the new Kit APIs; dependency fixture updates do not silently raise the peer minimum.

Sentry remains optional and consumer-owned. The [official RN guide](https://developers-apps-in-toss.toss.im/ai-vibe-coding/integration/sentry) requires `enableNative: false`, Granite plugin `useClient: false` and an explicit source-map upload for the actual deployment. This change does not initialize Sentry or upload anything.
