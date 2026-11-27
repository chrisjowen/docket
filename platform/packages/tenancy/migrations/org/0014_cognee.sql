-- cognee (https://www.cognee.ai/), an optional projection: docket's cognee
-- adapter files a workspace's entities into a cognee dataset and cognifies
-- them into cognee's knowledge graph, and search asks it alongside Neo4j and
-- mem0. Off until a workspace turns it on. Cognify runs a model over every
-- new entity, so it is billed to the org's AI cap, inside this setting's own
-- monthly limit. Same ownership as 0001. Everything here goes with its
-- workspace.

-- One row per workspace that has ever been configured; none means off.
CREATE TABLE {{schema}}.cognee_settings (
  workspace_id text PRIMARY KEY REFERENCES {{schema}}.workspaces (id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  -- Search keeps cognee's chunks at least this similar to the question
  -- (cosine), so a question cognee holds nothing about is answered with nothing.
  floor numeric(3, 2) NOT NULL DEFAULT 0.58 CHECK (floor >= 0 AND floor <= 1),
  -- What cognify may spend in a calendar month (UTC), inside the org's cap.
  monthly_limit_usd numeric(10, 2) NOT NULL DEFAULT 2 CHECK (monthly_limit_usd >= 0),
  -- The newest outbox row the last successful cognee pass covered: a newer one means it is due.
  projected_through bigint,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON {{schema}}.cognee_settings TO {{org_role}};
