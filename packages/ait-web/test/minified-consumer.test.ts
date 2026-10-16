import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

for (const splitting of [false, true]) {
  test(`minified browser consumer executes fresh auth codes and controlled errors (splitting=${splitting})`, async () => {
    const output = mkdtempSync(join(tmpdir(), "kit-web-minified-"));
    try {
      const build = await Bun.build({
        entrypoints: [join(import.meta.dir, "fixtures/minified-consumer.ts")],
        target: "browser", minify: true, splitting, outdir: output,
      });
      if (!build.success) throw new AggregateError(build.logs, "Consumer browser build failed");
      const entry = build.outputs.find(item => item.kind === "entry-point");
      expect(entry).toBeDefined();
      // Execute generated ESM/chunks, not the source or a successful build status.
      const compiled: typeof import("./fixtures/minified-consumer") = await import(pathToFileURL(entry!.path).href);
      const consumer = compiled.createConsumer();
      expect(consumer.calls).toEqual({ loads: 0, codes: 0, hashes: 0 });
      expect(await consumer.adapter.createAnonymousKeyAuthCode()).toEqual({ code: "fixture-code-1", expiresIn: 300 });
      expect(await consumer.adapter.createAnonymousKeyAuthCode()).toEqual({ code: "fixture-code-2", expiresIn: 300 });
      expect(consumer.calls).toEqual({ loads: 1, codes: 2, hashes: 0 });
      expect(await consumer.adapter.anonymousHash()).toBe("ait:fixture-hash");
      expect(consumer.calls).toEqual({ loads: 1, codes: 2, hashes: 1 });

      for (const [scenario, code, issued] of [
        ["load-failure", "UNSUPPORTED", 0],
        ["unsupported", "UNSUPPORTED", 0],
        ["issue-failure", "SDK_ERROR", 1],
        ["invalid-result", "INVALID_RESULT", 1],
      ] as const) {
        const failed = compiled.createConsumer(scenario);
        const error = await failed.adapter.createAnonymousKeyAuthCode().then(() => null, error => error);
        expect(error).toMatchObject({ code });
        expect(error.message).not.toContain("fixture-private");
        expect(error.message).not.toContain("fixture-code");
        expect(failed.calls).toEqual({ loads: 1, codes: issued, hashes: 0 });
      }
    } finally {
      rmSync(output, { recursive: true, force: true });
    }
  });
}
