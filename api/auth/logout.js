import { clearSessionCookie, getSessionAccountId } from '../_auth.js';
import { methodNotAllowed, withErrors } from '../_util.js';
import { query } from '../_db.js';

export default withErrors(async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  /* Best-effort: also drop this account out of the matching queue so a
     listener who closes the tab instead of clicking "stop" doesn't stay
     "available" forever. */
  const id = getSessionAccountId(req);
  if (id) {
    await query('DELETE FROM queue WHERE account_id = $1', [id]).catch(() => {});
  }

  clearSessionCookie(req, res);
  return res.status(200).json({ ok: true });
});
