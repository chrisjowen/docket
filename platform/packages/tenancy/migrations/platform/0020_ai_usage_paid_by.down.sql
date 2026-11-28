-- Reverts platform 0020, for rolling back to a build that counts every call
-- toward the account's cap. Run by hand as the migration owner; the runner
-- never applies it. Calls on spaces' own keys count toward the account's cap
-- again for the rest of the month.
ALTER TABLE platform.ai_usage DROP COLUMN paid_by;

DELETE FROM platform.schema_migrations WHERE schema_name = 'platform' AND version = 20;
