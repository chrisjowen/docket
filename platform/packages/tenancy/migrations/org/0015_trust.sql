-- Trust set by policy (the docket trust design, docket 0.16): confidence comes
-- from the ontology's policies about sources, which test what is attested
-- about each source - a person's role, a repository's settings, a document's
-- status - and supersede is a scored proposal. Same ownership as 0001.

-- Supersede proposals. `docket_supersede` records a proposal at once, scored
-- by the workspace's policies; it is accepted, and the older record goes out
-- of date, only when its score clears the bar for the replaced record's type
-- (`trust.accept`). Until then it is pending and the older record stays
-- current. A member may reject a pending one, and an owner or admin accept it
-- regardless (`decided_by` records who; 'score' when its score carried it).
-- Accepted stays accepted. Supersessions recorded before are accepted, as
-- they always were: grandfathered, never scored again.
ALTER TABLE {{schema}}.supersessions
  ADD COLUMN status text NOT NULL DEFAULT 'accepted' CHECK (status IN ('pending', 'accepted', 'rejected')),
  ADD COLUMN score real CHECK (score BETWEEN 0 AND 1),
  ADD COLUMN threshold real CHECK (threshold BETWEEN 0 AND 1),
  ADD COLUMN updated_at timestamptz,
  ADD COLUMN decided_at timestamptz,
  ADD COLUMN decided_by text,
  ADD COLUMN grandfathered boolean NOT NULL DEFAULT true;
ALTER TABLE {{schema}}.supersessions ALTER COLUMN grandfathered SET DEFAULT false;
DROP INDEX {{schema}}.supersessions_live;
CREATE UNIQUE INDEX supersessions_live ON {{schema}}.supersessions (workspace_id, resource_id) WHERE lifted_at IS NULL AND status = 'accepted';
CREATE UNIQUE INDEX supersessions_pending ON {{schema}}.supersessions (workspace_id, resource_id) WHERE lifted_at IS NULL AND status = 'pending';

-- The people directory: what the org attests about each member as a source -
-- a role, a team, flags - for policies to test, in every workspace. Only an
-- owner or admin sets it. The member's login is kept beside it, as evidence
-- names people by it.
CREATE TABLE {{schema}}.member_attributes (
  user_id text PRIMARY KEY,
  login text NOT NULL,
  name text,
  attributes jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(attributes) = 'object'),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX member_attributes_login ON {{schema}}.member_attributes (lower(login));

-- The source registry: source instances the org has registered - a document
-- by its URL - with the attributes an owner or admin attests about them, such
-- as a document's status. An observation of an instance not registered here
-- is still scored; only what a writer may claim is known about it.
CREATE TABLE {{schema}}.source_registry (
  source text NOT NULL CHECK (source ~ '^[A-Za-z0-9_-]{1,64}$'),
  instance text NOT NULL CHECK (length(instance) BETWEEN 1 AND 2000),
  attributes jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(attributes) = 'object'),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, instance)
);

-- What GitHub says about a connected repository, read at each sync: a
-- connection attests these, never a writer.
ALTER TABLE {{schema}}.repo_connections
  ADD COLUMN visibility text CHECK (visibility IN ('public', 'private')),
  ADD COLUMN branch_protected boolean,
  ADD COLUMN attributes_synced_at timestamptz;

-- A change to the directory or the registry re-scores every workspace: the
-- worker projects confidence again.
ALTER TABLE {{schema}}.outbox DROP CONSTRAINT outbox_kind_check;
ALTER TABLE {{schema}}.outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN ('documents', 'ontology', 'rebuild', 'recheck', 'trust'));

GRANT SELECT, INSERT, UPDATE, DELETE ON {{schema}}.member_attributes, {{schema}}.source_registry TO {{org_role}};
