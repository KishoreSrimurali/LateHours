import { ensureSchema } from './_db.js';
import { requireAccount } from './_auth.js';
import { methodNotAllowed, unauthorized, withErrors } from './_util.js';

const DEFAULT_MODEL = 'gemini-2.0-flash';

/* Server-side proxy to Gemini so the API key never reaches the browser.
   Requires a signed-in session — without this an anonymous visitor could
   drive up the Google AI bill by hitting this endpoint directly.

   The request/response bodies here are Gemini's own shape
   (contents/parts, x-goog-api-key), but this endpoint still accepts and
   returns the same Anthropic-style shape the frontend sends
   (role/content messages in, {content: [{type, text}]} out) — App.jsx
   doesn't need to know which provider is actually behind /api/listener. */
export default withErrors(async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  await ensureSchema();
  const account = await requireAccount(req);
  if (!account) return unauthorized(res);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is not configured.' });
  }

  const { model, max_tokens, system, messages } = req.body || {};
  const modelId = model || process.env.GEMINI_MODEL || DEFAULT_MODEL;

  /* Gemini uses "model" where the rest of this app says "assistant", and
     takes the system prompt as a separate top-level field rather than a
     message in the list. */
  const contents = (Array.isArray(messages) ? messages : []).map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(m.content ?? '') }],
  }));

  const body = {
    contents,
    generationConfig: { maxOutputTokens: Math.min(Number(max_tokens) || 1000, 2000) },
  };
  if (typeof system === 'string' && system) {
    body.systemInstruction = { parts: [{ text: system }] };
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
    }
  );

  const data = await response.json();
  if (!response.ok) {
    return res.status(response.status).json({ error: data?.error?.message || 'Listener unavailable.' });
  }

  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  return res.status(200).json({ content: [{ type: 'text', text }] });
});
