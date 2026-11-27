-- The org admin API's access keys move off `org-admin` (tenancy v2, phase
-- 1.1). `org-admin` was an editor, so platform 0013 gave it a write grant on
-- every live workspace, UI-made ones included, and a master key could issue
-- write keys for any of them. Now each key is owned by a system account of the
-- one database it is for, holding Read or Write there and nowhere else, and
-- `org-admin` becomes a provisioner, which holds no grant. Same ownership as
-- 0001. Reverted by 0014_database_accounts.down.sql.

-- A database's system accounts, at most one per permission, made by its first
-- key at that level. They are guests: no role change gives them a derived
-- grant, and only their own grant reaches anything. They take no member seat,
-- and member management leaves them to the org admin API.
CREATE TABLE platform.database_accounts (
  org_id text NOT NULL,
  namespace_id text NOT NULL CHECK (namespace_id ~ '^[a-z0-9]{1,40}$'),
  permission text NOT NULL CHECK (permission IN ('write', 'read')),
  user_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, namespace_id, permission),
  FOREIGN KEY (org_id, user_id) REFERENCES platform.memberships (org_id, user_id) ON DELETE CASCADE
);

GRANT SELECT ON platform.database_accounts TO {{app_role}};

-- The system account that owns a database's keys at `level`, made with its
-- grant on first use. Requests may not write grants themselves (0013), so this
-- runs as its owner; it grants one account one database only. The login has a
-- slash, which service account names cannot, so no member can take it first.
CREATE FUNCTION platform.database_account(org text, namespace text, level text) RETURNS text
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
REVOKE ALL ON FUNCTION platform.database_account(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.database_account(text, text, text) TO {{app_role}};

-- Every live key `org-admin` owns moves to its database's account at the key's
-- level, write if it carries docket:write. Its id, hash and text stay, so it
-- keeps working, with exactly the scopes it had. Revoked and expired keys stay
-- where they are.
SELECT platform.database_account(keys.org_id, keys.workspace_id, keys.level)
  FROM (SELECT DISTINCT t.org_id, t.workspace_id,
               CASE WHEN 'docket:write' = ANY (t.scopes) THEN 'write' ELSE 'read' END AS level
          FROM platform.api_tokens t JOIN platform.orgs o ON o.id = t.org_id AND t.owner_id = o.org_admin_id
         WHERE t.revoked_at IS NULL AND t.expires_at > now()) keys;

UPDATE platform.api_tokens t SET owner_id = d.user_id
  FROM platform.orgs o, platform.database_accounts d
 WHERE o.id = t.org_id AND t.owner_id = o.org_admin_id AND t.revoked_at IS NULL AND t.expires_at > now()
   AND d.org_id = t.org_id AND d.namespace_id = t.workspace_id
   AND d.permission = CASE WHEN 'docket:write' = ANY (t.scopes) THEN 'write' ELSE 'read' END;

-- `org-admin` provisions and holds nothing: platform 0013's trigger drops its grants.
UPDATE platform.memberships m SET account_role = 'provisioner'
  FROM platform.orgs o
 WHERE o.id = m.org_id AND o.org_admin_id = m.user_id;
UPDATE platform.users u SET description = 'Acts for the org admin API.'
  FROM platform.orgs o
 WHERE o.org_admin_id = u.id AND u.description = 'Owns the access keys the org admin API issues.';
