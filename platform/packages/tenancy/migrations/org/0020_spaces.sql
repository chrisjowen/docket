-- Spaces (tenancy v2, phase 3): Account > Space > Docket. A space groups the
-- org's dockets for a team, department or client; every docket is in exactly
-- one, and a role on a space covers every docket in it (platform 0018). Every
-- org starts with General, whose id is `general` in every org; existing
-- dockets go there, and so does a new one made without naming a space. Same
-- ownership as 0001.
--
-- Account-wide Writer and Reader grants move to General: with every docket in
-- General they reach exactly what they reached, and a docket later made in
-- another space is no longer covered by them. A Writer or Reader grant that
-- adds a managing capability (create dockets, manage access, settings, audit,
-- ...) stays on the account, since those mean something there. Open invites
-- to Writer or Reader on the account move to General as well. General gives
-- everyone at the account Reader by default - unless that would let someone
-- read a docket they cannot read now, in which case the account's managers
-- can give it on General's access page. Every member's access to every live
-- docket is evaluated before and after; any difference aborts the migration.

CREATE TABLE {{schema}}.spaces (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9]{1,40}$'),
  slug text NOT NULL UNIQUE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  description text CHECK (description IS NULL OR length(description) <= 300),
  general boolean NOT NULL DEFAULT false,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (general = (id = 'general'))
);

INSERT INTO {{schema}}.spaces (id, slug, name, description, general, created_by)
VALUES ('general', 'general', 'General', 'Where every account starts. Everyone at the account reads it unless you change that.', true, 'system');

-- A space's grants go with it.
CREATE TRIGGER spaces_grants AFTER DELETE ON {{schema}}.spaces
  FOR EACH ROW EXECUTE FUNCTION platform.drop_space_grants('{{org_id}}');

ALTER TABLE {{schema}}.workspaces
  ADD COLUMN space_id text NOT NULL DEFAULT 'general' REFERENCES {{schema}}.spaces (id);
CREATE INDEX workspaces_space ON {{schema}}.workspaces (space_id);

-- A new docket's draft remembers where it goes and who gets access when it is made.
ALTER TABLE {{schema}}.docket_drafts
  ADD COLUMN space_id text NOT NULL DEFAULT 'general' REFERENCES {{schema}}.spaces (id) ON DELETE CASCADE,
  ADD COLUMN access jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(access) = 'array');

GRANT SELECT, INSERT, UPDATE, DELETE ON {{schema}}.spaces TO {{org_role}};

-- --- Account-wide Writer and Reader to General, checked --------------------------

DROP TABLE IF EXISTS pg_temp.space_access;
CREATE TEMPORARY TABLE space_access (stage text, user_id text, docket_id text, caps text[]) ON COMMIT DROP;

-- What every member may do on every live docket, as the grants stand now: the
-- owner flag, or the union of every grant that applies to them and covers the
-- docket (on the account, on the docket's space, or on the docket).
CREATE FUNCTION pg_temp.record_space_access(stage text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO space_access (stage, user_id, docket_id, caps)
  SELECT stage, m.user_id, w.id,
         CASE WHEN m.owner THEN ARRAY['owner'] ELSE coalesce((
           SELECT array_agg(DISTINCT cap ORDER BY cap)
             FROM platform.grants g
             JOIN platform.roles r ON r.id = g.role_id
             CROSS JOIN LATERAL (SELECT unnest(r.caps || g.add_caps) EXCEPT SELECT unnest(g.remove_caps)) AS given (cap)
            WHERE g.org_id = '{{org_id}}'
              AND (g.principal_id = m.user_id OR (g.principal_id IS NULL AND u.kind = 'human' AND NOT m.guest))
              AND (g.place_kind = 'account'
                   OR (g.place_kind = 'space' AND g.place_id = w.space_id)
                   OR (g.place_kind = 'docket' AND g.place_id = w.id))
         ), ARRAY[]::text[]) END
    FROM platform.memberships m
    JOIN platform.users u ON u.id = m.user_id
   CROSS JOIN {{schema}}.workspaces w
   WHERE m.org_id = '{{org_id}}' AND w.deleted_at IS NULL
$$;

CREATE FUNCTION pg_temp.space_access_changes() RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM space_access b
    JOIN space_access a ON a.stage = 'after' AND a.user_id = b.user_id AND a.docket_id = b.docket_id
   WHERE b.stage = 'before' AND a.caps IS DISTINCT FROM b.caps
$$;

SELECT pg_temp.record_space_access('before');

UPDATE platform.grants SET place_kind = 'space', place_id = 'general'
 WHERE org_id = '{{org_id}}' AND place_kind = 'account' AND role_id IN ('reader', 'writer')
   AND add_caps <@ ARRAY['read', 'write', 'propose', 'publish', 'decide'];

UPDATE platform.invites SET place_kind = 'space', place_id = 'general'
 WHERE org_id = '{{org_id}}' AND place_kind = 'account' AND role_id IN ('reader', 'writer') AND NOT owner
   AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL;

DO $$
DECLARE
  everyone text;
  changes bigint;
  example record;
BEGIN
  -- General gives everyone at the account Reader, unless a grant for everyone moved there already.
  INSERT INTO platform.grants (id, org_id, principal_id, place_kind, place_id, role_id)
  SELECT 'g_' || gen_random_uuid(), '{{org_id}}', NULL, 'space', 'general', 'reader'
   WHERE NOT EXISTS (
     SELECT 1 FROM platform.grants WHERE org_id = '{{org_id}}' AND principal_id IS NULL AND place_kind = 'space' AND place_id = 'general')
  RETURNING id INTO everyone;

  PERFORM pg_temp.record_space_access('after');
  IF everyone IS NOT NULL AND pg_temp.space_access_changes() > 0 THEN
    -- Reader for everyone would widen someone's access: General goes without it.
    DELETE FROM platform.grants WHERE id = everyone;
    DELETE FROM space_access WHERE stage = 'after';
    PERFORM pg_temp.record_space_access('after');
  END IF;

  changes := pg_temp.space_access_changes();
  IF changes > 0 THEN
    SELECT b.user_id, b.docket_id, b.caps AS before, a.caps AS after INTO example
      FROM space_access b JOIN space_access a ON a.stage = 'after' AND a.user_id = b.user_id AND a.docket_id = b.docket_id
     WHERE b.stage = 'before' AND a.caps IS DISTINCT FROM b.caps LIMIT 1;
    RAISE EXCEPTION 'moving account-wide grants to General would change % access decisions (for example member %, on %: % became %)',
      changes, example.user_id, example.docket_id, example.before, example.after
      USING ERRCODE = '23514';
  END IF;
END
$$;

DROP FUNCTION pg_temp.record_space_access(text), pg_temp.space_access_changes();
