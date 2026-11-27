-- Reverts platform 0017, for rolling back to a build before it. Run by hand as
-- the migration owner, in one transaction, with {{app_role}} replaced by the
-- request role; the runner never applies it. Nobody gains access. Each member's
-- per-org role comes back from the owner flag and their grant on the account
-- (a custom role counts as the best built-in one it contains); a guest's or a
-- member's grant on a docket above that comes back as a namespace grant. What
-- the old model cannot say - a capability added to or removed from one grant,
-- grants for everyone, custom roles - goes. Every org's triggers that granted a
-- new workspace to its members and dropped a deleted one's grants come back,
-- and every org's 0019 goes.

ALTER TABLE platform.memberships
  ADD COLUMN role text CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  ADD COLUMN account_role text CHECK (account_role IN ('owner', 'admin', 'developer', 'read_only', 'guest', 'provisioner'));

CREATE OR REPLACE FUNCTION pg_temp.tier_of(caps text[]) RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN caps @> ARRAY['read', 'write', 'propose', 'publish', 'decide', 'create', 'access', 'system', 'tokens', 'settings', 'delete', 'audit'] THEN 3
    WHEN caps @> ARRAY['read', 'write', 'propose'] THEN 2
    WHEN 'read' = ANY (caps) THEN 1
    ELSE 0 END
$$;

-- What each grant gives, as a tier: 3 admin, 2 write, 1 read, 0 nothing.
CREATE TEMPORARY TABLE grant_tiers ON COMMIT DROP AS
SELECT g.org_id, g.principal_id, g.place_kind, g.place_id,
       pg_temp.tier_of(ARRAY(SELECT unnest(r.caps || g.add_caps) EXCEPT SELECT unnest(g.remove_caps))) AS tier
  FROM platform.grants g JOIN platform.roles r ON r.id = g.role_id
 WHERE g.principal_id IS NOT NULL;

UPDATE platform.memberships m SET role = CASE
    WHEN m.owner THEN 'owner'
    ELSE CASE coalesce((SELECT max(t.tier) FROM grant_tiers t
                         WHERE t.org_id = m.org_id AND t.principal_id = m.user_id AND (t.place_kind = 'account' OR m.guest)), 0)
           WHEN 3 THEN 'admin' WHEN 2 THEN 'editor' ELSE 'viewer' END
  END;
UPDATE platform.memberships m SET account_role = CASE
    WHEN m.owner THEN 'owner'
    WHEN m.guest THEN 'guest'
    WHEN EXISTS (SELECT 1 FROM platform.orgs o WHERE o.id = m.org_id AND o.org_admin_id = m.user_id) THEN 'provisioner'
    ELSE CASE m.role WHEN 'admin' THEN 'admin' WHEN 'editor' THEN 'developer' ELSE 'read_only' END
  END;
-- org-admin was an editor whose keys moved off it (platform 0014).
UPDATE platform.memberships m SET role = 'editor'
  FROM platform.orgs o WHERE o.id = m.org_id AND o.org_admin_id = m.user_id;
ALTER TABLE platform.memberships ALTER COLUMN role SET NOT NULL, ALTER COLUMN account_role SET NOT NULL;

-- Platform 0012 and 0013's model, as they left it.
CREATE TABLE platform.namespace_grants (
  org_id text NOT NULL,
  namespace_id text NOT NULL CHECK (namespace_id ~ '^[a-z0-9]{1,40}$'),
  principal_id text NOT NULL,
  permission text NOT NULL CHECK (permission IN ('admin', 'write', 'read')),
  granted_by text REFERENCES platform.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, namespace_id, principal_id),
  FOREIGN KEY (org_id, principal_id) REFERENCES platform.memberships (org_id, user_id) ON DELETE CASCADE
);
CREATE INDEX namespace_grants_principal ON platform.namespace_grants (principal_id);
GRANT SELECT ON platform.namespace_grants TO {{app_role}};

CREATE FUNCTION platform.drop_namespace_grants() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = platform, pg_temp AS $$
BEGIN
  DELETE FROM platform.namespace_grants WHERE org_id = TG_ARGV[0] AND namespace_id = OLD.id;
  RETURN NULL;
END
$$;

CREATE FUNCTION platform.derive_account_role() RETURNS trigger
  LANGUAGE plpgsql SET search_path = platform, pg_temp AS $$
BEGIN
  IF NEW.account_role IS NULL
     OR (TG_OP = 'UPDATE' AND NEW.role IS DISTINCT FROM OLD.role AND NEW.account_role IS NOT DISTINCT FROM OLD.account_role) THEN
    NEW.account_role := CASE NEW.role
      WHEN 'owner' THEN 'owner'
      WHEN 'admin' THEN 'admin'
      WHEN 'editor' THEN 'developer'
      WHEN 'viewer' THEN 'read_only'
    END;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER memberships_account_role BEFORE INSERT OR UPDATE ON platform.memberships
  FOR EACH ROW EXECUTE FUNCTION platform.derive_account_role();

CREATE FUNCTION platform.derived_grant(account_role text) RETURNS text
  LANGUAGE sql IMMUTABLE SET search_path = platform, pg_temp AS $$
  SELECT CASE account_role WHEN 'developer' THEN 'write' WHEN 'read_only' THEN 'read' END
$$;

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
CREATE TRIGGER memberships_namespace_grants AFTER INSERT OR UPDATE ON platform.memberships
  FOR EACH ROW EXECUTE FUNCTION platform.grant_member_namespaces();

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

-- Each org: its members' derived grants on every live workspace, any docket
-- grant above them, and the trigger that grants new workspaces.
DO $$
DECLARE
  org record;
  workspaces regclass;
BEGIN
  FOR org IN SELECT id FROM platform.orgs LOOP
    workspaces := to_regclass(format('%I.workspaces', 'org_' || org.id));
    CONTINUE WHEN workspaces IS NULL;
    EXECUTE format(
      'INSERT INTO platform.namespace_grants (org_id, namespace_id, principal_id, permission)
       SELECT $1, w.id, m.user_id, platform.derived_grant(m.account_role)
         FROM %s w JOIN platform.memberships m ON m.org_id = $1 AND platform.derived_grant(m.account_role) IS NOT NULL
        WHERE w.deleted_at IS NULL
       ON CONFLICT DO NOTHING',
      workspaces)
    USING org.id;
    EXECUTE format('CREATE TRIGGER workspaces_grant_members AFTER INSERT ON %s
                      FOR EACH ROW EXECUTE FUNCTION platform.grant_namespace_members(%L)', workspaces, org.id);
    -- Org 0019 goes: the trigger org 0016 attached comes back.
    EXECUTE format('DROP TRIGGER IF EXISTS workspaces_docket_grants ON %s', workspaces);
    EXECUTE format('CREATE TRIGGER workspaces_namespace_grants AFTER DELETE ON %s
                      FOR EACH ROW EXECUTE FUNCTION platform.drop_namespace_grants(%L)', workspaces, org.id);
  END LOOP;
END
$$;

INSERT INTO platform.namespace_grants (org_id, namespace_id, principal_id, permission)
SELECT t.org_id, t.place_id, t.principal_id, CASE max(t.tier) WHEN 3 THEN 'admin' WHEN 2 THEN 'write' ELSE 'read' END
  FROM grant_tiers t JOIN platform.memberships m ON m.org_id = t.org_id AND m.user_id = t.principal_id
 WHERE t.place_kind = 'docket' AND t.tier > 0 AND m.account_role NOT IN ('owner', 'admin', 'provisioner')
 GROUP BY t.org_id, t.place_id, t.principal_id
ON CONFLICT (org_id, namespace_id, principal_id) DO UPDATE SET permission = EXCLUDED.permission
 WHERE CASE EXCLUDED.permission WHEN 'admin' THEN 3 WHEN 'write' THEN 2 ELSE 1 END
     > CASE platform.namespace_grants.permission WHEN 'admin' THEN 3 WHEN 'write' THEN 2 ELSE 1 END;

CREATE OR REPLACE FUNCTION platform.database_account(org text, namespace text, level text) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = platform, pg_temp AS $$
DECLARE
  account text;
BEGIN
  IF level IS NULL OR level NOT IN ('write', 'read') THEN
    RAISE EXCEPTION 'a database account is write or read, not %', level USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('docket-cloud:database-account:' || org || ':' || namespace));
  SELECT user_id INTO account FROM platform.database_accounts
   WHERE org_id = org AND namespace_id = namespace AND permission = level;
  IF account IS NOT NULL THEN
    RETURN account;
  END IF;
  account := gen_random_uuid()::text;
  INSERT INTO platform.users (id, kind, login, service_org_id, description, created_by)
  SELECT account, 'service', format('org-admin/%s/%s', namespace, level), org,
         format('Owns the %s keys the org admin API issues for one database.', level), o.org_admin_id
    FROM platform.orgs o WHERE o.id = org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no organisation %', org USING ERRCODE = '23503';
  END IF;
  INSERT INTO platform.memberships (org_id, user_id, role, account_role)
  VALUES (org, account, CASE level WHEN 'write' THEN 'editor' ELSE 'viewer' END, 'guest');
  INSERT INTO platform.namespace_grants (org_id, namespace_id, principal_id, permission)
  VALUES (org, namespace, account, level);
  INSERT INTO platform.database_accounts (org_id, namespace_id, permission, user_id)
  VALUES (org, namespace, level, account);
  RETURN account;
END
$$;

-- Invites: back to a per-org role, an owner invite to owner. One for a single
-- docket cannot be said, so it goes.
ALTER TABLE platform.invites ADD COLUMN role text CHECK (role IN ('owner', 'admin', 'editor', 'viewer'));
UPDATE platform.invites SET revoked_at = coalesce(revoked_at, now()) WHERE place_kind = 'docket';
UPDATE platform.invites i SET role = CASE
    WHEN i.owner THEN 'owner'
    ELSE CASE pg_temp.tier_of((SELECT r.caps FROM platform.roles r WHERE r.id = i.role_id)) WHEN 3 THEN 'admin' WHEN 2 THEN 'editor' ELSE 'viewer' END
  END;
ALTER TABLE platform.invites ALTER COLUMN role SET NOT NULL;
ALTER TABLE platform.invites DROP COLUMN role_id, DROP COLUMN place_kind, DROP COLUMN place_id, DROP COLUMN owner, DROP COLUMN guest;

DROP TABLE platform.grants;
DROP FUNCTION platform.drop_docket_grants();
DROP FUNCTION platform.check_grant_role();
DROP TABLE platform.roles;
DROP FUNCTION platform.keep_builtin_roles();
ALTER TABLE platform.memberships DROP COLUMN owner, DROP COLUMN guest;

DROP FUNCTION pg_temp.tier_of(text[]);

DELETE FROM platform.schema_migrations
 WHERE (schema_name = 'platform' AND version = 17) OR (schema_name LIKE 'org\_%' AND version = 19);
UPDATE platform.orgs SET schema_version = 18 WHERE schema_version > 18;
