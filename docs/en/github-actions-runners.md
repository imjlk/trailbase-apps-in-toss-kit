# Private consumer GitHub Actions runners

Use the copy-in [runner templates](../../templates/github-runner/README.md) for opt-in self-hosted consumer CI. This is separate from application deployment Compose and does not require changing the kit gitlink or TrailBase server.

For personal GitHub accounts, register a runner for every repository and group the containers in one Coolify service if desired. Sharing one runner across repositories is supported at organization scope. Preserve per-repository credentials, identities and work paths. Keep public and untrusted PR jobs on GitHub-hosted runners.

The helper verifies bounded BuildKit resources, image loading and shared temporary paths. Docker integration fixtures must be reviewed for loopback access, uniquely scoped cleanup and resource limits before activation. Host Docker access remains administrative authority over the server; a resource limit is not a sandbox.

Leave the enable variable false until registration and a real job are verified. Test persistent identity after a restart, and preserve each consumer's existing release and upload policy.
