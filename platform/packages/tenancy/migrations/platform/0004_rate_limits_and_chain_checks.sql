-- Request limits (§12) and the nightly audit chain check (§10). Same ownership
-- as 0001: the migration owner owns the objects, the request role gets what
-- requests need.

-- One token bucket per limited key, for example `mcp:token:<id>` or
-- `mcp:org:<id>`. Every API replica takes from the same row, so two replicas
-- never allow twice the limit. A row idle for an hour is full again and is
-- pruned.
CREATE TABLE platform.rate_buckets (
  key text PRIMARY KEY CHECK (length(key) BETWEEN 1 AND 200),
  tokens double precision NOT NULL CHECK (tokens >= 0),
  updated_at timestamptz NOT NULL
);
CREATE INDEX rate_buckets_updated ON platform.rate_buckets (updated_at);

-- The latest verification of each audit log: `platform` for the platform's
-- own log, else an org id. The metrics endpoint reads it, so every replica
-- reports the same verdict.
CREATE TABLE platform.audit_verifications (
  scope text PRIMARY KEY,
  verified_at timestamptz NOT NULL,
  ok boolean NOT NULL,
  events bigint NOT NULL,
  broken_at text
);

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.rate_buckets TO {{app_role}};
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.audit_verifications TO {{app_role}};
