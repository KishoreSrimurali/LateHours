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
   want TLS; local Postgres during `vercel dev` usually doesn't advertise a
   cert, so we don't fail closed on an unverifiable chain. */
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
        : { rejectUnauthorized: false },
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
    /* All of this used to be nine separate awaited round trips — on a
       cold start that's nine sequential network hops to Postgres before
       the function can answer anything at all, which is real, visible
       latency (worse still if Neon's own instance has to wake from
       autosuspend on the same request). None of these statements take
       parameters, so the simple query protocol can run them all as one
       round trip instead — Postgres executes a semicolon-separated batch
       server-side in order, same as before, just without paying network
       latency nine times over.

       blocked is keyed on the blocked account's stable id, not their
       handle — a handle can be changed any time from Settings, and a
       block that stopped working the moment someone renamed themselves
       wouldn't be much of a block. blocked_handle is kept only as a
       label for the "Blocked" list in Settings; matching logic never
       reads it. The ALTER/CREATE INDEX pair patches a `blocked` table
       created before blocked_account_id existed — CREATE TABLE IF NOT
       EXISTS alone only helps a brand-new database, and every match
       attempt queries that column, so a stale table would 500 on every
       single queue join otherwise. queue: one open row per account while
       waiting or available — the unique index makes "join" an upsert, so
       a listener going available twice, or a seeker whose earlier tab
       never left, can't create a duplicate that quietly out-waits the
       real one. */
    await query(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
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

      CREATE TABLE IF NOT EXISTS moods (
        id BIGSERIAL PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        value SMALLINT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

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

      CREATE TABLE IF NOT EXISTS blocked (
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        blocked_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        blocked_handle TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (account_id, blocked_account_id)
      );
      ALTER TABLE blocked ADD COLUMN IF NOT EXISTS blocked_account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE;
      CREATE UNIQUE INDEX IF NOT EXISTS blocked_account_pair_idx ON blocked (account_id, blocked_account_id);

      CREATE TABLE IF NOT EXISTS reports (
        id BIGSERIAL PRIMARY KEY,
        reporter_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
        call_id TEXT,
        reported_handle TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

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

      CREATE TABLE IF NOT EXISTS calls (
        id TEXT PRIMARY KEY,
        seeker_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        listener_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        mode TEXT NOT NULL,
        wait_seconds INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
