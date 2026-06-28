import { createConfig, createProxyServer } from "./core.mjs";

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
  }, 2_000);
  forceExit.unref?.();

  server.close((error) => {
    clearTimeout(forceExit);
    if (error) {
      console.error(error);
      process.exit(1);
    }
    process.exit(0);
  });
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
