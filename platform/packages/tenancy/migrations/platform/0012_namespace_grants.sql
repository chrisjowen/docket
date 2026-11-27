-- Accounts and namespaces, the model only (tenancy design, phase 1a). An org
-- becomes an account, and each of its workspaces a namespace (a "Docket"):
-- the unit people are given access to. Nothing reads these yet; access is
-- still the org-wide `role` until namespace access is enforced. Same ownership
-- as 0001. Reverted by 0012_namespace_grants.down.sql.

-- Each member's account role. Owners and admins hold admin on every namespace
-- through it; developers may create namespaces; read-only members and guests
-- see only the namespaces they are granted, and a guest cannot even list the
-- others. A provisioner is a service account with control-plane rights only:
-- it creates namespaces and manages their access, and reads no content.
ALTER TABLE platform.memberships
  ADD COLUMN account_role text CHECK (account_role IN ('owner', 'admin', 'developer', 'read_only', 'guest', 'provisioner'));

-- The app still writes only `role`, so the account role follows it: set from
-- `role` when a membership is made without one, and again when `role` changes.
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

-- Every existing membership, the org-admin service account included (an
-- editor: its keys write today, so it is a developer until it becomes a
-- provisioner whose keys move to namespace service accounts). The trigger
-- fills in the null.
UPDATE platform.memberships SET account_role = NULL;
ALTER TABLE platform.memberships ALTER COLUMN account_role SET NOT NULL;

-- A member's permission on one namespace: a workspace in the org's schema,
-- named by its id. Grants belong to a membership and go with it. A namespace's
-- grants go when its workspace row is deleted (the org trigger below); a
-- soft-deleted one keeps them until it is purged. Org migration 0016 backfills
-- each org: a grant on every live workspace for each developer (write) and
-- read-only member (read), which is exactly what they reach today. Rows added
-- later get none until enforcement reconciles them again.
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

-- Drops a deleted workspace's grants. Org schemas attach it to their
-- workspaces table with the org id as its argument; it runs as its owner, so
-- an org role needs no privilege on the platform schema.
CREATE FUNCTION platform.drop_namespace_grants() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = platform, pg_temp AS $$
BEGIN
  DELETE FROM platform.namespace_grants WHERE org_id = TG_ARGV[0] AND namespace_id = OLD.id;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION platform.drop_namespace_grants() FROM PUBLIC;
