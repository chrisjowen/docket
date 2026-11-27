-- The org's own ontology templates, and new dockets drafted before they are
-- made. Same ownership as 0001: the migration owner owns the objects;
-- {{org_role}} gets DML on its own schema only, so one org's templates and
-- drafts are never readable as another's.

-- A template an owner or admin saved from one of the org's dockets: its
-- published ontology at the time, never its documents. New docket offers it
-- beside the built-in templates. The docket it came from is kept by id
-- without a foreign key, so deleting that docket leaves the template.
CREATE TABLE {{schema}}.ontology_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  tags text[] NOT NULL DEFAULT '{}',
  yaml text NOT NULL,
  yaml_hash text NOT NULL,
  from_workspace_id text,
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ontology_templates_name ON {{schema}}.ontology_templates (lower(name));

-- A new docket's ontology, drafted (by AI, from a description of the domain)
-- and opened in the ontology editor before the docket exists: accepting it
-- creates the docket with this as its first version and deletes the draft.
-- Only the member who started it opens it.
CREATE TABLE {{schema}}.docket_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  yaml text NOT NULL,
  -- ai:<template>: drafted by AI, starting from that template.
  source text NOT NULL,
  message text,
  author text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX docket_drafts_author ON {{schema}}.docket_drafts (author, updated_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON {{schema}}.ontology_templates, {{schema}}.docket_drafts TO {{org_role}};
