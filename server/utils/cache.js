// Tiny TTL cache used for model lists and file summaries to avoid redundant model calls.
const store = new Map();

export function cacheGet(key) {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.expires && hit.expires < Date.now()) { store.delete(key); return undefined; }
  return hit.value;
}

export function cacheSet(key, value, ttlMs = 0) {
  store.set(key, { value, expires: ttlMs ? Date.now() + ttlMs : 0 });
  return value;
}

export async function cached(key, ttlMs, producer) {
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;
  const value = await producer();
  return cacheSet(key, value, ttlMs);
}

export function cacheClear(prefix = '') {
  for (const k of store.keys()) if (!prefix || k.startsWith(prefix)) store.delete(k);
}

export function cacheStats() {
  return { size: store.size, keys: [...store.keys()] };
}
