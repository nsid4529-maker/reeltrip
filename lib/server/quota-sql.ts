// One statement snapshots both limits before atomically incrementing either.
// A rejected visitor must not be able to consume the global allocation.
export const QUOTA_SQL=`WITH allowed AS MATERIALIZED (
 SELECT COALESCE((SELECT count FROM usage_counters WHERE key=?),0) < ?
 AND COALESCE((SELECT count FROM usage_counters WHERE key=?),0) < ? AS ok
), wanted(key) AS (VALUES (?),(?))
INSERT INTO usage_counters (key,count,expires_at)
SELECT wanted.key,1,? FROM wanted,allowed WHERE allowed.ok=1
ON CONFLICT(key) DO UPDATE SET count=usage_counters.count+1 RETURNING count`;
