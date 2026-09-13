import { ensureSchema, query } from './_db.js';
import { requireAccount } from './_auth.js';
import { sanitize, methodNotAllowed, unauthorized, badRequest, withErrors } from './_util.js';

export default withErrors(async function handler(req, res) {
  await ensureSchema();
  const account = await requireAccount(req);
  if (!account) return unauthorized(res);

  if (req.method === 'GET') {
    const { rows } = await query(
      'SELECT blocked_account_id, blocked_handle FROM blocked WHERE account_id = $1 ORDER BY created_at ASC',
      [account.id]
    );
    return res.status(200).json({
      blocked: rows.map((r) => ({ accountId: r.blocked_account_id, handle: r.blocked_handle })),
    });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const blockedAccountId = sanitize(body.accountId, 100).trim();
    const handle = sanitize(body.handle, 40).trim();
    if (!blockedAccountId) return badRequest(res, 'Missing accountId.');
    if (!handle) return badRequest(res, 'Missing handle.');
    if (blockedAccountId === account.id) return badRequest(res, "You can't block yourself.");

    const target = await query('SELECT 1 FROM accounts WHERE id = $1', [blockedAccountId]);
    if (!target.rows.length) return badRequest(res, "That account doesn't exist.");

    await query(
      `INSERT INTO blocked (account_id, blocked_account_id, blocked_handle) VALUES ($1, $2, $3)
       ON CONFLICT (account_id, blocked_account_id) DO UPDATE SET blocked_handle = EXCLUDED.blocked_handle`,
      [account.id, blockedAccountId, handle]
    );
    return res.status(201).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const blockedAccountId = sanitize((req.query || {}).accountId, 100).trim();
    if (!blockedAccountId) return badRequest(res, 'Missing accountId.');
    await query('DELETE FROM blocked WHERE account_id = $1 AND blocked_account_id = $2', [account.id, blockedAccountId]);
    return res.status(200).json({ ok: true });
  }

  return methodNotAllowed(res, ['GET', 'POST', 'DELETE']);
});
