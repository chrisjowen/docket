-- Reverts platform 0013 and every org's 0017, for rolling back to a build
-- before them. Run by hand as the migration owner, in one transaction, with
-- {{app_role}} replaced by the request role; the runner never applies it. The
-- grants they wrote stay: 0012 keeps them.
DROP FUNCTION platform.grant_namespace_members() CASCADE;
DROP TRIGGER memberships_namespace_grants ON platform.memberships;
DROP FUNCTION platform.grant_member_namespaces();
DROP FUNCTION platform.derived_grant(text);
REVOKE SELECT ON platform.namespace_grants FROM {{app_role}};

DELETE FROM platform.schema_migrations
 WHERE (schema_name = 'platform' AND version = 13) OR (schema_name LIKE 'org\_%' AND version = 17);
UPDATE platform.orgs SET schema_version = 16 WHERE schema_version > 16;
