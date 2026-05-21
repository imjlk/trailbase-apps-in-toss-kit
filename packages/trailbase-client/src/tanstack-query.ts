export function createTrailbaseQueryClient({
  QueryClient,
  options,
}: {
  QueryClient: new (options?: unknown) => unknown;
  options?: Record<string, unknown>;
}) {
  return new QueryClient(createTrailbaseQueryClientOptions(options));
}

export function createTrailbaseQueryClientOptions(overrides: Record<string, unknown> = {}) {
  return mergeQueryClientOptions(
    {
      defaultOptions: {
        queries: {
          retry: 1,
          staleTime: 5_000,
          refetchOnWindowFocus: false,
        },
        mutations: {
          retry: 0,
        },
      },
    },
    overrides,
  );
}

export function trailbaseQueryOptions<T extends Record<string, unknown>>(options: T): T {
  return options;
}

function mergeQueryClientOptions(base: Record<string, unknown>, overrides: Record<string, unknown>) {
  const output = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (isPlainObject(value) && isPlainObject(output[key])) {
      output[key] = mergeQueryClientOptions(output[key] as Record<string, unknown>, value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
