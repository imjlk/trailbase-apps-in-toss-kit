export class StaleAppSessionOperationError extends Error {
  constructor() {
    super("Session operation was superseded or cancelled");
    this.name = "StaleAppSessionOperationError";
  }
}

export interface SessionOperation {
  signal: AbortSignal;
  check(): void;
}

export function abortableSessionOperation<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { reject(new StaleAppSessionOperationError()); };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    promise.then(value => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) abort(); else resolve(value);
    }, error => {
      signal.removeEventListener("abort", abort);
      reject(error);
    });
  });
}

export function createSessionOperationGuard() {
  let current: AbortController | undefined;
  function cancel() { current?.abort(); }
  function run<T>(work: (operation: SessionOperation) => Promise<T>): Promise<T> {
    cancel();
    const controller = new AbortController();
    current = controller;
    const operation = {
      signal: controller.signal,
      check() {
        if (controller.signal.aborted || current !== controller) throw new StaleAppSessionOperationError();
      },
    };
    return abortableSessionOperation(Promise.resolve().then(() => { operation.check(); return work(operation); }), operation.signal);
  }
  return { run, cancel };
}
