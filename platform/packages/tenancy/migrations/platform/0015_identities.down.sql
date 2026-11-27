-- Reverts platform 0015, for rolling back to a build before it. Run by hand as
-- the migration owner, in one transaction; the runner never applies it. A
-- build before 0015 knows only GitHub users, so this refuses while any person
-- signs in some other way: remove those users first.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM platform.users WHERE kind = 'human' AND github_id IS NULL) THEN
    RAISE EXCEPTION 'people without a GitHub identity exist (OIDC or password users): remove them before reverting 0015';
  END IF;
END
$$;

DROP TABLE platform.signin_allowlist;
DROP TABLE platform.password_credentials;
DROP TABLE platform.identities;
ALTER TABLE platform.users DROP CONSTRAINT users_service_without_github;
ALTER TABLE platform.users ADD CONSTRAINT users_check CHECK ((kind = 'human') = (github_id IS NOT NULL));
DELETE FROM platform.schema_migrations WHERE schema_name = 'platform' AND version = 15;
