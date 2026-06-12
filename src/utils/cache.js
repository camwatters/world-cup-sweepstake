export const TTL = {
  SCORES:    2  * 60 * 1000, // 2 minutes
  STANDINGS: 15 * 60 * 1000, // 15 minutes
};

export function getCached(key, ttl = TTL.STANDINGS) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > ttl) return null;
    return data;
  } catch {
    return null;
  }
}

export function setCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    // storage full — ignore
  }
}
