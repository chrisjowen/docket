-- The beta waitlist: teams asking to join, from the landing page's form (an
-- email and a team) or by signing in with GitHub while not on the beta list.
-- One row per person: an email or a GitHub account joins once, and joining
-- again changes nothing. A platform admin reviews the list and invites from
-- it, which adds the entry's verified GitHub login to platform.beta_allowlist;
-- an entry from the form is invited once its person signs in with GitHub.

CREATE TABLE platform.waitlist (
  id text PRIMARY KEY,
  -- How the entry joined: the landing page's form, or GitHub sign-in.
  via text NOT NULL CHECK (via IN ('email', 'github')),
  email text CHECK (email = lower(email)),
  team_name text CHECK (length(team_name) BETWEEN 1 AND 120),
  team_size text CHECK (team_size IN ('1', '2-5', '6-20', '21-50', '51+')),
  -- Set when the person signed in with GitHub: their account, verified by GitHub.
  github_id bigint,
  -- The account's login, as GitHub last gave it: set exactly when github_id is.
  github_login text CHECK (github_login = lower(github_login)),
  note text CHECK (length(note) <= 1000),
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'invited')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  invited_at timestamptz,
  invited_by text REFERENCES platform.users (id),
  CHECK (email IS NOT NULL OR github_id IS NOT NULL),
  CHECK ((github_id IS NULL) = (github_login IS NULL)),
  CHECK (status = 'waiting' OR github_id IS NOT NULL),
  CHECK ((status = 'invited') = (invited_at IS NOT NULL))
);
CREATE UNIQUE INDEX waitlist_github_id ON platform.waitlist (github_id) WHERE github_id IS NOT NULL;
CREATE UNIQUE INDEX waitlist_email ON platform.waitlist (email) WHERE email IS NOT NULL;
CREATE INDEX waitlist_newest ON platform.waitlist (created_at DESC);

-- Everyone who already asked through the invite-only page joins the list once.
INSERT INTO platform.waitlist (id, via, email, github_id, github_login, note, created_at, updated_at)
SELECT DISTINCT ON (github_id)
  gen_random_uuid()::text, 'github', lower(email), github_id, lower(github_login), left(note, 1000),
  created_at, coalesce(requested_at, created_at)
FROM platform.access_requests
ORDER BY github_id, requested_at DESC NULLS LAST, created_at DESC
ON CONFLICT DO NOTHING;

GRANT SELECT, INSERT, UPDATE ON platform.waitlist TO {{app_role}};
