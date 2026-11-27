-- Whose cognify the shared cognee service is running now. cognee calls its
-- model through the worker's cognify gateway, which bills each call to the org
-- and workspace holding the lease, inside that workspace's cognee limit and
-- the org's cap, and refuses every call while no one holds it. One row at
-- most: one cognify at a time across the platform. A pass renews `expires_at`
-- before each batch; once it is past - the pass ended, or its worker stopped -
-- the lease is given up only when cognee says the holder's dataset is no
-- longer cognifying, and until then it stays the holder's. Same ownership as
-- 0001.
CREATE TABLE platform.cognify_lease (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  org_id text NOT NULL REFERENCES platform.orgs (id) ON DELETE CASCADE,
  workspace_id text NOT NULL,
  -- The workspace's cognee limit when the lease was taken, in US dollars a month.
  monthly_limit_usd numeric(10, 2) NOT NULL CHECK (monthly_limit_usd >= 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  -- When the holder's workspace was shown stuck: its cognify ran on too long past its pass.
  stuck_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.cognify_lease TO {{app_role}};
