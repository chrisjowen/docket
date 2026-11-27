-- This org's namespace grants (platform 0012): the backfill that keeps
-- today's access exactly, and the trigger that drops a workspace's grants
-- with it. Owners and admins need no grant, their account role covers every
-- namespace; everyone else reaches every live workspace today, at their role.
INSERT INTO platform.namespace_grants (org_id, namespace_id, principal_id, permission)
SELECT '{{org_id}}', w.id, m.user_id, CASE m.account_role WHEN 'developer' THEN 'write' ELSE 'read' END
  FROM {{schema}}.workspaces w
  JOIN platform.memberships m ON m.org_id = '{{org_id}}' AND m.account_role IN ('developer', 'read_only')
 WHERE w.deleted_at IS NULL
ON CONFLICT DO NOTHING;

CREATE TRIGGER workspaces_namespace_grants AFTER DELETE ON {{schema}}.workspaces
  FOR EACH ROW EXECUTE FUNCTION platform.drop_namespace_grants('{{org_id}}');
