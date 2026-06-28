import { createConfig, createProxyServer } from "./core.mjs";

const MIN_SHUTDOWN_TIMEOUT_MS = 2_000;
const SHUTDOWN_TIMEOUT_BUFFER_MS = 1_000;
const MAX_NON_IAP_SEQUENTIAL_UPSTREAM_CALLS = 3;

const startedAt = performance.now();
const config = createConfig();
const server = createProxyServer(config);

server.listen(config.port, "0.0.0.0", () => {
  console.log(
    JSON.stringify({
      event: "toss-mtls-client-proxy.ready",
      port: config.port,
      mode: config.mode,
      startupMs: Math.round(performance.now() - startedAt),
    }),
  );
});

function shutdown(signal) {
  console.log(
    JSON.stringify({
      event: "toss-mtls-client-proxy.shutdown",
      signal,
    }),
  );

  const forceExit = setTimeout(() => {
    console.error(
      JSON.stringify({
        event: "toss-mtls-client-proxy.shutdown.timeout",
        signal,
      }),
    );
    process.exit(1);
  }, shutdownTimeoutMs(config));
  forceExit.unref?.();

  server.close((error) => {
    clearTimeout(forceExit);
    if (error) {
      console.error(error);
      process.exitCode = 1;
      return;
    }
    process.exitCode = 0;
  });
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

function shutdownTimeoutMs(config) {
  const upstreamTimeoutMs = Number(config.upstreamTimeoutMs);
  const retryDelayMs = Number(config.iapOrderStatusRetryDelayMs);
  const maxAttempts = Number(config.iapOrderStatusMaxAttempts);
  const sequentialUpstreamCalls = Math.max(MAX_NON_IAP_SEQUENTIAL_UPSTREAM_CALLS, maxAttempts);
  const upstreamWindowMs = sequentialUpstreamCalls * Math.max(0, upstreamTimeoutMs);
  const retryWindowMs = Math.max(0, maxAttempts - 1) * Math.max(0, retryDelayMs);
  return Math.max(MIN_SHUTDOWN_TIMEOUT_MS, upstreamWindowMs + retryWindowMs + SHUTDOWN_TIMEOUT_BUFFER_MS);
}
