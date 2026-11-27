-- Writes with evidence (§9.1, §14.2): the ingest events 0004 made for repo
-- syncs also record MCP, UI and ontology writes - how the evidence names the
-- actor, what the write did, the evidence it added and what the validator said -
-- linked to the request's audit event by its request id. A repo sync leaves the
-- new columns empty. Same ownership as 0001: the migration owner owns the
-- objects; {{org_role}} gets DML on its own schema only, and the activity log
-- is append-only even for it.

ALTER TABLE {{schema}}.ingest_events
  -- How the evidence names the actor (`claude-code via alice (oauth)`).
  ADD COLUMN actor_label text,
  -- remember, add-evidence, retire, propose-ontology, publish-ontology.
  ADD COLUMN action text,
  ADD COLUMN evidence_count integer NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
  -- The evidence, diagnostics and reason are customer content: one JSON object,
  -- encrypted with the org's data key like the documents (§7.3).
  ADD COLUMN detail_ciphertext bytea,
  ADD COLUMN detail_nonce bytea,
  ADD COLUMN dek_version integer,
  ADD CONSTRAINT ingest_events_detail_sealed
    CHECK ((detail_ciphertext IS NULL) = (detail_nonce IS NULL) AND (detail_ciphertext IS NULL) = (dek_version IS NULL));

-- `refused`: the validator or a write rule turned it away and nothing changed.
ALTER TABLE {{schema}}.ingest_events DROP CONSTRAINT ingest_events_outcome_check;
ALTER TABLE {{schema}}.ingest_events
  ADD CONSTRAINT ingest_events_outcome_check CHECK (outcome IN ('ok', 'refused', 'partial', 'error'));

CREATE INDEX ingest_events_channel ON {{schema}}.ingest_events (workspace_id, channel, created_at DESC);
CREATE INDEX ingest_events_actor ON {{schema}}.ingest_events (workspace_id, actor, created_at DESC);

REVOKE UPDATE, DELETE ON {{schema}}.ingest_events FROM {{org_role}};
