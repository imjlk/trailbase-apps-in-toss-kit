---
npm/@trailbase-apps-in-toss-kit/release-tools: patch
---

`uploadVerifiedAit` accepts the test scheme that the WebView SDK 3 CLI (3.10)
prints: `intoss-private://<app>?_deploymentId=<id>&host=appsInTossHost`.

It used to compare the CLI output with the scheme without `host`, so a tag
upload failed after the bundle was already in the console, and a re-run
uploaded a second bundle.

The scheme is now parsed instead (`readUploadedScheme`):
- it must name the app and the uploaded deployment
- `host=appsInTossHost` is the only extra parameter allowed
- the CLI's own line is kept as `testScheme`

`createDeviceTestScheme` keeps that marker as well.
