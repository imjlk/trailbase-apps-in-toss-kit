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
        plugins: [{ name: "forbid-native-sdk", setup(build) {
          build.onResolve({ filter: /^(?:@apps-in-toss\/framework(?:\/|$)|@ait-kit\/sdk\/rn(?:\/|$)|react-native(?:\/|$)|@granite-js\/)/ }, args => {
            throw new Error(`Web consumer acquired native dependency: ${args.path}`);
          });
        } }],
      });
      if (!build.success) throw new AggregateError(build.logs, "Consumer browser build failed");
      const entry = build.outputs.find(item => item.kind === "entry-point");
      expect(entry).toBeDefined();
      // Execute generated ESM/chunks, not the source or a successful build status.
      const compiled: typeof import("./fixtures/minified-consumer") = await import(pathToFileURL(entry!.path).href);
      const migrated = await compiled.exerciseSharedFlow();
      expect(migrated.saved).toEqual([1, 2, 3]);
      expect(migrated).toMatchObject({ initial: "unknown", replayed: true, effects: 1, cleanups: 2 });
      expect(migrated.wire).toHaveLength(2);
      expect(migrated.wire[0]).toEqual(migrated.wire[1]);
      expect(Object.keys(migrated.wire[1]).sort()).toEqual(["context", "opportunityKey", "placement", "requestId"]);
      expect(migrated.shown).toMatchObject({ earned: true, events: ["show", "impression", "userEarnedReward", "dismissed"] });
      expect(migrated.logs).toEqual([{ log_name: "ad_skip_used", log_type: "event", params: { experiment_id: "fixture-experiment", variant: "control" } }]);
      const helpers = await compiled.exerciseClientHelpers();
      expect(helpers.link).toBe("https://toss.im/_m/fixture?path=intoss%3A%2F%2Ffixture-app%2Fpoll%2F1");
      expect(helpers.shared).toEqual([`Fixture\n\n${helpers.link}`]);
      expect(helpers).toMatchObject({ opened: ["https://toss.shopping/t/fixture"], shoppingResult: { status: "dispatched" }, claim: "GRANTED" });
      expect(helpers.posted.map(call => call.url)).toEqual(["/claim", "/agreements"]);
      expect(helpers.posted[1].body).toMatchObject({ result: "newAgreement", status: "OPTED_IN", template_code: "fixture-app-alert" });
      expect(helpers.placeholder).toMatchObject({ reason: "unsupported", shouldRenderPlaceholder: true });
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
