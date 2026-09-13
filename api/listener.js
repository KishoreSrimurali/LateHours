import { ensureSchema } from './_db.js';
import { requireAccount } from './_auth.js';
import { methodNotAllowed, unauthorized, withErrors } from './_util.js';

/* Server-side proxy to Claude so the API key never reaches the browser.
   Requires a signed-in session — without this an anonymous visitor could
   drive up the Anthropic bill by hitting this endpoint directly. */
export default withErrors(async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  await ensureSchema();
  const account = await requireAccount(req);
  if (!account) return unauthorized(res);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured.' });
  }

  const { model, max_tokens, system, messages } = req.body || {};

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || 'claude-sonnet-4-6',
      max_tokens: Math.min(Number(max_tokens) || 1000, 2000),
      system: typeof system === 'string' ? system : '',
      messages: Array.isArray(messages) ? messages : [],
    }),
  });

  const data = await response.json();
  return res.status(response.status).json(data);
});
