-- VirtualEdge database schema
-- Mirrors the former localStorage keys:
--   ve_users -> users, ve_partners -> partners, ve_pushed -> pushed_picks,
--   ve_purchases -> purchases, ve_results -> results, ve_credits -> credits,
--   ve_payment_config -> payment_config

CREATE TABLE IF NOT EXISTS users (
  email          TEXT PRIMARY KEY,
  name           TEXT NOT NULL DEFAULT '',
  pw_hash        TEXT NOT NULL,
  plan           TEXT,
  plan_end       BIGINT,                       -- epoch ms, matches old planEnd
  ref            TEXT,                          -- referral code captured at signup
  partner        TEXT,                          -- partner code this member is attributed to
  sporty_account TEXT,                          -- linked SportyBet account number
  unlimited_until BIGINT,                        -- epoch ms; unlimited predictions while now < this
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- add the columns on existing databases too (idempotent)
ALTER TABLE users ADD COLUMN IF NOT EXISTS sporty_account TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS unlimited_until BIGINT;

CREATE TABLE IF NOT EXISTS partners (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL DEFAULT '',
  email       TEXT UNIQUE NOT NULL,
  pw_hash     TEXT NOT NULL,
  code        TEXT UNIQUE NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  locked      BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  locked_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS pushed_picks (
  id            SERIAL PRIMARY KEY,
  member_email  TEXT NOT NULL,
  home          TEXT NOT NULL,
  away          TEXT NOT NULL,
  outcome       TEXT NOT NULL,               -- 'home' | 'draw' | 'away'
  label         TEXT NOT NULL,
  odds          NUMERIC,
  from_code     TEXT,                         -- partner code or 'ADMIN'
  from_name     TEXT,
  used          BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pushed_member ON pushed_picks(member_email);
CREATE INDEX IF NOT EXISTS idx_pushed_from   ON pushed_picks(from_code);

CREATE TABLE IF NOT EXISTS purchases (
  id           SERIAL PRIMARY KEY,
  email        TEXT NOT NULL,
  pkg          TEXT,                          -- package label e.g. "GHS 500"
  reference    TEXT,                          -- payment reference
  predictions  INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_purchases_email ON purchases(email);

CREATE TABLE IF NOT EXISTS results (
  id           SERIAL PRIMARY KEY,
  email        TEXT,
  data         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credits (
  email   TEXT PRIMARY KEY,
  amount  INTEGER NOT NULL DEFAULT 0
);

-- Tracks screenshot-scan usage so the admin knows when to top up API credits.
CREATE TABLE IF NOT EXISTS scan_meter (
  id        INTEGER PRIMARY KEY DEFAULT 1,
  used      BIGINT NOT NULL DEFAULT 0,   -- total scans performed (info)
  remaining BIGINT NOT NULL DEFAULT 0,   -- scans left; admin tops this up
  CONSTRAINT scan_singleton CHECK (id = 1)
);
INSERT INTO scan_meter (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS payment_config (
  id          INTEGER PRIMARY KEY DEFAULT 1,
  provider    TEXT DEFAULT 'paystack',
  currency    TEXT DEFAULT 'GHS',
  public_key  TEXT DEFAULT '',
  secret_key  TEXT DEFAULT '',
  business    TEXT DEFAULT 'VirtualEdge',
  CONSTRAINT singleton CHECK (id = 1)
);
INSERT INTO payment_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
