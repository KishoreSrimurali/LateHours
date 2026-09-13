import { ensureSchema } from './_db.js';
import { requireAccount } from './_auth.js';
import { methodNotAllowed, unauthorized, withErrors } from './_util.js';

/* Server-side proxy to OpenAI so the API key never reaches the browser.
   Requires a signed-in session — without this an anonymous visitor could
   drive up the OpenAI bill by hitting this endpoint directly. */
export default withErrors(async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  await ensureSchema();
  const account = await requireAccount(req);
  if (!account) return unauthorized(res);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY is not configured.' });
  }

  const { model, max_tokens, system, messages } = req.body || {};

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || process.env.OPENAI_MODEL || 'gpt-4o-mini',
      max_tokens: Math.min(Number(max_tokens) || 1000, 2000),
      messages: [
        ...(typeof system === 'string' && system ? [{ role: 'system', content: system }] : []),
        ...(Array.isArray(messages) ? messages : []),
      ],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    return res.status(response.status).json({ error: data?.error?.message || 'Listener unavailable.' });
  }

  /* Normalized to the same shape the frontend already expects (an
     Anthropic-style content array), so App.jsx doesn't need to know
     which provider is behind this endpoint. */
  const text = data.choices?.[0]?.message?.content ?? '';
  return res.status(200).json({ content: [{ type: 'text', text }] });
});
