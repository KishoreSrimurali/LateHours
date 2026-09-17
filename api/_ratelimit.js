import { query } from './_db.js';

/* Best-effort IP extraction. Vercel's edge network sets x-forwarded-for
   (client IP first, then any intermediate proxies); local `vercel dev`
   falls back to the raw socket address. Never throws — an unresolvable
   IP just becomes a shared "unknown" bucket rather than failing the
   request outright. */
export function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

/* Fixed-window counter, shared across every warm serverless instance via
   Postgres (an in-memory counter would reset on every cold start and
   wouldn't be shared across concurrent instances in the first place —
   no good for something that has to hold under a real brute-force burst
   coming from many parallel requests). One row per key; the UPSERT is a
   single atomic statement, so two requests racing to increment the same
   key can't both read-then-write a stale count.

   Returns { allowed, retryAfter } — retryAfter is only meaningful when
   allowed is false, and is seconds until the current window resets. */
export async function checkRateLimit(key, limit, windowSeconds) {
  const { rows } = await query(
    `INSERT INTO rate_limits (key, count, window_start)
     VALUES ($1, 1, now())
     ON CONFLICT (key) DO UPDATE SET
       count = CASE
         WHEN rate_limits.window_start < now() - ($2 || ' seconds')::interval THEN 1
         ELSE rate_limits.count + 1
       END,
       window_start = CASE
         WHEN rate_limits.window_start < now() - ($2 || ' seconds')::interval THEN now()
         ELSE rate_limits.window_start
       END
     RETURNING count, window_start`,
    [key, String(windowSeconds)]
  );
  const row = rows[0];
  const elapsed = (Date.now() - new Date(row.window_start).getTime()) / 1000;
  const retryAfter = Math.max(1, Math.ceil(windowSeconds - elapsed));
  return { allowed: row.count <= limit, retryAfter };
}
