-- A docket's grants go with it (platform 0017): this org's workspaces table
-- drops them when a row is deleted. It replaces the trigger org 0016 attached
-- for the namespace grants platform 0017 retired. Same ownership as 0001.
DROP TRIGGER IF EXISTS workspaces_namespace_grants ON {{schema}}.workspaces;
CREATE TRIGGER workspaces_docket_grants AFTER DELETE ON {{schema}}.workspaces
  FOR EACH ROW EXECUTE FUNCTION platform.drop_docket_grants('{{org_id}}');
