-- Reverts platform 0014, for rolling back to a build before it. Run by hand as
-- the migration owner, in one transaction; the runner never applies it. Every
-- key a database account owns goes back to its org's `org-admin`, which is a
-- developer again: platform 0013's trigger gives it back its write grant on
-- every live workspace. The database accounts go, with their grants.
UPDATE platform.api_tokens t SET owner_id = o.org_admin_id
  FROM platform.database_accounts d, platform.orgs o
 WHERE d.user_id = t.owner_id AND o.id = d.org_id AND o.org_admin_id IS NOT NULL;

UPDATE platform.memberships m SET account_role = 'developer'
  FROM platform.orgs o
 WHERE o.id = m.org_id AND o.org_admin_id = m.user_id;
UPDATE platform.users u SET description = 'Owns the access keys the org admin API issues.'
  FROM platform.orgs o
 WHERE o.org_admin_id = u.id AND u.description = 'Acts for the org admin API.';

DELETE FROM platform.users u USING platform.database_accounts d WHERE u.id = d.user_id;
DROP FUNCTION platform.database_account(text, text, text);
DROP TABLE platform.database_accounts;

DELETE FROM platform.schema_migrations WHERE schema_name = 'platform' AND version = 14;
