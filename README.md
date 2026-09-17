# Late Hours — Vercel-ready

Anonymous peer support: voice, video, or text with a trained human listener,
plus real accounts, mood check-ins, and conversation history. The frontend is
a Vite + React app; the backend is a set of Vercel serverless functions under
`api/` backed by Postgres, with Pusher handling real-time matching and
in-call chat.

## What's real here

- **Accounts** — username/password signup, bcrypt-hashed, JWT session in an
  httpOnly cookie. `api/auth/*.js`, `api/account.js`.
- **Click-to-verify on login/signup** — a self-hosted stand-in for a
  third-party CAPTCHA: the checkbox fetches a single-use, server-issued
  token at the moment it's clicked, and signup/login require and burn
  it. No third-party key needed. `api/auth/[action].js`.
- **Persistence** — moods, past-session history, and blocked handles are
  stored per account in Postgres and survive a reload. `api/moods.js`,
  `api/sessions.js`, `api/blocked.js`.
- **Matching** — a seeker joining the queue and a listener going available
  are matched in a single transactional query (`FOR UPDATE SKIP LOCKED`,
  language preferred, blocks respected in both directions); whoever's
  already waiting gets a Pusher push the instant a match is found.
  `api/queue.js`, `api/presence.js`.
- **In-call chat and real voice/video between two humans** — once
  matched, both browsers subscribe to a private Pusher channel scoped to
  that call. Chat travels as Pusher client events; voice and video are a
  real WebRTC connection, using that same channel only to exchange the
  SDP offer/answer and ICE candidates — the actual audio/video streams
  directly peer-to-peer once connected, never through the server.
  `api/pusher-auth.js` signs the subscription; `api/queue.js` tells each
  side which one creates the offer; the wiring lives in the `Call`
  component in `App.jsx`.
- **Reports** — go into a `reports` table for a moderator to read; the
  reported person is never told who filed it.

Conversation *text* itself is still never stored — only what `PostCall`
already collected (a rating, kudos, and the seeker's own private note).

## What's still missing

Real audio/video between two matched humans works via WebRTC, signaled
over the same private Pusher channel used for chat (SDP offer/answer and
ICE candidates only — the media itself flows directly peer-to-peer once
connected). It uses free public STUN servers only, no TURN relay. That's
enough for most home and mobile networks, but a call between two people
both behind a restrictive NAT (some corporate networks, carrier-grade
NAT) can fail to find a direct path and never connect. Adding a TURN
server (e.g. Twilio, Metered, or a self-hosted coturn) as a fallback
relay would close that gap, but isn't free to run, so it's left out here.

## Setup

1. Provision a Postgres database (Neon, Vercel Postgres, Supabase, etc.)
   and a free Pusher Channels app at pusher.com. In the Pusher app's
   dashboard, turn on **"Enable client events"** — that's what lets two
   matched humans' browsers chat directly.
2. Copy `.env.example` to `.env` and fill it in (see that file for what
   each variable is and where it comes from).
3. `npm install`

## Local development

```bash
npm install
npm run dev
```

`npm run dev` only serves the frontend (Vite doesn't run the `/api`
functions). To exercise the real backend locally, run this through the
Vercel CLI instead, which serves both together:

```bash
npm i -g vercel
vercel dev
```

## Deploy

1. Upload this repo to GitHub and import it into Vercel.
2. In Vercel → Project Settings → Environment Variables, add every
   variable from `.env.example`.
3. Deploy. Vercel builds the frontend with `npm run build` and picks up
   everything under `api/` as serverless functions automatically —
   `api/_*.js` files are shared helpers, not routes, since Vercel only
   turns files without a `_` prefix into endpoints.

The database schema is created automatically (idempotent
`CREATE TABLE IF NOT EXISTS` statements) the first time any function runs
after a cold start — see `api/_db.js`. `db/schema.sql` is a plain-SQL copy
of the same shape, kept for reference or for provisioning by hand.
