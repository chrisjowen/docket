-- The platform schema (§5.1): users, orgs, memberships, invites, sessions,
-- wrapped org keys and the platform audit stream. It runs as the migration
-- owner; the request role {{app_role}} gets DML on what requests need and no
-- access at all to any org schema unless it sets that org's role.

CREATE SCHEMA IF NOT EXISTS platform;
REVOKE ALL ON SCHEMA platform FROM PUBLIC;
GRANT USAGE ON SCHEMA platform TO {{app_role}};

CREATE TABLE platform.users (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('human', 'service')),
  github_id bigint UNIQUE,
  -- A human's GitHub login, or a service account's name.
  login text NOT NULL,
  login_lower text GENERATED ALWAYS AS (lower(login)) STORED,
  name text,
  email text,
  -- A human's verified GitHub emails, refreshed at each sign-in; invites by email match these.
  emails text[] NOT NULL DEFAULT '{}',
  avatar_url text,
  -- Service accounts belong to exactly one org (§4).
  service_org_id text,
  description text,
  created_by text REFERENCES platform.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  CHECK ((kind = 'human') = (github_id IS NOT NULL)),
  CHECK ((kind = 'service') = (service_org_id IS NOT NULL))
);
CREATE UNIQUE INDEX users_human_login ON platform.users (login_lower) WHERE kind = 'human';
CREATE UNIQUE INDEX users_service_name ON platform.users (service_org_id, login_lower) WHERE kind = 'service';

-- Who may sign in without an invite (§8.1). Logins are stored lowercase.
CREATE TABLE platform.beta_allowlist (
  github_login text PRIMARY KEY CHECK (github_login = lower(github_login)),
  note text,
  added_at timestamptz NOT NULL DEFAULT now()
);

-- People who signed in with GitHub but are not on the list, and what they asked.
CREATE TABLE platform.access_requests (
  id_hash text PRIMARY KEY,
  github_id bigint NOT NULL,
  github_login text NOT NULL,
  email text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  requested_at timestamptz
);

CREATE TABLE platform.orgs (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9]{1,40}$'),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  status text NOT NULL DEFAULT 'provisioning'
    CHECK (status IN ('provisioning', 'active', 'suspended', 'deleted')),
  -- The org schema's migration version. Requests refuse an org that is behind.
  schema_version integer NOT NULL DEFAULT 0,
  created_by text NOT NULL REFERENCES platform.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

ALTER TABLE platform.users
  ADD CONSTRAINT users_service_org FOREIGN KEY (service_org_id) REFERENCES platform.orgs (id) ON DELETE CASCADE;

CREATE TABLE platform.memberships (
  org_id text NOT NULL REFERENCES platform.orgs (id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES platform.users (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  -- A per-workspace override later (§4); null means the whole org.
  workspace_id text,
  invited_by text REFERENCES platform.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX memberships_user ON platform.memberships (user_id);

-- Invites by GitHub login or email; 7 days, single use (§8.1).
CREATE TABLE platform.invites (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES platform.orgs (id) ON DELETE CASCADE,
  github_login text CHECK (github_login = lower(github_login)),
  email text CHECK (email = lower(email)),
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  invited_by text NOT NULL REFERENCES platform.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by text REFERENCES platform.users (id),
  declined_at timestamptz,
  revoked_at timestamptz,
  CHECK ((github_login IS NULL) <> (email IS NULL))
);
CREATE INDEX invites_login ON platform.invites (github_login) WHERE accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL;
CREATE INDEX invites_email ON platform.invites (email) WHERE accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX invites_one_open_per_login ON platform.invites (org_id, github_login)
  WHERE accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX invites_one_open_per_email ON platform.invites (org_id, email)
  WHERE accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL;

-- Web sessions: only the SHA-256 of the cookie's id is stored (§8.1).
CREATE TABLE platform.sessions (
  id_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES platform.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ip text,
  user_agent text,
  revoked_at timestamptz
);
CREATE INDEX sessions_user ON platform.sessions (user_id);

-- Each org's data keys, wrapped by the KEK named in kek_id (§7.3).
CREATE TABLE platform.org_keys (
  org_id text NOT NULL REFERENCES platform.orgs (id) ON DELETE CASCADE,
  version integer NOT NULL,
  wrapped bytea NOT NULL,
  kek_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, version)
);

-- The platform's own audit log, for events outside any org (sign-in, failed
-- auth, org creation attempts). Same shape and hash chain as an org's.
CREATE TABLE platform.audit_event (
  seq bigserial PRIMARY KEY,
  id text NOT NULL UNIQUE,
  at timestamptz NOT NULL,
  org_id text,
  workspace_id text,
  actor text NOT NULL,
  ip text,
  user_agent text,
  action text NOT NULL,
  target text[] NOT NULL DEFAULT '{}',
  args_digest text,
  outcome text NOT NULL CHECK (outcome IN ('ok', 'denied', 'error', 'invalid')),
  latency_ms integer NOT NULL,
  request_id text NOT NULL,
  prev_hash text NOT NULL,
  hash text NOT NULL
);
CREATE TABLE platform.audit_head (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  hash text NOT NULL
);
INSERT INTO platform.audit_head (hash) VALUES (repeat('0', 64));

-- Every org's audit events, without targets, for platform operators (§10).
CREATE TABLE platform.audit_stream (
  org_id text NOT NULL,
  id text NOT NULL,
  at timestamptz NOT NULL,
  workspace_id text,
  actor text NOT NULL,
  action text NOT NULL,
  outcome text NOT NULL,
  latency_ms integer NOT NULL,
  request_id text NOT NULL,
  PRIMARY KEY (org_id, id)
);

-- Org audit tables mirror into the stream through this trigger function. It
-- runs as its owner, so an org role needs no privilege on the platform schema.
CREATE FUNCTION platform.mirror_audit_event() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = platform, pg_temp AS $$
BEGIN
  INSERT INTO platform.audit_stream (org_id, id, at, workspace_id, actor, action, outcome, latency_ms, request_id)
  VALUES (NEW.org_id, NEW.id, NEW.at, NEW.workspace_id, NEW.actor, NEW.action, NEW.outcome, NEW.latency_ms, NEW.request_id);
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION platform.mirror_audit_event() FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  platform.users, platform.beta_allowlist, platform.access_requests, platform.orgs,
  platform.memberships, platform.invites, platform.sessions
  TO {{app_role}};
GRANT SELECT, INSERT ON platform.org_keys TO {{app_role}};
-- Append-only: the request role can add audit events and read them, never change them (§10).
GRANT SELECT, INSERT ON platform.audit_event TO {{app_role}};
GRANT USAGE ON SEQUENCE platform.audit_event_seq_seq TO {{app_role}};
GRANT SELECT, UPDATE ON platform.audit_head TO {{app_role}};
GRANT SELECT ON platform.audit_stream TO {{app_role}};
