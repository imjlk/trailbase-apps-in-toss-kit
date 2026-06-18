export function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

export function mapStorage(entries: Array<[string, string]> = []) {
  const map = new Map<string, string>(entries);
  return {
    getItem: (key: string) => map.get(key) ?? null,
    map,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

