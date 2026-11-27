-- Agents act for a person (trust design §3.4). An API token owned by a
-- service account acts for that account's accountable person: the human
-- member answerable for what it writes, whose evidence an agent using the
-- token gives when it cites no source. It is required in practice - set when
-- the account is made, to whoever made it, and changed by an admin - but an
-- account made before this, or by ops, may have none, and then acts for no
-- one. Humans have none. Same ownership as 0001.
ALTER TABLE platform.users ADD COLUMN accountable_user_id text REFERENCES platform.users (id) ON DELETE SET NULL;
ALTER TABLE platform.users ADD CONSTRAINT users_accountable_service CHECK (kind = 'service' OR accountable_user_id IS NULL);
UPDATE platform.users SET accountable_user_id = created_by WHERE kind = 'service' AND created_by IS NOT NULL;
