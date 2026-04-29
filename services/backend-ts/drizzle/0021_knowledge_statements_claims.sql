CREATE TABLE IF NOT EXISTS knowledge_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL,
  provider_group_id text NOT NULL,
  client_profile_id uuid REFERENCES client_profiles(id) ON DELETE SET NULL,
  source_message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  source_message_version_id uuid NOT NULL REFERENCES message_versions(id) ON DELETE CASCADE,
  provider_message_id text NOT NULL,
  speaker_provider_user_id text,
  speaker_role text,
  speaker_display_name text,
  statement_text text NOT NULL,
  attribution_label text NOT NULL,
  source_type text NOT NULL DEFAULT 'message',
  occurred_at timestamptz NOT NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_message_id)
);

CREATE INDEX IF NOT EXISTS ix_knowledge_statements_scope_group
  ON knowledge_statements (scope, provider_group_id);

CREATE INDEX IF NOT EXISTS ix_knowledge_statements_client_profile
  ON knowledge_statements (client_profile_id);

CREATE TABLE IF NOT EXISTS knowledge_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id uuid NOT NULL REFERENCES knowledge_statements(id) ON DELETE CASCADE,
  scope text NOT NULL,
  provider_group_id text NOT NULL,
  client_profile_id uuid REFERENCES client_profiles(id) ON DELETE SET NULL,
  claim_text text NOT NULL,
  claim_kind text NOT NULL DEFAULT 'general_statement',
  attribution_label text NOT NULL,
  confidence integer NOT NULL DEFAULT 100,
  extraction_method text NOT NULL DEFAULT 'sentence_split_v1',
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_knowledge_claims_statement
  ON knowledge_claims (statement_id);

CREATE INDEX IF NOT EXISTS ix_knowledge_claims_scope_group
  ON knowledge_claims (scope, provider_group_id);

CREATE INDEX IF NOT EXISTS ix_knowledge_claims_client_profile
  ON knowledge_claims (client_profile_id);

ALTER TABLE knowledge_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS knowledge_statements_staff_scope ON knowledge_statements;
CREATE POLICY knowledge_statements_staff_scope ON knowledge_statements
  USING (
    current_setting('app.role', true) IN ('owner', 'admin')
    OR provider_group_id = ANY(string_to_array(current_setting('app.group_scope', true), ','))
    OR client_profile_id IN (
      SELECT gcp.client_profile_id
      FROM group_client_profiles gcp
      WHERE gcp.provider_group_id = ANY(string_to_array(current_setting('app.group_scope', true), ','))
    )
  );

DROP POLICY IF EXISTS knowledge_claims_staff_scope ON knowledge_claims;
CREATE POLICY knowledge_claims_staff_scope ON knowledge_claims
  USING (
    current_setting('app.role', true) IN ('owner', 'admin')
    OR provider_group_id = ANY(string_to_array(current_setting('app.group_scope', true), ','))
    OR client_profile_id IN (
      SELECT gcp.client_profile_id
      FROM group_client_profiles gcp
      WHERE gcp.provider_group_id = ANY(string_to_array(current_setting('app.group_scope', true), ','))
    )
  );
