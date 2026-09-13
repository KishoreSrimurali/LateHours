import { ensureSchema, query } from './_db.js';
import { requireAccount, toPublicAccount, clearSessionCookie } from './_auth.js';
import { TOPICS, LANGUAGES, MODES, sanitize, methodNotAllowed, unauthorized, withErrors } from './_util.js';

/* Whitelisted, column-by-column, rather than building SQL from whatever
   keys the client happens to send. Each entry validates/coerces its own
   value; anything that fails validation is silently dropped instead of
   erroring the whole request, so a client can send a partial patch. */
const FIELDS = {
  handle: (v) => {
    const h = sanitize(v, 18).trim();
    return h.length >= 2 ? h : undefined;
  },
  topics: (v) => (Array.isArray(v) ? v.filter((t) => TOPICS.includes(t)) : undefined),
  mode: (v) => (MODES.includes(v) ? v : undefined),
  lang: (v) => (LANGUAGES.includes(v) ? v : undefined),
  trained: (v) => (typeof v === 'boolean' ? v : undefined),
  trainingDone: (v) =>
    Array.isArray(v) ? [...new Set(v.filter((n) => Number.isInteger(n) && n >= 0 && n < 5))] : undefined,
  blurVideo: (v) => (typeof v === 'boolean' ? v : undefined),
  newListeners: (v) => (typeof v === 'boolean' ? v : undefined),
  prompts: (v) => (typeof v === 'boolean' ? v : undefined),
  timeWarn: (v) => (typeof v === 'boolean' ? v : undefined),
};

const COLUMN = {
  handle: 'handle',
  topics: 'topics',
  mode: 'mode',
  lang: 'lang',
  trained: 'trained',
  trainingDone: 'training_done',
  blurVideo: 'blur_video',
  newListeners: 'new_listeners',
  prompts: 'prompts',
  timeWarn: 'time_warn',
};

export default withErrors(async function handler(req, res) {
  await ensureSchema();
  const account = await requireAccount(req);
  if (!account) return unauthorized(res);

  if (req.method === 'GET') {
    return res.status(200).json({ account: toPublicAccount(account) });
  }

  if (req.method === 'PATCH') {
    const body = req.body || {};
    const sets = [];
    const values = [];
    for (const key of Object.keys(FIELDS)) {
      if (!(key in body)) continue;
      const value = FIELDS[key](body[key]);
      if (value === undefined) continue;
      values.push(value);
      sets.push(`${COLUMN[key]} = $${values.length}`);
    }
    if (sets.length === 0) {
      return res.status(200).json({ account: toPublicAccount(account) });
    }
    values.push(account.id);
    const { rows } = await query(
      `UPDATE accounts SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );
    return res.status(200).json({ account: toPublicAccount(rows[0]) });
  }

  if (req.method === 'DELETE') {
    await query('DELETE FROM accounts WHERE id = $1', [account.id]);
    clearSessionCookie(req, res);
    return res.status(200).json({ ok: true });
  }

  return methodNotAllowed(res, ['GET', 'PATCH', 'DELETE']);
});
