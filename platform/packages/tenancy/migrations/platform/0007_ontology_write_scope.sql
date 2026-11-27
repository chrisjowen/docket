-- `ontology:write`: an API token may carry it, to publish a workspace's
-- ontology over MCP where the workspace's settings let its owner's role.
ALTER TABLE platform.api_tokens DROP CONSTRAINT api_tokens_scopes_check;
ALTER TABLE platform.api_tokens ADD CONSTRAINT api_tokens_scopes_check CHECK (
  cardinality(scopes) > 0 AND scopes <@ ARRAY['docket:read', 'docket:write', 'ontology:read', 'ontology:propose', 'ontology:write']
);
