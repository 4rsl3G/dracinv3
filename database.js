// database.js
// SQLite cache-aside store for API responses

const path = require("path");
const Database = require("better-sqlite3");

const DB_PATH = process.env.SQLITE_PATH || path.join(process.cwd(), "cinestream.sqlite");
const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS api_cache (
    key TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_api_cache_created_at ON api_cache(created_at);
`);

const stmtGet = db.prepare("SELECT key, data, created_at FROM api_cache WHERE key = ?");
const stmtUpsert = db.prepare(`
  INSERT INTO api_cache(key, data, created_at)
  VALUES(?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET
    data = excluded.data,
    created_at = excluded.created_at
`);
const stmtDelete = db.prepare("DELETE FROM api_cache WHERE key = ?");

/**
 * Cache-aside wrapper
 * @param {string} key
 * @param {() => Promise<any>} apiFunction
 * @param {number | ((freshData:any)=>number)} ttl_seconds
 */
async function fetchWithCache(key, apiFunction, ttl_seconds) {
  const now = Math.floor(Date.now() / 1000);

  try {
    const row = stmtGet.get(key);
    if (row) {
      const ttl =
        typeof ttl_seconds === "function"
          ? (() => {
              // If ttl depends on data, compute from cached data too.
              try {
                const parsed = JSON.parse(row.data);
                return Math.max(1, Number(ttl_seconds(parsed)) || 1);
              } catch {
                return 1;
              }
            })()
          : Math.max(1, Number(ttl_seconds) || 1);

      if (now - row.created_at < ttl) {
        return JSON.parse(row.data);
      }
    }
  } catch {
    // cache read failure should not break app
  }

  const fresh = await apiFunction();

  const computedTtl =
    typeof ttl_seconds === "function"
      ? Math.max(1, Number(ttl_seconds(fresh)) || 1)
      : Math.max(1, Number(ttl_seconds) || 1);

  // If the computed TTL is 0/negative (shouldn't happen), avoid caching.
  if (computedTtl > 0) {
    try {
      stmtUpsert.run(key, JSON.stringify(fresh), now);
    } catch {
      // ignore cache write failures
    }
  } else {
    try {
      stmtDelete.run(key);
    } catch {}
  }

  return fresh;
}

module.exports = {
  db,
  fetchWithCache
};
