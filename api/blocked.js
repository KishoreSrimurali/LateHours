import { ensureSchema, query } from './_db.js';
import { requireAccount } from './_auth.js';
import { sanitize, methodNotAllowed, unauthorized, badRequest, withErrors } from './_util.js';

export default withErrors(async function handler(req, res) {
  await ensureSchema();
  const account = await requireAccount(req);
  if (!account) return unauthorized(res);

  if (req.method === 'GET') {
    const { rows } = await query(
      'SELECT blocked_handle FROM blocked WHERE account_id = $1 ORDER BY created_at ASC',
      [account.id]
    );
    return res.status(200).json({ blocked: rows.map((r) => r.blocked_handle) });
  }

  if (req.method === 'POST') {
    const handle = sanitize((req.body || {}).handle, 40).trim();
    if (!handle) return badRequest(res, 'Missing handle.');
    await query(
      `INSERT INTO blocked (account_id, blocked_handle) VALUES ($1, $2)
       ON CONFLICT (account_id, blocked_handle) DO NOTHING`,
      [account.id, handle]
    );
    return res.status(201).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const handle = sanitize((req.query || {}).handle, 40).trim();
    if (!handle) return badRequest(res, 'Missing handle.');
    await query('DELETE FROM blocked WHERE account_id = $1 AND blocked_handle = $2', [account.id, handle]);
    return res.status(200).json({ ok: true });
  }

  return methodNotAllowed(res, ['GET', 'POST', 'DELETE']);
});
