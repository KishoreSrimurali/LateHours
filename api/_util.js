/* Shared helpers for the /api functions. Small and dependency-free on
   purpose — this file is imported by nearly every handler. */

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* Re-exported here (rather than importing ../shared/constants.js directly
   in every handler) so every existing `import { TOPICS } from './_util.js'`
   keeps working unchanged. */
export { TOPICS, LANGUAGES, MODES, ROLES } from '../shared/constants.js';

/* Same rule the client applies before anything is stored or shown back to
   another person — belt and braces, since a request can always skip the
   browser. */
export function sanitize(s, max = 2000) {
  return String(s ?? '')
    .slice(0, max)
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '');
}

export function methodNotAllowed(res, allowed) {
  res.setHeader('Allow', allowed.join(', '));
  return res.status(405).json({ error: 'Method not allowed' });
}

export function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

export function unauthorized(res) {
  return res.status(401).json({ error: 'Sign in required.' });
}

export function tooManyRequests(res, retryAfterSeconds) {
  res.setHeader('Retry-After', String(retryAfterSeconds));
  return res.status(429).json({ error: 'Too many attempts. Please wait and try again.' });
}

/* Wraps a handler so an unexpected throw (a bad env var, a dropped DB
   connection) becomes a 500 with a generic body instead of a raw stack
   trace leaking into the response. */
export function withErrors(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Something went wrong on our end.' });
      }
    }
  };
}
