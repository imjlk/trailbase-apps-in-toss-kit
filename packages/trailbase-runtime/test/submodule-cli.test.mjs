import { expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

// Deliberately copy only shipped source outside the workspace: no node_modules.
test("Node submodule CLI and capability evaluator need no package installation", () => {
  const source = fileURLToPath(new URL("../", import.meta.url));
  const root = mkdtempSync(join(tmpdir(), "kit-submodule-cli-"));
  try {
    for (const entry of ["src", "bin", "package.json"]) cpSync(join(source, entry), join(root, entry), { recursive: true });
    const cli = join(root, "bin/release-doctor.mjs");
    const run = args => spawnSync("node", args, { cwd: root, encoding: "utf8", env: { ...process.env, NODE_PATH: "", NODE_OPTIONS: "" } });
    const help = run([cli, "--help"]);
    expect(help.stderr).toBe(""); expect(help.status).toBe(0); expect(help.stdout).toContain("Usage:");
    const envFile = join(root, "synthetic.env");
    writeFileSync(envFile, "APP_ENV=production\n");
    const env = run([cli, "--env-file", envFile, "--app-env-key", "APP_ENV", "--json"]);
    expect(env.stderr).toBe(""); expect(env.status).toBe(0); expect(JSON.parse(env.stdout).ok).toBe(true);
    const moduleUrl = pathToFileURL(join(root, "src/proxy-capabilities.mjs")).href;
    const evaluator = run(["--input-type=module", "--eval", `
      import { evaluateProxyCapabilities } from ${JSON.stringify(moduleUrl)};
      const health = { ok: true, mode: 'forward', kit: { contractVersion: 1, proxyVersion: '1.2.3-rc.10+test', capabilities: [] } };
      if (!evaluateProxyCapabilities(health, { minimumVersion: '1.2.3-rc.2' }).ok) process.exit(1);
      if (evaluateProxyCapabilities(health, { minimumVersion: '1.2.3' }).ok) process.exit(2);
    `]);
    expect(evaluator.stderr).toBe(""); expect(evaluator.status).toBe(0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
