-- Reverts platform 0018 and every org's 0020, for rolling back to a build
-- before spaces. Run by hand as the migration owner, in one transaction, with
-- {{app_role}} replaced by the request role; the runner never applies it.
-- Nobody gains access. In an org whose live dockets are all in General, a
-- grant on General goes back to the whole account, where org 0020 found it.
-- Otherwise - and for every other space - a grant on a space becomes the same
-- grant on each docket in it, unless the grantee already holds one there.
-- Open invites to General follow its grants; invites to other spaces are
-- cancelled. Every docket stays; which space it was in does not.

DO $$
DECLARE
  org record;
  spaces regclass;
  workspaces regclass;
  only_general boolean;
BEGIN
  FOR org IN SELECT id FROM platform.orgs LOOP
    spaces := to_regclass(format('%I.spaces', 'org_' || org.id));
    CONTINUE WHEN spaces IS NULL;
    workspaces := to_regclass(format('%I.workspaces', 'org_' || org.id));
    EXECUTE format('SELECT NOT EXISTS (SELECT 1 FROM %s WHERE deleted_at IS NULL AND space_id <> %L)', workspaces, 'general')
      INTO only_general;

    IF only_general THEN
      UPDATE platform.grants SET place_kind = 'account', place_id = NULL
       WHERE org_id = org.id AND place_kind = 'space' AND place_id = 'general'
         AND NOT EXISTS (
           SELECT 1 FROM platform.grants a
            WHERE a.org_id = org.id AND a.place_kind = 'account'
              AND a.principal_id IS NOT DISTINCT FROM platform.grants.principal_id);
      UPDATE platform.invites SET place_kind = 'account', place_id = NULL
       WHERE org_id = org.id AND place_kind = 'space' AND place_id = 'general';
    END IF;

    EXECUTE format(
      'INSERT INTO platform.grants (id, org_id, principal_id, place_kind, place_id, role_id, add_caps, remove_caps, granted_by, created_at)
       SELECT ''g_'' || gen_random_uuid(), g.org_id, g.principal_id, ''docket'', w.id, g.role_id, g.add_caps, g.remove_caps, g.granted_by, g.created_at
         FROM platform.grants g JOIN %s w ON w.space_id = g.place_id AND w.deleted_at IS NULL
        WHERE g.org_id = $1 AND g.place_kind = ''space''
       ON CONFLICT (org_id, coalesce(principal_id, ''''), place_kind, coalesce(place_id, '''')) DO NOTHING',
      workspaces)
    USING org.id;
    DELETE FROM platform.grants WHERE org_id = org.id AND place_kind = 'space';
    UPDATE platform.invites SET revoked_at = now()
     WHERE org_id = org.id AND place_kind = 'space' AND revoked_at IS NULL;
    UPDATE platform.invites SET place_kind = 'account', place_id = NULL WHERE org_id = org.id AND place_kind = 'space';

    EXECUTE format('DROP TRIGGER spaces_grants ON %s', spaces);
    EXECUTE format('ALTER TABLE %I.docket_drafts DROP COLUMN space_id, DROP COLUMN access', 'org_' || org.id);
    EXECUTE format('ALTER TABLE %s DROP COLUMN space_id', workspaces);
    EXECUTE format('DROP TABLE %s', spaces);
  END LOOP;
END
$$;

DROP FUNCTION platform.docket_spaces(text);
DROP FUNCTION platform.drop_space_grants();
DROP INDEX platform.grants_space;
ALTER TABLE platform.grants
  DROP CONSTRAINT grants_place_kind_check,
  ADD CONSTRAINT grants_place_kind_check CHECK (place_kind IN ('account', 'docket'));
ALTER TABLE platform.invites
  DROP CONSTRAINT invites_place_kind_check,
  ADD CONSTRAINT invites_place_kind_check CHECK (place_kind IN ('account', 'docket'));

DELETE FROM platform.schema_migrations
 WHERE (schema_name = 'platform' AND version = 18) OR (schema_name LIKE 'org\_%' AND version = 20);
UPDATE platform.orgs SET schema_version = 19 WHERE schema_version > 19;
