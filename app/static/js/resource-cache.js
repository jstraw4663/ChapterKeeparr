// Bounded read cache: share a request, retain visible data during refresh and
// let only the latest request publish a result. No polling or retry loop here.
export function resourceCache(load, limit = 40) {
  const entries = new Map();
  return {
    get: key => entries.get(key),
    read(key, version, { force = false } = {}) {
      const old = entries.get(key);
      if (!force && old && old.version === version) return old;
      const next = { version, value: old?.value, error: '', loading: true,
        revision: old?.revision || 0, controller: new AbortController(), promise: null };
      entries.delete(key); entries.set(key, next);
      old?.controller.abort();
      while (entries.size > limit) {
        const first = entries.keys().next().value;
        entries.get(first).controller.abort(); entries.delete(first);
      }
      next.promise = Promise.resolve().then(() => load(key, { signal: next.controller.signal }))
        .then(value => {
          const current = entries.get(key);
          if (current && current !== next) return current.promise;
          if (current === next) { next.value = value; next.revision++; }
          return value;
        }).catch(error => {
          const current = entries.get(key);
          if (current && current !== next) return current.promise;
          if (current === next) { next.error = error.message; next.revision++; }
          throw error;
        }).finally(() => { next.loading = false; });
      // Render callers can inspect the entry; awaiting callers still receive
      // failures. Avoid an unhandled rejection before a consumer subscribes.
      next.promise.catch(() => {});
      return next;
    },
  };
}
