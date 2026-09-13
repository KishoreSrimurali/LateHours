import crypto from 'node:crypto';
import { ensureSchema, getClient } from './_db.js';
import { requireAccount } from './_auth.js';
import { getPusher, userChannel } from './_pusher.js';
import { TOPICS, LANGUAGES, MODES, methodNotAllowed, unauthorized, badRequest, withErrors } from './_util.js';

/* Finds one open queue row of the opposite role and matches it against
   `self`, inside the transaction already open on `client`. Blocks in
   either direction are excluded by stable account id (not handle — a
   handle can be changed from Settings any time, and a block that stopped
   working the moment someone renamed themselves wouldn't be much of a
   block). A language match is preferred but not required, and FOR UPDATE
   SKIP LOCKED means two requests racing to match the same pool of
   listeners never both grab the same one. Returns the matched row, or
   null if nobody's free right now. */
async function findMatch(client, self, otherRole) {
  const { rows } = await client.query(
    `SELECT * FROM queue q
     WHERE q.role = $1 AND q.account_id <> $2
       AND NOT EXISTS (SELECT 1 FROM blocked b WHERE b.account_id = $2 AND b.blocked_account_id = q.account_id)
       AND NOT EXISTS (SELECT 1 FROM blocked b WHERE b.account_id = q.account_id AND b.blocked_account_id = $2)
     ORDER BY (q.lang = $3) DESC, q.created_at ASC
     LIMIT 1
     FOR UPDATE SKIP LOCKED`,
    [otherRole, self.id, self.lang]
  );
  return rows[0] || null;
}

export default withErrors(async function handler(req, res) {
  await ensureSchema();
  const account = await requireAccount(req);
  if (!account) return unauthorized(res);

  if (req.method === 'GET') {
    const client = await getClient();
    try {
      const { rows } = await client.query('SELECT * FROM queue WHERE account_id = $1', [account.id]);
      return res.status(200).json({ queued: rows[0] || null });
    } finally {
      client.release();
    }
  }

  if (req.method === 'DELETE') {
    const client = await getClient();
    try {
      await client.query('DELETE FROM queue WHERE account_id = $1', [account.id]);
      return res.status(200).json({ ok: true });
    } finally {
      client.release();
    }
  }

  if (req.method !== 'POST') return methodNotAllowed(res, ['GET', 'POST', 'DELETE']);

  const body = req.body || {};
  const role = body.role === 'listener' ? 'listener' : 'seeker';
  const topics = Array.isArray(body.topics) ? body.topics.filter((t) => TOPICS.includes(t)) : [];
  const lang = LANGUAGES.includes(body.lang) ? body.lang : account.lang;
  const mode = MODES.includes(body.mode) ? body.mode : account.mode;

  if (role === 'listener' && !(account.trained && (account.role === 'listener' || account.role === 'both'))) {
    return badRequest(res, 'Finish training before taking calls.');
  }
  if (role === 'seeker' && topics.length === 0) {
    return badRequest(res, 'Pick at least one topic so we know who to reach for.');
  }

  /* The DB transaction is fully isolated in its own try/catch/finally —
     it either commits a real match or rolls back, and nothing after this
     block can un-commit it. That matters because notifying over Pusher
     comes next, and a Pusher hiccup must never look like the match itself
     failed (it already happened and is real), nor trigger a ROLLBACK
     against a transaction that has already committed (a no-op that used
     to mask the real failure). */
  const client = await getClient();
  let matchResult;
  try {
    await client.query('BEGIN');
    const queueId = crypto.randomUUID();
    await client.query(
      `INSERT INTO queue (id, account_id, role, handle, topics, lang, mode, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (account_id) DO UPDATE
         SET id = EXCLUDED.id, role = EXCLUDED.role, handle = EXCLUDED.handle,
             topics = EXCLUDED.topics, lang = EXCLUDED.lang, mode = EXCLUDED.mode,
             status = EXCLUDED.status, created_at = now()`,
      [queueId, account.id, role, account.handle, topics, lang, mode, role === 'seeker' ? 'waiting' : 'available']
    );

    const other = await findMatch(client, { id: account.id, lang }, role === 'seeker' ? 'listener' : 'seeker');

    if (!other) {
      await client.query('COMMIT');
      matchResult = null;
    } else {
      await client.query('DELETE FROM queue WHERE account_id = ANY($1)', [[account.id, other.account_id]]);

      const seekerId = role === 'seeker' ? account.id : other.account_id;
      const seekerHandle = role === 'seeker' ? account.handle : other.handle;
      const listenerId = role === 'seeker' ? other.account_id : account.id;
      const listenerHandle = role === 'seeker' ? other.handle : account.handle;
      /* Whichever of the two had been queued longer is the one who actually
         waited — the other side just walked in and got matched instantly. */
      const seekerQueuedAt = role === 'seeker' ? new Date() : other.created_at;
      const waitSeconds = Math.max(0, Math.round((Date.now() - new Date(seekerQueuedAt).getTime()) / 1000));
      const callId = crypto.randomUUID();
      await client.query(
        `INSERT INTO calls (id, seeker_id, listener_id, mode, wait_seconds) VALUES ($1, $2, $3, $4, $5)`,
        [callId, seekerId, listenerId, mode, waitSeconds]
      );
      await client.query('COMMIT');
      matchResult = { callId, mode, seekerId, seekerHandle, listenerId, listenerHandle };
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  if (!matchResult) {
    return res.status(200).json({ matched: false });
  }

  const { callId, mode: matchedMode, seekerId, seekerHandle, listenerId, listenerHandle } = matchResult;
  const seekerPayload = {
    callId,
    mode: matchedMode,
    peer: { kind: 'human', id: listenerId, handle: listenerHandle, blurb: 'A trained peer listener.' },
  };
  const listenerPayload = {
    callId,
    mode: matchedMode,
    peer: { kind: 'human', id: seekerId, handle: seekerHandle, blurb: 'Someone who wants to talk.' },
  };

  /* Best-effort from here on: the match is already real and committed.
     If Pusher is unreachable or misconfigured, the caller still gets
     their own match info back directly in this response — only the
     other, already-waiting party depends on the push, and losing that
     notification is a real (logged) gap, not a reason to fail a match
     that already happened. */
  try {
    const pusher = getPusher();
    await Promise.all([
      pusher.trigger(userChannel(seekerId), 'matched', seekerPayload),
      pusher.trigger(userChannel(listenerId), 'matched', listenerPayload),
    ]);
  } catch (err) {
    console.error(`Pusher notify failed for call ${callId}:`, err);
  }

  const mine = account.id === seekerId ? seekerPayload : listenerPayload;
  return res.status(200).json({ matched: true, ...mine });
});
