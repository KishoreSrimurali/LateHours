import { ensureSchema, query } from './_db.js';
import { methodNotAllowed, withErrors } from './_util.js';

/* Public — the landing page shows this before anyone signs in. Both
   numbers are honest empty states (null) rather than an invented number:
   listenersOnline is null only if the query itself fails, and
   medianWaitSeconds is null until at least one real match has happened. */
export default withErrors(async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  await ensureSchema();

  const [{ rows: onlineRows }, { rows: waitRows }] = await Promise.all([
    query("SELECT count(*)::int AS n FROM queue WHERE role = 'listener' AND status = 'available'"),
    query(
      `SELECT wait_seconds FROM calls
       WHERE created_at > now() - interval '2 hours'
       ORDER BY created_at DESC LIMIT 50`
    ),
  ]);

  let medianWaitSeconds = null;
  if (waitRows.length) {
    const sorted = waitRows.map((r) => r.wait_seconds).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    medianWaitSeconds = sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }

  return res.status(200).json({
    listenersOnline: onlineRows[0].n,
    medianWaitSeconds,
  });
});
