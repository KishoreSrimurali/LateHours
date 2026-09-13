import { ensureSchema, query } from '../_db.js';
import { verifyPassword, signSession, setSessionCookie, toPublicAccount } from '../_auth.js';
import { EMAIL_RE, sanitize, methodNotAllowed, badRequest, withErrors } from '../_util.js';

export default withErrors(async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  await ensureSchema();

  const body = req.body || {};
  const email = sanitize(body.email, 254).trim().toLowerCase();
  const password = String(body.password ?? '');

  if (!EMAIL_RE.test(email)) return badRequest(res, "That email address isn't complete.");

  const { rows } = await query('SELECT * FROM accounts WHERE email = $1', [email]);
  const account = rows[0];
  /* Same error either way — confirming that an email exists lets an
     attacker enumerate accounts. */
  const ok = account && (await verifyPassword(password, account.password_hash));
  if (!ok) return badRequest(res, "That email and password don't match.");

  setSessionCookie(req, res, signSession(account.id));
  return res.status(200).json({ account: toPublicAccount(account) });
});
