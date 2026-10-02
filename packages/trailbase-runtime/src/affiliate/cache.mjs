import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// A cache instance belongs to one provider account. Do not expose its files via HTTP:
// the OAuth entry contains a bearer credential. Failed loads are never cached here.
export function createAffiliateCache({ directory, now = Date.now, maxEntries = 512 } = {}) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error('Invalid cache entry limit');
  const memory = new Map();
  const flights = new Map();
  let writes = 0;
  let pruning;
  function remember(key, entry) {
    memory.delete(key);
    memory.set(key, entry);
    if (memory.size > maxEntries) memory.delete(memory.keys().next().value);
  }
  const file = (key) => join(directory, `${createHash('sha256').update(key).digest('hex')}.json`);
  async function prune() {
    const live = [];
    for (const name of await readdir(directory)) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const path = join(directory, name);
      try {
        const entry = JSON.parse(await readFile(path, 'utf8'));
        if (!Number.isFinite(entry.expiresAt) || entry.expiresAt <= now()) {
          await unlink(path);
        } else live.push({ path, modified: (await stat(path)).mtimeMs });
      } catch { /* A concurrent atomic replacement/eviction can remove a cache file. */ }
    }
    live.sort((a, b) => b.modified - a.modified);
    await Promise.all(live.slice(maxEntries).map(({ path }) => unlink(path).catch(() => {})));
  }
  async function get(key) {
    let entry = memory.get(key);
    if (!entry && directory) {
      try { entry = JSON.parse(await readFile(file(key), 'utf8')); } catch { return null; }
    }
    if (!entry || !Number.isFinite(entry.expiresAt) || entry.expiresAt <= now()) return null;
    remember(key, entry);
    return entry.value;
  }
  async function set(key, value, expiresAt) {
    const entry = { value, expiresAt };
    if (directory) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const target = file(key);
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(entry), { mode: 0o600 });
        await rename(temporary, target);
      } finally { await unlink(temporary).catch(() => {}); }
      if ((writes++ % Math.min(maxEntries, 64)) === 0 && !pruning) {
        pruning = prune();
        try { await pruning; } finally { pruning = undefined; }
      }
    }
    remember(key, entry);
    return value;
  }
  async function load(key, ttlMs, loader) {
    const cached = await get(key);
    if (cached !== null) return cached;
    if (flights.has(key)) return flights.get(key);
    const pending = (async () => {
      const value = await loader();
      await set(key, value, now() + ttlMs);
      return value;
    })();
    flights.set(key, pending);
    try { return await pending; } finally { flights.delete(key); }
  }
  return { get, set, load };
}
