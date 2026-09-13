import { ensureSchema, query } from './_db.js';
import { requireAccount } from './_auth.js';
import { sanitize, methodNotAllowed, unauthorized, badRequest, withErrors } from './_util.js';

const REASONS = [
  'Harassment or abuse',
  'Sexual content',
  'Trying to get personal details',
  'Selling something',
  'Someone is in danger',
];

/* Reports go into a table a moderator reads, not back to the reported
   person — the UI's promise ("X isn't told who reported them") holds
   because nothing here ever surfaces reporter_id to anyone but that
   moderator tooling. */
export default withErrors(async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  await ensureSchema();
  const account = await requireAccount(req);
  if (!account) return unauthorized(res);

  const body = req.body || {};
  const reason = REASONS.includes(body.reason) ? body.reason : null;
  const reportedHandle = sanitize(body.reportedHandle, 40).trim();
  const callId = body.callId ? sanitize(body.callId, 60) : null;

  if (!reason) return badRequest(res, 'Pick one of the listed reasons.');
  if (!reportedHandle) return badRequest(res, 'Missing who is being reported.');

  await query(
    'INSERT INTO reports (reporter_id, call_id, reported_handle, reason) VALUES ($1, $2, $3, $4)',
    [account.id, callId, reportedHandle, reason]
  );
  return res.status(201).json({ ok: true });
});
