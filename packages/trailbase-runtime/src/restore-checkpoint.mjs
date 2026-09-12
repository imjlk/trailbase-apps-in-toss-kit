// Independent durable write-ahead witness required; a checkpoint inside the same
// backup cannot detect external effects newer than that backup. Never send here.
const generation = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const counter = value => Number.isSafeInteger(value) && value >= 0;
const checkpoint = value => value && generation(value.generation) && counter(value.sequence);

export function evaluateRestoreCheckpoint(evidence = {}) {
  const { database, witness, dispatchPaused, inFlight, unresolved } = evidence ?? {};
  const failures = [];
  if (dispatchPaused !== true) failures.push("External dispatch must remain paused during restore validation");
  if (inFlight !== 0) failures.push("In-flight external operations must be accounted for");
  if (unresolved !== 0) failures.push("Unknown outcomes require reconciliation using their original identifiers");
  if (!checkpoint(database) || !checkpoint(witness)) {
    failures.push("Both database and independent durable witness checkpoints are required");
  } else if (database.generation !== witness.generation || database.sequence !== witness.sequence) {
    failures.push("Database and external history differ; quarantine the gap before any retry or settlement");
  }
  return failures.length ? { ok: false, failures } : {
    ok: true, message: "Supplied restore checkpoints agree and no unresolved or in-flight work was reported; operator resume remains required",
  };
}

// Programmatic Release Doctor check. Readers must inspect trusted private sources,
// including a durable witness outside the restored backup. Results contain no IDs.
export function createRestoreCheckpointCheck({ name = "Restore checkpoint", readEvidence, required = true } = {}) {
  return { name, required, async run() {
    try {
      if (typeof readEvidence !== "function") return { ok: false, failures: ["Restore evidence reader is required"] };
      return evaluateRestoreCheckpoint(await readEvidence());
    } catch {
      return { ok: false, failures: ["Restore evidence could not be read"] };
    }
  } };
}
