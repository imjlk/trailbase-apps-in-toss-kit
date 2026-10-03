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

## Kit local runner and report

Use `node scripts/cargo-local.mjs -- <cargo command>` in Kit, or copy the two standalone
`scripts/cargo-local.mjs` and `scripts/cargo-cache-report.mjs` files into an older consumer's
owned `scripts/` directory. This lets a consumer adopt build tooling without upgrading unrelated
runtime submodule code. Reconcile these copies on tool updates. Newer consumers can invoke the
submodule script directly. Both tools require Node; Cargo/rustup must already be configured on PATH.
The runner keeps the caller's working directory and its selected toolchain; it does not install Rust
or change global mise/rustup settings. If a mise shim has no configured Rust version, select the
project Rust version or put the installed rustup proxy directory on PATH first.

```sh
node scripts/cargo-local.mjs -- check --locked --workspace --target wasm32-wasip2
node scripts/cargo-local.mjs --ephemeral -- test --locked --workspace
node scripts/cargo-local.mjs --full-debug -- test --locked --workspace
node scripts/cargo-local.mjs -- target-dir --manifest-path apps/trailbase/wasm/Cargo.toml
node scripts/cargo-cache-report.mjs /absolute/checkouts /absolute/shared-cache
```

The default target matches the OS/architecture path above. Explicit `CARGO_TARGET_DIR`, `CARGO_BUILD_TARGET_DIR`, and Cargo
`--target-dir` win (Cargo retains its own precedence between them). The runner defaults dev/test debug info to `line-tables-only`, retaining stack
trace file/line information but not detailed variable inspection. `--full-debug` leaves the normal
workspace/environment debug settings alone. Release profile settings never change. `--ephemeral`
defaults incremental compilation off for one-off checks; existing profile/incremental environment
settings always win. No environment change escapes the invoked process.
With an explicit Cargo `--config` (inline TOML or a file), the runner does not inject a default target
directory: Cargo interprets the configuration itself. This applies even to config containing only other
settings; set `CARGO_TARGET_DIR` explicitly if you also want a shared cache in that case.
Arguments after Cargo’s `--` application separator do not count as Cargo configuration.

`target-dir` prints Cargo metadata's effective target directory under the same environment, retaining a leading Rustup selector (for example `+nightly`) and Cargo global options. Resolve
it with the same manifest, target/config/features and target-dir overrides as the build.
`--target` becomes metadata `--filter-platform`; release/profile/jobs/package and artifact-selection flags
are removed. Unsupported flags fail explicitly; stage the required WASM immediately after a successful
build. Do not silently read an old checkout-local `target/` or treat a shared top-level artifact as a
release archive. The runner rejects `clean` even after supported Cargo global options; deliberate maintenance uses Cargo separately.
Only `build`, `check`, `test`, `run`, `bench`, `doc`, `rustc`, `rustdoc`, `metadata`, `fetch`, `tree`,
`help` and the wrapper’s `target-dir` are supported. Cargo aliases (including `b`/`c`/`t`/`r`) and
external commands are rejected, because aliases can expand recursively to `clean`.
For a trusted plugin, invoke Cargo directly, for example:
`CARGO_TARGET_DIR="$(node scripts/cargo-local.mjs -- target-dir)" cargo clippy --workspace`.
This is an accidental-clean guard, not a sandbox for build scripts or programs launched by Cargo.
On Unix, SIGTERM/SIGINT/SIGHUP are forwarded to the Cargo process group, followed by SIGKILL after one second
so timed-out checks do not leave compiler descendants writing into the cache. Native Windows is rejected before any Cargo process starts; use WSL.

The JSON report recognizes Cargo markers, rechecks directory identities and root boundaries, skips root/child symlinks, node_modules and local runtime data,
and sums `du -sk` block estimates. A Unix-compatible `du` on PATH is required (use WSL on Windows).
Concurrent filesystem mutation is checked on a best-effort basis; this is not a security boundary or deletion tool. It is read-only, does not prove inactivity, and shared filesystem
blocks can make totals overlap. Before deleting an explicit old target, check active Cargo/rustc
processes and consumers of the output, preserve required artifacts, and verify the replacement build.
Never delete by age alone, traverse a symlink for cleanup, or include TrailBase volumes in this operation.

The Kit WASM smoke accepts `KIT_SMOKE_SUBNET` for an explicitly checked unused fixture subnet when Docker default address pools are exhausted. It creates and removes its own network; do not reuse or delete a consumer network.

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
and remote servers have separate caches. Start with a 8GB cache budget and tune
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
