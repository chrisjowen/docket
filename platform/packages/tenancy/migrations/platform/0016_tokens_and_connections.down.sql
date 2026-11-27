-- Reverts platform 0016, for rolling back to a build before it. Run by hand as
-- the migration owner, in one transaction; the runner never applies it. Nothing
-- gains access: a token goes back to the one docket it named and to the scopes
-- read-only or its ceiling says, and one that reached every docket or several
-- is revoked, since the old shape names one. A connection's grant made since
-- 0016 carries every scope, the connection narrowing it; one that read only or
-- kept a ceiling, or reached several dockets, goes with every token under it.
-- No person acts for a system account again until an admin names one.
ALTER TABLE platform.api_tokens ADD COLUMN workspace_id text;
UPDATE platform.api_tokens SET revoked_at = coalesce(revoked_at, now()), revoked_by = coalesce(revoked_by, 'rollback')
 WHERE dockets IS NULL OR cardinality(dockets) > 1;
UPDATE platform.api_tokens SET workspace_id = coalesce(dockets[1], '-');
ALTER TABLE platform.api_tokens ALTER COLUMN workspace_id SET NOT NULL;
UPDATE platform.api_tokens SET legacy_scopes = CASE
    WHEN legacy_scopes IS NOT NULL THEN legacy_scopes
    WHEN read_only THEN ARRAY['docket:read', 'ontology:read']
    ELSE ARRAY['docket:read', 'docket:write', 'ontology:read', 'ontology:propose', 'ontology:write'] END;
ALTER TABLE platform.api_tokens DROP CONSTRAINT api_tokens_legacy_scopes_check;
ALTER TABLE platform.api_tokens ALTER COLUMN legacy_scopes SET NOT NULL;
ALTER TABLE platform.api_tokens RENAME COLUMN legacy_scopes TO scopes;
ALTER TABLE platform.api_tokens ADD CONSTRAINT api_tokens_scopes_check CHECK (
  cardinality(scopes) > 0 AND scopes <@ ARRAY['docket:read', 'docket:write', 'ontology:read', 'ontology:propose', 'ontology:write']
);
-- A system account's token that outlives the old 90-day limit is cut to it.
UPDATE platform.api_tokens SET expires_at = created_at + interval '90 days' WHERE expires_at > created_at + interval '90 days';
ALTER TABLE platform.api_tokens DROP CONSTRAINT api_tokens_expires_at_check;
ALTER TABLE platform.api_tokens ADD CONSTRAINT api_tokens_check CHECK (expires_at <= created_at + interval '90 days');
DROP INDEX platform.api_tokens_dockets;
DROP INDEX platform.api_tokens_org;
ALTER TABLE platform.api_tokens DROP COLUMN read_only, DROP COLUMN dockets;
CREATE INDEX api_tokens_workspace ON platform.api_tokens (org_id, workspace_id, created_at DESC);

DELETE FROM platform.oauth_store WHERE grant_id IN (
  SELECT grant_id FROM platform.oauth_connections
   WHERE read_only OR legacy_scopes IS NOT NULL OR dockets IS NULL OR cardinality(dockets) > 1
);
DROP TABLE platform.oauth_connections;

DELETE FROM platform.schema_migrations WHERE schema_name = 'platform' AND version = 16;
