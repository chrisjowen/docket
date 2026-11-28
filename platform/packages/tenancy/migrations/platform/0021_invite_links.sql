-- Invite links and emails (tenancy v2 §6). An invite carries a role on a
-- place, lasts 7 days and works once; now it is also a link, sent by email
-- when there is an address to send it to. Only the SHA-256 of the link's
-- secret is kept, as for sessions and tokens: the link is shown to whoever
-- invites, once, and sent in the email. Sending it again makes a new link,
-- for 7 more days, and the old one stops working.
ALTER TABLE platform.invites
  ADD COLUMN link_hash text,
  ADD COLUMN emailed_to text CHECK (emailed_to = lower(emailed_to)),
  ADD COLUMN emailed_at timestamptz;
CREATE UNIQUE INDEX invites_link_hash ON platform.invites (link_hash) WHERE link_hash IS NOT NULL;
