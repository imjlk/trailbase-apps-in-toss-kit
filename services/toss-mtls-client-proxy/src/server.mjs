import { createConfig, createProxyServer } from "./core.mjs";

const config = createConfig();
const server = createProxyServer(config);

server.listen(config.port, "0.0.0.0", () => {
  console.log(`toss-mtls-client-proxy listening on ${config.port} (${config.mode})`);
});
