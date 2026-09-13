-- Late Hours — reference schema.
--
-- You do not need to run this by hand: api/_db.js runs the equivalent
-- `CREATE TABLE IF NOT EXISTS` statements on cold start. It's kept here so
-- the shape of the data is readable in one place, and so you can run it
-- yourself against a fresh database if you'd rather provision schema
-- out-of-band from the app.

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  handle TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'seeker',           -- seeker | listener | both
  topics TEXT[] NOT NULL DEFAULT '{}',
  mode TEXT NOT NULL DEFAULT 'voice',             -- voice | video | text
  lang TEXT NOT NULL DEFAULT 'English',
  trained BOOLEAN NOT NULL DEFAULT false,
  training_done INTEGER[] NOT NULL DEFAULT '{}',  -- indices into the TRAINING lessons
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
  blocked_handle TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, blocked_handle)
);

CREATE TABLE IF NOT EXISTS reports (
  id BIGSERIAL PRIMARY KEY,
  reporter_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  call_id TEXT,
  reported_handle TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one open row per account: joining the queue again (a duplicate
-- tab, a listener toggling available twice) replaces the old row instead
-- of stacking a second one behind it.
CREATE TABLE IF NOT EXISTS queue (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  role TEXT NOT NULL,             -- seeker | listener
  handle TEXT NOT NULL,
  topics TEXT[] NOT NULL DEFAULT '{}',
  lang TEXT NOT NULL DEFAULT 'English',
  mode TEXT NOT NULL DEFAULT 'voice',
  status TEXT NOT NULL DEFAULT 'waiting', -- waiting | available
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS calls (
  id TEXT PRIMARY KEY,
  seeker_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  listener_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  wait_seconds INTEGER NOT NULL DEFAULT 0, -- how long the seeker waited before this match
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
