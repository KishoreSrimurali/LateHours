import { ensureSchema, query } from './_db.js';
import { requireAccount } from './_auth.js';
import { methodNotAllowed, unauthorized, badRequest, withErrors } from './_util.js';

export default withErrors(async function handler(req, res) {
  await ensureSchema();
  const account = await requireAccount(req);
  if (!account) return unauthorized(res);

  if (req.method === 'GET') {
    const { rows } = await query(
      'SELECT value, created_at FROM moods WHERE account_id = $1 ORDER BY created_at ASC',
      [account.id]
    );
    return res.status(200).json({
      moods: rows.map((r) => ({ v: r.value, at: new Date(r.created_at).getTime() })),
    });
  }

  if (req.method === 'POST') {
    const value = Number((req.body || {}).v);
    if (!Number.isInteger(value) || value < 1 || value > 5) {
      return badRequest(res, 'Mood must be an integer from 1 to 5.');
    }
    const { rows } = await query(
      'INSERT INTO moods (account_id, value) VALUES ($1, $2) RETURNING value, created_at',
      [account.id, value]
    );
    return res.status(201).json({ mood: { v: rows[0].value, at: new Date(rows[0].created_at).getTime() } });
  }

  return methodNotAllowed(res, ['GET', 'POST']);
});
