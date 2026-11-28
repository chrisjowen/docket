-- Reverses 0022_account_limits: every account goes back to the beta's limits.
ALTER TABLE platform.orgs
  DROP COLUMN IF EXISTS max_members,
  DROP COLUMN IF EXISTS max_dockets,
  DROP COLUMN IF EXISTS suspended_at,
  DROP COLUMN IF EXISTS suspended_by,
  DROP COLUMN IF EXISTS suspended_reason;
