import crypto from 'node:crypto';
import { ensureSchema, query } from '../_db.js';
import { hashPassword, signSession, setSessionCookie, toPublicAccount } from '../_auth.js';
import { EMAIL_RE, TOPICS, LANGUAGES, MODES, ROLES, sanitize, methodNotAllowed, badRequest, withErrors } from '../_util.js';

export default withErrors(async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  await ensureSchema();

  const body = req.body || {};
  const email = sanitize(body.email, 254).trim().toLowerCase();
  const password = String(body.password ?? '');
  const handle = sanitize(body.handle, 18).trim();
  const role = ROLES.includes(body.role) ? body.role : 'seeker';
  const topics = Array.isArray(body.topics) ? body.topics.filter((t) => TOPICS.includes(t)) : [];
  const mode = MODES.includes(body.mode) ? body.mode : 'voice';
  const lang = LANGUAGES.includes(body.lang) ? body.lang : 'English';
  const age18 = body.age18 === true;

  if (!EMAIL_RE.test(email)) return badRequest(res, "That email address isn't complete.");
  if (password.length < 12) return badRequest(res, 'Passwords need at least 12 characters.');
  if (handle.length < 2) return badRequest(res, 'Pick a handle with at least 2 characters.');
  if (!age18) return badRequest(res, "Confirm you're 18 or older to continue.");
  if (topics.length === 0) return badRequest(res, 'Pick at least one topic.');

  const existing = await query('SELECT id FROM accounts WHERE email = $1', [email]);
  if (existing.rows.length) {
    return badRequest(res, 'An account already uses that email. Sign in instead.');
  }

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const { rows } = await query(
    `INSERT INTO accounts (id, email, password_hash, handle, role, topics, mode, lang)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [id, email, passwordHash, handle, role, topics, mode, lang]
  );

  setSessionCookie(req, res, signSession(id));
  return res.status(201).json({ account: toPublicAccount(rows[0]) });
});
