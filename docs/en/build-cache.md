# Shared Rust and Docker build caches

Keep the kit pinned as a Git submodule. Share disposable build output, not source
checkouts or production data. These recipes are opt-in: the kit does not change
shell profiles, Docker daemon settings, consumer scripts, or existing caches.

## Local Cargo builds

For trusted consumer repositories using compatible toolchains, set a common
absolute target directory in the developer shell or the consumer's local runner.
Run these commands from the consumer workspace with its intended Rust toolchain;
install the required WASI target in that active toolchain before checking:

```sh
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/ait-kit/cargo-target/$(uname -s)-$(uname -m)}"
rustup target add wasm32-wasip2
cargo check --locked --target wasm32-wasip2
```

Keep an existing CARGO_TARGET_DIR override. Use an absolute XDG_CACHE_HOME if set.
This is a shell recipe, not a literal value for `.env` or Cargo TOML: those files
do not perform this shell expansion. It affects child processes in this shell;
it does not configure Docker, other terminals, or IDE processes automatically.
Cargo's explicit `--target-dir` takes priority. Remove conflicting overrides only
when intentionally adopting the shared directory.

Before adopting it:

- Find consumer scripts and Docker COPY commands that assume `target/`. Read the
  actual target directory from `cargo metadata --format-version 1 --no-deps`
  using the same environment and manifest as the build, or use Cargo JSON
  `compiler-artifact` output for the exact artifact path.
- Copy the desired artifact into an app-specific staging directory immediately
  after building. Top-level binaries with identical names can overwrite each
  other across workspaces; do not use shared output as a release archive.
- Expect Cargo locking to serialize some concurrent builds. Separate target
  directories if contention is costly, or for mutually untrusted repositories.
- Toolchain, features, profile and target differences still produce distinct
  artifacts. Sharing does not guarantee deduplication or bound disk usage.
- Do not run an unqualified `cargo clean` against the shared directory: it can
  remove other apps' cached output. Inspect and retire caches only when builds
  using them have stopped. Old per-app targets are not migrated or deleted.

See [Cargo build cache](https://doc.rust-lang.org/cargo/reference/build-cache.html).

## Docker builds

Keep host target output separate from Linux builder caches, even for WASM: build
scripts and procedural macros run on the build host. Exclude `**/target`,
`**/node_modules`, runtime `traildepot` directories, secrets and release output
from each consumer's Docker build context. Preserve template migrations and the
kit submodule source required by the build.

Use BuildKit cache mounts for Cargo registry/git downloads and compilation.
Choose cache IDs by trust scope, toolchain and build platform; do not include the
source commit in every cache ID. For concurrent builders, mount the Cargo cache
with `sharing=locked`, including its lock files. Do not share credentials or a
host's entire Cargo home. An illustrative build-stage fragment follows; adapt
paths, toolchain namespace and package artifact name to the consumer:

```dockerfile
# syntax=docker/dockerfile:1
# In an existing Rust build stage, after installing wasm32-wasip2:
ARG BUILDPLATFORM
ARG RUST_CACHE_NAMESPACE=rust-toolchain-v1
RUN --mount=type=cache,id=ait-cargo-${RUST_CACHE_NAMESPACE}-${BUILDPLATFORM},target=/cargo-cache,sharing=locked \
    --mount=type=cache,id=ait-target-${RUST_CACHE_NAMESPACE}-${BUILDPLATFORM},target=/cargo-target,sharing=locked \
    CARGO_HOME=/cargo-cache CARGO_TARGET_DIR=/cargo-target \
    cargo build --locked --release --target wasm32-wasip2 \
    && mkdir -p /out \
    && cp /cargo-target/wasm32-wasip2/release/your_api.wasm /out/api.wasm
```

Change the namespace when changing the Rust toolchain/build environment. Copy
`/out/api.wasm` into the runtime stage; cache mount contents are not image-layer
output. Builds must also succeed with empty caches. This fragment does not
replace an app's complete Dockerfile or install target support.

## Inspect, bound and retire caches

```sh
docker context show
docker buildx ls
docker system df -v
docker buildx du --builder YOUR_BUILDER
```

Select the builder actually used by local builds or Coolify. Different builders
and remote servers have separate caches. Start with a 20GB cache budget and tune
it to the host's disk capacity and rebuild frequency; this is not a disk quota.

- For the `docker` driver, merge the `builder.gc` section from
  [docker-daemon-gc.example.json](../../templates/trailbase/build-cache/docker-daemon-gc.example.json)
  into existing daemon settings (Docker Desktop: Settings → Docker Engine).
- For a compatible standalone BuildKit OCI worker, merge
  [buildkitd-gc.example.toml](../../templates/trailbase/build-cache/buildkitd-gc.example.toml)
  into that builder's configuration. Check the installed BuildKit version;
  daemon JSON and BuildKit TOML are not interchangeable. Existing custom GC
  policies require separate review. Apply restarts during a maintenance window.

After inspection, this interactive command removes unused build cache older
than seven days from one selected builder:

```sh
docker buildx prune --builder YOUR_BUILDER --filter 'until=168h'
```

It is not a dry run. Leave confirmation enabled; do not schedule broad pruning
by default. Rebuilds may download/recompile dependencies after eviction. GC does
not manage all unused images, stopped containers, or volumes: inventory those
separately and retain deployed/rollback image digests. Never include TrailBase
data volumes in build-cache cleanup; avoid `docker system prune --volumes` and
`docker compose down -v` for this task. Local Cargo output is outside BuildKit GC.

References: [Docker cache optimization](https://docs.docker.com/build/cache/optimize/),
[Build garbage collection](https://docs.docker.com/build/cache/garbage-collection/).
