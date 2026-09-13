import { ensureSchema, query } from './_db.js';
import { requireAccount } from './_auth.js';
import { getPusher, userChannel } from './_pusher.js';
import { methodNotAllowed, unauthorized, badRequest, withErrors } from './_util.js';

/* Authorizes a browser to subscribe to its own private Pusher channels.
   Two shapes are allowed, and nothing else:
     - private-user-<accountId>  — only that account itself
     - private-call-<callId>     — only the two accounts in that call row
   pusher-js posts socket_id + channel_name as form data; Vercel's default
   body parser handles both that and JSON. */
export default withErrors(async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  await ensureSchema();
  const account = await requireAccount(req);
  if (!account) return unauthorized(res);

  const { socket_id: socketId, channel_name: channelName } = req.body || {};
  if (!socketId || !channelName) return badRequest(res, 'Missing socket_id or channel_name.');

  if (channelName === userChannel(account.id)) {
    const auth = getPusher().authorizeChannel(socketId, channelName);
    return res.status(200).json(auth);
  }

  const callMatch = /^private-call-(.+)$/.exec(channelName);
  if (callMatch) {
    const { rows } = await query(
      'SELECT 1 FROM calls WHERE id = $1 AND (seeker_id = $2 OR listener_id = $2)',
      [callMatch[1], account.id]
    );
    if (rows.length) {
      const auth = getPusher().authorizeChannel(socketId, channelName);
      return res.status(200).json(auth);
    }
  }

  return res.status(403).json({ error: "You can't subscribe to that channel." });
});
