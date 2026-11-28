-- The operator console (tenancy v2 §3.5, phase 6.3): the platform operator
-- lists accounts, suspends and resumes them, and sets an account's own
-- limits on seats (people, system accounts and open invites) and dockets,
-- in place of the beta's (null: the beta's). Suspending records who, when
-- and why; a suspended account is not served, and nothing in it is lost.
ALTER TABLE platform.orgs
  ADD COLUMN max_members integer CHECK (max_members BETWEEN 1 AND 10000),
  ADD COLUMN max_dockets integer CHECK (max_dockets BETWEEN 1 AND 1000),
  ADD COLUMN suspended_at timestamptz,
  ADD COLUMN suspended_by text REFERENCES platform.users (id) ON DELETE SET NULL,
  ADD COLUMN suspended_reason text CHECK (length(suspended_reason) <= 300);
