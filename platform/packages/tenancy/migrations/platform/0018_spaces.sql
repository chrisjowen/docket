-- Spaces (tenancy v2, phase 3): Account > Space > Docket. A space groups
-- dockets for a team, department or client, and a grant may be on one: a role
-- on a space covers every docket in it, including ones added later. Spaces
-- live in each org's own schema beside its workspaces (org 0020, which also
-- makes every org's General space and moves its account-wide Writer and
-- Reader grants there); here the grants and invites learn the new place, and
-- the platform learns which space each docket is in. Same ownership as 0001.

ALTER TABLE platform.grants
  DROP CONSTRAINT grants_place_kind_check,
  ADD CONSTRAINT grants_place_kind_check CHECK (place_kind IN ('account', 'space', 'docket'));
CREATE INDEX grants_space ON platform.grants (org_id, place_id) WHERE place_kind = 'space';

ALTER TABLE platform.invites
  DROP CONSTRAINT invites_place_kind_check,
  ADD CONSTRAINT invites_place_kind_check CHECK (place_kind IN ('account', 'space', 'docket'));

-- Drops a deleted space's grants, and cancels the open invites to it. Org
-- schemas attach it to their spaces table with the org id as its argument; it
-- runs as its owner, so an org role needs no privilege on the platform schema.
CREATE FUNCTION platform.drop_space_grants() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = platform, pg_temp AS $$
BEGIN
  DELETE FROM platform.grants WHERE org_id = TG_ARGV[0] AND place_kind = 'space' AND place_id = OLD.id;
  UPDATE platform.invites SET revoked_at = now()
   WHERE org_id = TG_ARGV[0] AND place_kind = 'space' AND place_id = OLD.id
     AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION platform.drop_space_grants() FROM PUBLIC;

-- Which space each of an org's dockets is in: what a grant on a space covers,
-- read wherever access is resolved (`accessOf`), which is in the platform
-- schema. It reads the org's workspaces as their owner and gives back only
-- docket and space ids - no more than platform.grants already holds - and
-- nothing for an org whose schema has no spaces yet.
CREATE FUNCTION platform.docket_spaces(org text) RETURNS TABLE (docket_id text, space_id text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = platform, pg_temp AS $$
DECLARE
  workspaces regclass;
BEGIN
  IF org IS NULL OR org !~ '^[a-z0-9]{1,40}$' THEN
    RETURN;
  END IF;
  workspaces := to_regclass(format('%I.workspaces', 'org_' || org));
  IF workspaces IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_attribute WHERE attrelid = workspaces AND attname = 'space_id' AND NOT attisdropped
  ) THEN
    RETURN;
  END IF;
  RETURN QUERY EXECUTE format('SELECT w.id, w.space_id FROM %s w', workspaces);
END
$$;
REVOKE ALL ON FUNCTION platform.docket_spaces(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.docket_spaces(text) TO {{app_role}};
