-- Reverts platform 0012 and every org's 0016, for rolling back to a build
-- before them. Run by hand as the migration owner, in one transaction; the
-- runner never applies it. Revert platform 0013 first
-- (0013_namespace_access.down.sql), which reads and fills what this drops.
DROP FUNCTION platform.drop_namespace_grants() CASCADE;
DROP TABLE platform.namespace_grants;
DROP TRIGGER memberships_account_role ON platform.memberships;
DROP FUNCTION platform.derive_account_role();
ALTER TABLE platform.memberships DROP COLUMN account_role;

DELETE FROM platform.schema_migrations
 WHERE (schema_name = 'platform' AND version = 12) OR (schema_name LIKE 'org\_%' AND version = 16);
UPDATE platform.orgs SET schema_version = 15 WHERE schema_version > 15;
