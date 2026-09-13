import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import * as cookie from 'cookie';
import { query } from './_db.js';

const COOKIE_NAME = 'lh_session';
const SESSION_DAYS = 30;

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET is not configured.');
  return s;
}

export function hashPassword(pw) {
  return bcrypt.hash(pw, 12);
}

export function verifyPassword(pw, hash) {
  return bcrypt.compare(pw, hash);
}

export function signSession(accountId) {
  return jwt.sign({ sub: accountId }, secret(), { expiresIn: `${SESSION_DAYS}d` });
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
   or garbled cookie — an expired/tampered token just means "not signed in". */
export function getSessionAccountId(req) {
  const token = readSessionToken(req);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, secret());
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
    email: row.email,
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
