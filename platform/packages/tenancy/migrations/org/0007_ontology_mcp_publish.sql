-- Direct ontology changes over MCP: the roles whose `ontology:write`
-- credentials may publish this workspace's ontology from an MCP client, with
-- no review in the web app. Empty (the default) keeps MCP to proposals. Only
-- the org's owner changes it; viewers are never among them.
ALTER TABLE {{schema}}.workspaces
  ADD COLUMN ontology_mcp_roles text[] NOT NULL DEFAULT '{}'
    CHECK (ontology_mcp_roles <@ ARRAY['owner', 'admin', 'editor']::text[]);
