import crypto from 'node:crypto';
import { ensureSchema, query } from './_db.js';
import { requireAccount } from './_auth.js';
import { MODES, sanitize, methodNotAllowed, unauthorized, badRequest, withErrors } from './_util.js';

/* This is the only place a finished conversation is ever written to
   storage, and only what PostCall collects: rating, kudos, and the
   seeker's own note. The conversation text itself is never sent here and
   is never persisted, matching the promise the UI already makes. */
export default withErrors(async function handler(req, res) {
  await ensureSchema();
  const account = await requireAccount(req);
  if (!account) return unauthorized(res);

  if (req.method === 'GET') {
    const { rows } = await query(
      `SELECT id, peer_handle, is_ai, mode, seconds, rating, kudos, note, created_at
       FROM sessions_log WHERE account_id = $1 ORDER BY created_at ASC`,
      [account.id]
    );
    return res.status(200).json({
      sessions: rows.map((r) => ({
        id: r.id,
        peer: r.peer_handle,
        isAI: r.is_ai,
        mode: r.mode,
        seconds: r.seconds,
        rating: r.rating,
        kudos: r.kudos || [],
        note: r.note || '',
      })),
    });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const peer = sanitize(body.peer, 40).trim();
    const mode = MODES.includes(body.mode) ? body.mode : 'text';
    const seconds = Number.isFinite(Number(body.seconds)) ? Math.max(0, Math.round(Number(body.seconds))) : 0;
    const rating = Number.isInteger(body.rating) ? Math.min(5, Math.max(0, body.rating)) : 0;
    const kudos = Array.isArray(body.kudos) ? body.kudos.map((k) => sanitize(k, 40)).slice(0, 10) : [];
    const note = sanitize(body.note, 2000);
    const isAI = body.isAI === true;

    if (!peer) return badRequest(res, 'A session needs to name who it was with.');

    const id = crypto.randomUUID();
    await query(
      `INSERT INTO sessions_log (id, account_id, peer_handle, is_ai, mode, seconds, rating, kudos, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, account.id, peer, isAI, mode, seconds, rating, kudos, note]
    );
    return res.status(201).json({ session: { id, peer, isAI, mode, seconds, rating, kudos, note } });
  }

  return methodNotAllowed(res, ['GET', 'POST']);
});
