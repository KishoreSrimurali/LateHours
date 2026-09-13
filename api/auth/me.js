import { ensureSchema } from '../_db.js';
import { requireAccount, toPublicAccount } from '../_auth.js';
import { methodNotAllowed, withErrors } from '../_util.js';

export default withErrors(async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  await ensureSchema();

  const account = await requireAccount(req);
  if (!account) return res.status(200).json({ account: null });
  return res.status(200).json({ account: toPublicAccount(account) });
});
