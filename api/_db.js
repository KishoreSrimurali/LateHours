import pg from 'pg';

const { Pool } = pg;

let pool;

/* Neon (and some other providers) append `channel_binding=require` to the
   connection string they hand you. That's a libpq-specific flag asking
   for SCRAM channel binding tied to the TLS certificate — node-postgres
   doesn't implement it, and depending on version either ignores it or
   trips over it, which shows up as intermittent connection failures
   rather than a clean, consistent error. TLS itself is still enforced
   below via the `ssl` option, so dropping this parameter loses nothing;
   it just stops asking node-postgres for something it can't do. */
function stripChannelBinding(connectionString) {
  try {
    const url = new URL(connectionString);
    url.searchParams.delete('channel_binding');
    return url.toString();
  } catch {
    // Not a parseable URL for some reason — pass it through unchanged
    // rather than fail the whole connection over a cosmetic cleanup.
    return connectionString;
  }
}

/* One pool per warm serverless instance. Neon/Vercel Postgres/Supabase all
   terminate TLS with certificates that chain to a public CA already in
   Node's trust store, so the default here verifies the chain
   (rejectUnauthorized: true) — an unverified connection is exactly the
   shape a MITM on the DB traffic would use, and it costs nothing to
   check.

   Local Postgres during `vercel dev` usually doesn't speak TLS at all;
   append `?sslmode=disable` to DATABASE_URL for that case (documented in
   .env.example) rather than weakening the default for everyone. */
function getPool() {
  if (!pool) {
    const raw = process.env.DATABASE_URL;
    if (!raw) {
      throw new Error('DATABASE_URL is not configured.');
    }
    const connectionString = stripChannelBinding(raw);
    pool = new Pool({
      connectionString,
      ssl: connectionString.includes('sslmode=disable')
        ? false
        : { rejectUnauthorized: true },
      max: 5,
    });
  }
  return pool;
}

export async function query(text, params) {
  const p = getPool();
  return p.query(text, params);
}

/* A checked-out client for hand-rolled transactions (BEGIN/COMMIT) — the
   matching logic needs SELECT ... FOR UPDATE SKIP LOCKED, which only makes
   sense on one held connection, not the pool's per-query round robin.
   Callers must release() it. */
export async function getClient() {
  const p = getPool();
  return p.connect();
}

/* Idempotent bootstrap. Runs once per cold start (cached on globalThis so
   concurrent invocations on the same instance don't race), then never
   again for the life of the instance. Ids are app-generated (crypto.randomUUID)
   rather than a Postgres UUID type, so no extension needs to be enabled on
   whichever provider DATABASE_URL points at.

   A failed attempt is NOT cached: it's only recorded as done once every
   statement below has actually succeeded. Concurrent calls that land
   while an attempt is in flight share that one attempt (the point of
   caching in the first place); a later call that arrives after a failed
   attempt gets to retry from scratch, rather than every request on this
   warm instance replaying the same stale rejection until Vercel happens
   to recycle the container. */
let migrated = globalThis.__lateHoursMigrated || null;

export async function ensureSchema() {
  if (migrated) return migrated;
  const attempt = (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        handle TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'seeker',
        topics TEXT[] NOT NULL DEFAULT '{}',
        mode TEXT NOT NULL DEFAULT 'voice',
        lang TEXT NOT NULL DEFAULT 'English',
        trained BOOLEAN NOT NULL DEFAULT false,
        training_done INTEGER[] NOT NULL DEFAULT '{}',
        blur_video BOOLEAN NOT NULL DEFAULT false,
        new_listeners BOOLEAN NOT NULL DEFAULT true,
        prompts BOOLEAN NOT NULL DEFAULT true,
        time_warn BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    /* Login moved from email to username. CREATE TABLE IF NOT EXISTS only
       shapes a brand-new database — a table created back when this column
       was `email TEXT UNIQUE NOT NULL` keeps that shape forever otherwise.
       Add the new column (nullable — ALTER TABLE can't add a NOT NULL
       column to a table that may already hold rows) and drop the old one;
       DROP COLUMN also drops whatever UNIQUE constraint/index was tied to
       it, so there's nothing stale left pointing at email. Uniqueness is
       enforced case-insensitively via a functional index below rather
       than a plain UNIQUE constraint on the column, so "Sage" and "sage"
       can't both sign up — the same reasoning as the lower(email) compare
       login used to do by lower-casing before every query. */
    await query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS username TEXT;`);
    await query(`ALTER TABLE accounts DROP COLUMN IF EXISTS email;`);
    await query(`CREATE UNIQUE INDEX IF NOT EXISTS accounts_username_lower_idx ON accounts (lower(username));`);
    await query(`
      CREATE TABLE IF NOT EXISTS moods (
        id BIGSERIAL PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        value SMALLINT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS sessions_log (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        peer_handle TEXT NOT NULL,
        is_ai BOOLEAN NOT NULL DEFAULT false,
        mode TEXT NOT NULL,
        seconds INTEGER NOT NULL DEFAULT 0,
        rating SMALLINT NOT NULL DEFAULT 0,
        kudos TEXT[] NOT NULL DEFAULT '{}',
        note TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    /* Keyed on the blocked account's stable id, not their handle — a handle
       can be changed any time from Settings, and a block that stopped
       working the moment someone renamed themselves wouldn't be much of a
       block. blocked_handle is kept only as a label for the "Blocked" list
       in Settings; matching logic never reads it. */
    await query(`
      CREATE TABLE IF NOT EXISTS blocked (
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        blocked_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        blocked_handle TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (account_id, blocked_account_id)
      );
    `);
    /* CREATE TABLE IF NOT EXISTS only helps a brand-new database — a
       `blocked` table created before blocked_account_id existed keeps its
       original shape forever otherwise, and every match attempt queries
       that column (it's what findMatch() in api/queue.js filters on),
       so a stale table 500s every single time someone tries to join the
       queue. Patch an old table up to the current shape here. Nullable
       (not NOT NULL) since ALTER TABLE can't add a NOT NULL column to a
       table that may already hold rows; a plain unique index (rather
       than folding this into the primary key) is enough to satisfy the
       ON CONFLICT (account_id, blocked_account_id) clause in
       api/blocked.js without touching the existing primary key. */
    await query(`ALTER TABLE blocked ADD COLUMN IF NOT EXISTS blocked_account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE;`);
    await query(`CREATE UNIQUE INDEX IF NOT EXISTS blocked_account_pair_idx ON blocked (account_id, blocked_account_id);`);
    await query(`
      CREATE TABLE IF NOT EXISTS reports (
        id BIGSERIAL PRIMARY KEY,
        reporter_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
        call_id TEXT,
        reported_handle TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    /* One open row per account while it is waiting or available. A unique
       index on account_id means "join" is really an upsert — a listener who
       goes available twice, or a seeker whose earlier tab never left the
       queue, doesn't create a duplicate that quietly out-waits the real one. */
    await query(`
      CREATE TABLE IF NOT EXISTS queue (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        handle TEXT NOT NULL,
        topics TEXT[] NOT NULL DEFAULT '{}',
        lang TEXT NOT NULL DEFAULT 'English',
        mode TEXT NOT NULL DEFAULT 'voice',
        status TEXT NOT NULL DEFAULT 'waiting',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS calls (
        id TEXT PRIMARY KEY,
        seeker_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        listener_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        mode TEXT NOT NULL,
        wait_seconds INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    /* Backing store for api/_ratelimit.js's fixed-window counter — see
       there for why this lives in Postgres rather than memory. One row
       per (endpoint, identity) key; there's no foreign key here since a
       key can be an IP address with no associated account. */
    await query(`
      CREATE TABLE IF NOT EXISTS rate_limits (
        key TEXT PRIMARY KEY,
        count INTEGER NOT NULL DEFAULT 1,
        window_start TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    /* Backs the click-to-verify check on login/signup (api/auth/[action].js
       captcha/consumeCaptcha). A row is a still-unused, still-live token —
       consuming one is a single DELETE ... WHERE token = $1 AND expires_at
       > now() RETURNING token, so two requests racing to spend the same
       token can't both succeed (only the first DELETE actually removes a
       row; the second finds nothing). No foreign key: a token exists
       before anyone is signed in. */
    await query(`
      CREATE TABLE IF NOT EXISTS captcha_tokens (
        token TEXT PRIMARY KEY,
        expires_at TIMESTAMPTZ NOT NULL
      );
    `);
  })();

  migrated = attempt;
  try {
    await attempt;
    globalThis.__lateHoursMigrated = attempt;
    return attempt;
  } catch (err) {
    migrated = null;
    throw err;
  }
}
