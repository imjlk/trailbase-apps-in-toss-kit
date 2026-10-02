import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// A cache instance belongs to one provider account. Do not expose its files via HTTP:
// the OAuth entry contains a bearer credential. Failed loads are never cached here.
export function createAffiliateCache({ directory, now = Date.now, maxEntries = 512 } = {}) {
  const memory = new Map();
  const flights = new Map();
  const file = (key) => join(directory, `${createHash('sha256').update(key).digest('hex')}.json`);
  async function get(key) {
    let entry = memory.get(key);
    if (!entry && directory) {
      try { entry = JSON.parse(await readFile(file(key), 'utf8')); } catch { return null; }
    }
    if (!entry || !Number.isFinite(entry.expiresAt) || entry.expiresAt <= now()) return null;
    return entry.value;
  }
  async function set(key, value, expiresAt) {
    const entry = { value, expiresAt };
    if (directory) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const target = file(key);
      const temporary = `${target}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(entry), { mode: 0o600 });
      await rename(temporary, target);
    }
    memory.delete(key);
    memory.set(key, entry);
    if (memory.size > maxEntries) memory.delete(memory.keys().next().value);
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
