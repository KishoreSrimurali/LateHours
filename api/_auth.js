import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import * as cookie from 'cookie';
import { query } from './_db.js';

const COOKIE_NAME = 'lh_session';
const SESSION_DAYS = 30;

let warnedWeakSecret = false;

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET is not configured.');
  /* A short secret is brute-forceable offline against a captured JWT (the
     token itself isn't secret, only this key is) — warn once per warm
     instance rather than rejecting outright, since an already-deployed
     short-but-functioning secret shouldn't suddenly 500 every request. */
  if (s.length < 32 && !warnedWeakSecret) {
    warnedWeakSecret = true;
    console.warn('AUTH_SECRET is shorter than 32 characters — generate a longer one (see .env.example).');
  }
  return s;
}

export function hashPassword(pw) {
  return bcrypt.hash(pw, 12);
}

export function verifyPassword(pw, hash) {
  return bcrypt.compare(pw, hash);
}

export function signSession(accountId) {
  return jwt.sign({ sub: accountId }, secret(), { algorithm: 'HS256', expiresIn: `${SESSION_DAYS}d` });
}

function isHttps(req) {
  return (req.headers['x-forwarded-proto'] || '').includes('https') || process.env.NODE_ENV === 'production';
}

export function setSessionCookie(req, res, token) {
  res.setHeader(
    'Set-Cookie',
    cookie.serialize(COOKIE_NAME, token, {
      httpOnly: true,
      secure: isHttps(req),
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_DAYS * 24 * 60 * 60,
    })
  );
}

export function clearSessionCookie(req, res) {
  res.setHeader(
    'Set-Cookie',
    cookie.serialize(COOKIE_NAME, '', {
      httpOnly: true,
      secure: isHttps(req),
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    })
  );
}

function readSessionToken(req) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  const parsed = cookie.parse(raw);
  return parsed[COOKIE_NAME] || null;
}

/* Returns the authenticated account id, or null. Never throws on a missing
   or garbled cookie — an expired/tampered token just means "not signed in".

   `algorithms: ['HS256']` pins verification to exactly the algorithm this
   app signs with. jsonwebtoken already rejects an unsigned ("alg: none")
   token by default, but without this option verify() will still accept
   *whatever* algorithm the token's own header claims — pinning it here
   closes that off at the call site instead of relying on the library's
   current default staying safe forever. */
export function getSessionAccountId(req) {
  const token = readSessionToken(req);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, secret(), { algorithms: ['HS256'] });
    return payload.sub;
  } catch {
    return null;
  }
}

/* Row -> the shape the frontend already expects (see App.jsx's `user`
   object), never including password_hash. */
export function toPublicAccount(row) {
  return {
    id: row.id,
    username: row.username,
    handle: row.handle,
    role: row.role,
    topics: row.topics || [],
    mode: row.mode,
    lang: row.lang,
    trained: row.trained,
    trainingDone: row.training_done || [],
    blurVideo: row.blur_video,
    newListeners: row.new_listeners,
    prompts: row.prompts,
    timeWarn: row.time_warn,
  };
}

/* Loads the full account row for the current session, or null. */
export async function requireAccount(req) {
  const id = getSessionAccountId(req);
  if (!id) return null;
  const { rows } = await query('SELECT * FROM accounts WHERE id = $1', [id]);
  return rows[0] || null;
}
