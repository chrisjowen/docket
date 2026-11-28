-- Reverses 0021_invite_links: invites go back to being answered only by the
-- GitHub login or verified email they are addressed to.
DROP INDEX IF EXISTS platform.invites_link_hash;
ALTER TABLE platform.invites
  DROP COLUMN IF EXISTS link_hash,
  DROP COLUMN IF EXISTS emailed_to,
  DROP COLUMN IF EXISTS emailed_at;
