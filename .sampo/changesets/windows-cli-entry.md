---
npm/@trailbase-apps-in-toss-kit/release-tools: patch
---

Support JavaScript AIT CLI entry files on native Windows without using a shell.
Pass the installed CLI's actual .js, .mjs, or .cjs file as cliPath instead of a
.cmd shim. Artifact paths and API keys retain their argument boundaries, and
upload errors continue to suppress captured credentials and CLI output.
