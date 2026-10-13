# Private consumer Actions runners

Copy `scripts/prepare-self-hosted-ci.mjs` and its tests into the consumer `scripts/` directory. Copy `ops/github-runner/config.example.json` to `ops/github-runner/config.json`, then set the exact repository, builder name and shared host/container work path.

Repository-level runners belong to one repository. A personal account can group multiple repository runner containers in one Coolify Compose service; an organization can instead share an organization runner across selected repositories. Keep each repository registration, identity volume, tool cache and work directory separate. Use a pinned Ubuntu 24.04 runner image when release tools require recent glibc.

Keep `COOLIFY_RUNNER_ENABLED` unset/false until the repository runner is registered, online, and verified. Select self-hosted labels only for the original private repository and same-repository pull requests opened by its owner. Forks, public copies, non-owner PRs and disabled flags must use GitHub-hosted runners. Existing upload and release permissions remain consumer-owned.

On self-hosted Docker jobs, call the helper after checkout and Node setup. It creates a distinct docker-container Buildx builder with default image loading, CPU 4 / memory 8 GiB, and verifies actual limits before publishing BUILDX_BUILDER. It never changes the server's selected builder or prunes shared storage. Temporary files use RUNNER_TEMP inside the work bind mount, so host Docker can see fixture bind mounts. Use `ciDockerArgs` in disposable Docker fixture wrappers to cap containers at CPU 2 / memory 4 GiB; it preserves hosted behavior and other Docker commands.

Runner resource caps do not restrict the authority granted by the host Docker socket. Existing loopback-only host Docker fixtures require host networking for their runner, because localhost inside a bridge container refers to the container. Other runners should retain bridge/service networks. Request any required host-access approval before deploying the prepared manifest. Registration credentials must stay outside source and logs.

Verify the runner's actual CPU/memory settings, repository labels, implicit image loading, temporary paths, and restart recovery. Prepare Rust from the consumer's rust-toolchain file for native Rust jobs, and a managed Python with SQLite STRICT support when migration checks need it. Never upgrade a consumer's kit gitlink, server, data schema, or release baseline merely to adopt these CI helpers.
