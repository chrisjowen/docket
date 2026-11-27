-- The beta allowlist keys on GitHub's numeric account id, not the login: a
-- login can be renamed and then registered by someone else, and that account
-- must not inherit the grant. A row keeps the login it was granted under, for
-- people to read. A row with no id is pending: an entry seeded by login only
-- (DOCKET_BETA_ALLOWLIST) that the next sign-in as that login claims, which
-- sets its id.
ALTER TABLE platform.beta_allowlist DROP CONSTRAINT beta_allowlist_pkey;
ALTER TABLE platform.beta_allowlist ADD COLUMN github_id bigint UNIQUE;
CREATE UNIQUE INDEX beta_allowlist_pending_login ON platform.beta_allowlist (github_login) WHERE github_id IS NULL;

-- Existing rows take the account that already signed in under their login
-- (its user, else an invited waitlist entry), so no one already in has to wait
-- for a sign-in. Each account keeps one row; its others grant nothing more.
WITH known AS (
  SELECT DISTINCT ON (a.github_login) a.ctid AS row_id, a.github_login, k.github_id
    FROM platform.beta_allowlist a
    JOIN (
      SELECT login_lower AS login, github_id, 1 AS rank FROM platform.users WHERE kind = 'human'
      UNION ALL
      SELECT github_login, github_id, 2 FROM platform.waitlist WHERE status = 'invited'
    ) k ON k.login = a.github_login
   ORDER BY a.github_login, k.rank
), chosen AS (
  SELECT DISTINCT ON (github_id) row_id, github_id FROM known ORDER BY github_id, github_login
)
UPDATE platform.beta_allowlist a SET github_id = chosen.github_id FROM chosen WHERE a.ctid = chosen.row_id;

DELETE FROM platform.beta_allowlist a
 WHERE a.github_id IS NULL
   AND EXISTS (
     SELECT 1 FROM platform.beta_allowlist b
       JOIN (
         SELECT login_lower AS login, github_id FROM platform.users WHERE kind = 'human'
         UNION ALL
         SELECT github_login, github_id FROM platform.waitlist WHERE status = 'invited'
       ) k ON k.github_id = b.github_id
      WHERE k.login = a.github_login
   );
