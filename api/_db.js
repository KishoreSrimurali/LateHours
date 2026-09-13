import pg from 'pg';

const { Pool } = pg;

let pool;

/* One pool per warm serverless instance. Neon/Vercel Postgres/Supabase all
   want TLS; local Postgres during `vercel dev` usually doesn't advertise a
   cert, so we don't fail closed on an unverifiable chain. */
function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not configured.');
    }
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
    `);
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
