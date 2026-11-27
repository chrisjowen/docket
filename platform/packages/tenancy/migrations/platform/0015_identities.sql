-- Sign-in providers beside GitHub: a person is a user, and each way they sign
-- in is an identity of that user, keyed by provider, issuer and subject (the
-- stable id the provider gives them: GitHub's numeric id, an OIDC `sub`, a
-- password login). Every provider resolves to the same users table, so
-- memberships, grants, tokens and the audit log do not care how someone
-- signed in. An identity is only ever attached to a user explicitly: nothing
-- links two identities because their emails match. Same ownership as 0001.
-- Reverted by 0015_identities.down.sql.

-- A human no longer needs a GitHub account; a service account still has none.
DO $$
DECLARE
  name text;
BEGIN
  FOR name IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'platform.users'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%github_id IS NOT NULL%'
  LOOP
    EXECUTE format('ALTER TABLE platform.users DROP CONSTRAINT %I', name);
  END LOOP;
END
$$;
ALTER TABLE platform.users ADD CONSTRAINT users_service_without_github CHECK (kind = 'human' OR github_id IS NULL);

CREATE TABLE platform.identities (
  provider text NOT NULL CHECK (provider IN ('github', 'oidc', 'password')),
  -- `github` for GitHub; the issuer URL for OIDC; `local` for passwords.
  issuer text NOT NULL CHECK (length(issuer) BETWEEN 1 AND 512),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
  user_id text NOT NULL REFERENCES platform.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  PRIMARY KEY (provider, issuer, subject)
);
CREATE INDEX identities_user ON platform.identities (user_id);

-- Every GitHub user already here has their GitHub identity.
INSERT INTO platform.identities (provider, issuer, subject, user_id, created_at, last_seen_at)
SELECT 'github', 'github', github_id::text, id, created_at, last_seen_at
  FROM platform.users WHERE github_id IS NOT NULL;

-- A password user's credential: only a salted scrypt hash, never the password.
CREATE TABLE platform.password_credentials (
  user_id text PRIMARY KEY REFERENCES platform.users (id) ON DELETE CASCADE,
  hash text NOT NULL CHECK (hash LIKE 'scrypt$%'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Who may sign in, and create an account, by something other than a GitHub
-- login (those stay in beta_allowlist): a verified email, every verified
-- email at a domain, or a login that is not a GitHub one. The server replaces
-- the list from its config at every start.
CREATE TABLE platform.signin_allowlist (
  kind text NOT NULL CHECK (kind IN ('email', 'domain', 'login')),
  value text NOT NULL CHECK (value = lower(value) AND length(value) BETWEEN 1 AND 254),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, value)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.identities, platform.password_credentials, platform.signin_allowlist TO {{app_role}};
