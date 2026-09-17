import crypto from 'node:crypto';
import { ensureSchema, query } from '../_db.js';
import {
  hashPassword, verifyPassword, signSession, setSessionCookie, clearSessionCookie,
  getSessionAccountId, requireAccount, toPublicAccount,
} from '../_auth.js';
import { USERNAME_RE, TOPICS, LANGUAGES, MODES, ROLES, sanitize, methodNotAllowed, badRequest, tooManyRequests, withErrors } from '../_util.js';
import { checkRateLimit, clientIp } from '../_ratelimit.js';

/* One file covering /api/auth/signup, /login, /logout, /me — merged from
   four separate functions to stay under Vercel Hobby's 12-function-per-
   deployment cap. Vercel's [action] filename makes this a dynamic route;
   req.query.action carries which one was requested. Each action's own
   logic is unchanged from when it was its own file. */
export default withErrors(async function handler(req, res) {
  await ensureSchema();
  const { action } = req.query;

  if (action === 'signup') return signup(req, res);
  if (action === 'login') return login(req, res);
  if (action === 'logout') return logout(req, res);
  if (action === 'me') return me(req, res);
  return res.status(404).json({ error: 'Unknown auth action.' });
});

async function signup(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  /* Signup has no CAPTCHA or email verification in front of it, so
     without a limit here a script can mint accounts as fast as the DB
     will insert them. Generous enough that a shared office/campus IP
     signing several real people up in an hour won't get blocked. */
  const ipLimit = await checkRateLimit(`signup:ip:${clientIp(req)}`, 10, 60 * 60);
  if (!ipLimit.allowed) return tooManyRequests(res, ipLimit.retryAfter);

  const body = req.body || {};
  const username = sanitize(body.username, 32).trim();
  const password = String(body.password ?? '');
  const handle = sanitize(body.handle, 18).trim();
  const role = ROLES.includes(body.role) ? body.role : 'seeker';
  const topics = Array.isArray(body.topics) ? body.topics.filter((t) => TOPICS.includes(t)) : [];
  const mode = MODES.includes(body.mode) ? body.mode : 'voice';
  const lang = LANGUAGES.includes(body.lang) ? body.lang : 'English';
  const age18 = body.age18 === true;

  if (username.length < 3) return badRequest(res, 'Username needs at least 3 characters.');
  if (!USERNAME_RE.test(username)) return badRequest(res, 'Username can only use letters, numbers, underscore, hyphen, and period.');
  if (password.length < 8) return badRequest(res, 'Passwords need at least 8 characters.');
  if (handle.length < 2) return badRequest(res, 'Pick a handle with at least 2 characters.');
  if (!age18) return badRequest(res, "Confirm you're 18 or older to continue.");
  if (topics.length === 0) return badRequest(res, 'Pick at least one topic.');

  const existing = await query('SELECT id FROM accounts WHERE lower(username) = lower($1)', [username]);
  if (existing.rows.length) {
    return badRequest(res, 'That username is already taken. Sign in instead, or pick another.');
  }

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const { rows } = await query(
    `INSERT INTO accounts (id, username, password_hash, handle, role, topics, mode, lang)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [id, username, passwordHash, handle, role, topics, mode, lang]
  );

  setSessionCookie(req, res, signSession(id));
  return res.status(201).json({ account: toPublicAccount(rows[0]) });
}

async function login(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  /* Two independent limits: per-IP catches a script trying many usernames
     against one source, per-(IP+username) catches repeated guesses against
     one specific account without also locking out everyone else behind
     the same IP (a shared office network, a campus NAT). Checked before
     touching the DB for the real lookup so a lockout costs the attacker
     the same either way, regardless of whether the username exists. */
  const ip = clientIp(req);
  const ipLimit = await checkRateLimit(`login:ip:${ip}`, 20, 15 * 60);
  if (!ipLimit.allowed) return tooManyRequests(res, ipLimit.retryAfter);

  const body = req.body || {};
  const username = sanitize(body.username, 32).trim();
  const password = String(body.password ?? '');

  if (!username) return badRequest(res, 'Enter your username.');

  const acctLimit = await checkRateLimit(`login:acct:${ip}:${username.toLowerCase()}`, 8, 15 * 60);
  if (!acctLimit.allowed) return tooManyRequests(res, acctLimit.retryAfter);

  const { rows } = await query('SELECT * FROM accounts WHERE lower(username) = lower($1)', [username]);
  const account = rows[0];
  /* Same error either way — confirming that a username exists lets an
     attacker enumerate accounts. */
  const ok = account && (await verifyPassword(password, account.password_hash));
  if (!ok) return badRequest(res, "That username and password don't match.");

  setSessionCookie(req, res, signSession(account.id));
  return res.status(200).json({ account: toPublicAccount(account) });
}

async function logout(req, res) {
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
}

async function me(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const account = await requireAccount(req);
  if (!account) return res.status(200).json({ account: null });
  return res.status(200).json({ account: toPublicAccount(account) });
}
