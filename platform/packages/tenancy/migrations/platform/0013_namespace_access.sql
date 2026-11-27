-- Namespace access is enforced (tenancy design, phase 2): a request reads a
-- member's grants to decide what they reach in a namespace. Until grants are
-- managed on their own, they follow the org-wide role exactly, as the 0016
-- backfill set them: a developer writes and a read-only member reads every
-- live workspace. These triggers keep that true for members, workspaces and
-- role changes after the backfill, so enforcing grants takes no one's access
-- away. Owners and admins need no grant; guests and provisioners get none.
-- Same ownership as 0001. Reverted by 0013_namespace_access.down.sql.

GRANT SELECT ON platform.namespace_grants TO {{app_role}};

-- The permission an account role's derived grants carry, or null for a role
-- that holds none.
CREATE FUNCTION platform.derived_grant(account_role text) RETURNS text
  LANGUAGE sql IMMUTABLE SET search_path = platform, pg_temp AS $$
  SELECT CASE account_role WHEN 'developer' THEN 'write' WHEN 'read_only' THEN 'read' END
$$;

-- A member who joins, or whose account role changes, holds every live
-- workspace of the org at their new role's level, and a demotion lowers every
-- grant they hold there, including a demotion to a role that holds no
-- derived grant at all (owner, admin, guest, provisioner), which drops the
-- member's rows entirely. Reads the org's schema, which may not exist yet
-- while the org is provisioning; it runs as its owner, like
-- platform.drop_namespace_grants.
CREATE FUNCTION platform.grant_member_namespaces() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = platform, pg_temp AS $$
DECLARE
  derived text := platform.derived_grant(NEW.account_role);
  workspaces regclass := to_regclass(format('%I.workspaces', 'org_' || NEW.org_id));
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.account_role IS NOT DISTINCT FROM OLD.account_role THEN
    RETURN NULL;
  END IF;
  IF derived IS NULL THEN
    DELETE FROM platform.namespace_grants WHERE org_id = NEW.org_id AND principal_id = NEW.user_id;
    RETURN NULL;
  END IF;
  UPDATE platform.namespace_grants SET permission = derived WHERE org_id = NEW.org_id AND principal_id = NEW.user_id;
  IF workspaces IS NOT NULL THEN
    EXECUTE format(
      'INSERT INTO platform.namespace_grants (org_id, namespace_id, principal_id, permission)
       SELECT $1, w.id, $2, $3 FROM %s w WHERE w.deleted_at IS NULL
       ON CONFLICT (org_id, namespace_id, principal_id) DO UPDATE SET permission = EXCLUDED.permission',
      workspaces)
    USING NEW.org_id, NEW.user_id, derived;
  END IF;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION platform.grant_member_namespaces() FROM PUBLIC;
-- AFTER the BEFORE trigger that derives account_role from role, so it sees the derived value.
CREATE TRIGGER memberships_namespace_grants AFTER INSERT OR UPDATE ON platform.memberships
  FOR EACH ROW EXECUTE FUNCTION platform.grant_member_namespaces();

-- A new workspace is granted to the org's developers and read-only members.
-- Org schemas attach it to their workspaces table with the org id as its
-- argument; it runs as its owner, so an org role needs no privilege on the
-- platform schema.
CREATE FUNCTION platform.grant_namespace_members() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = platform, pg_temp AS $$
BEGIN
  INSERT INTO platform.namespace_grants (org_id, namespace_id, principal_id, permission)
  SELECT TG_ARGV[0], NEW.id, m.user_id, platform.derived_grant(m.account_role)
    FROM platform.memberships m
   WHERE m.org_id = TG_ARGV[0] AND platform.derived_grant(m.account_role) IS NOT NULL
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION platform.grant_namespace_members() FROM PUBLIC;
