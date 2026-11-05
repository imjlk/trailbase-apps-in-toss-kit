import type { KeyValueStorage } from "@trailbase-apps-in-toss-kit/trailbase-client";

export type PersistentJsonFallback<T> = T | (() => T);

export interface PersistentJsonAtomStorage extends KeyValueStorage {
  removeItem?(key: string): void | Promise<void>;
}

export interface CreatePersistentJsonAtomOptions<T> {
  fallback: PersistentJsonFallback<T>;
  key: string;
  normalize?: (value: unknown) => T | null | undefined;
  storage: PersistentJsonAtomStorage;
}

export interface PersistentJsonAtom<T> {
  clear(): Promise<void>;
  key: string;
  read(): Promise<T>;
  write(value: T): Promise<void>;
}

export function createPersistentJsonAtom<T>({
  fallback,
  key,
  normalize,
  storage,
}: CreatePersistentJsonAtomOptions<T>): PersistentJsonAtom<T> {
  const atom: PersistentJsonAtom<T> = {
    async clear() {
      try {
        if (typeof storage.removeItem === "function") {
          await storage.removeItem(key);
          return;
        }
        await storage.setItem(key, "");
      } catch {
        // Best-effort local state cleanup should never break app bootstrap.
      }
    },
    key,
    async read() {
      let raw: string | null;
      try {
        raw = await storage.getItem(key);
      } catch {
        return resolveFallback(fallback);
      }

      if (!raw) {
        return resolveFallback(fallback);
      }

      try {
        const parsed = JSON.parse(raw) as unknown;
        if (!normalize) {
          return parsed as T;
        }
        const normalized = normalize(parsed);
        if (normalized === null || normalized === undefined) {
          throw new Error("Persistent JSON atom value failed normalization.");
        }
        return normalized;
      } catch {
        await atom.clear();
        return resolveFallback(fallback);
      }
    },
    async write(value) {
      try {
        await storage.setItem(key, JSON.stringify(value));
      } catch {
        // Persisted UI state is optional; callers can continue with memory state.
      }
    },
  };
  return atom;
}

function resolveFallback<T>(fallback: PersistentJsonFallback<T>) {
  return typeof fallback === "function" ? (fallback as () => T)() : fallback;
}

