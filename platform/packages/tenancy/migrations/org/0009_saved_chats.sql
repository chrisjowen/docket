-- Saved chats (the Ask page): a member's questions to one or more of the
-- org's workspaces and the cited answers they got, kept for that member only.
-- A chat names its workspaces by id without a foreign key: deleting a
-- workspace purges what it contributed from the chats that asked it, in the
-- deletion's transaction (canonical-store `purgeWorkspaceFromChats`), and
-- leaves the rest of each chat readable. The title and every message are
-- customer content, encrypted with the org's data key like the documents
-- (§7.3). Same ownership as 0001: the migration owner owns the objects;
-- {{org_role}} gets DML on its own schema only.

CREATE TABLE {{schema}}.chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The platform user whose chat it is: nobody else reads or deletes it.
  user_id text NOT NULL,
  -- The workspaces the chat asks now, and every workspace it has ever asked.
  workspace_ids text[] NOT NULL DEFAULT '{}',
  asked_workspace_ids text[] NOT NULL DEFAULT '{}',
  title_ciphertext bytea NOT NULL,
  title_nonce bytea NOT NULL,
  dek_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chats_user ON {{schema}}.chats (user_id, updated_at DESC);
CREATE INDEX chats_asked ON {{schema}}.chats USING gin (asked_workspace_ids);

CREATE TABLE {{schema}}.chat_messages (
  chat_id uuid NOT NULL REFERENCES {{schema}}.chats (id) ON DELETE CASCADE,
  seq integer NOT NULL CHECK (seq >= 1),
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  body_ciphertext bytea NOT NULL,
  body_nonce bytea NOT NULL,
  dek_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, seq)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON {{schema}}.chats, {{schema}}.chat_messages TO {{org_role}};
