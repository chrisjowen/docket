-- This org's namespace grants follow its members' roles (platform 0013): the
-- trigger that grants a new workspace to its developers and read-only members,
-- and a resync for whatever changed since the 0016 backfill - members who
-- joined, workspaces made and roles changed - so each holds exactly today's
-- access when grants start being enforced.
INSERT INTO platform.namespace_grants (org_id, namespace_id, principal_id, permission)
SELECT '{{org_id}}', w.id, m.user_id, platform.derived_grant(m.account_role)
  FROM {{schema}}.workspaces w
  JOIN platform.memberships m ON m.org_id = '{{org_id}}' AND platform.derived_grant(m.account_role) IS NOT NULL
 WHERE w.deleted_at IS NULL
ON CONFLICT (org_id, namespace_id, principal_id) DO UPDATE SET permission = EXCLUDED.permission;

CREATE TRIGGER workspaces_grant_members AFTER INSERT ON {{schema}}.workspaces
  FOR EACH ROW EXECUTE FUNCTION platform.grant_namespace_members('{{org_id}}');
