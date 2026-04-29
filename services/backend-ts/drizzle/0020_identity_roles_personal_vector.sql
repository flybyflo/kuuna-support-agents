DO $$
BEGIN
  CREATE TYPE group_member_role AS ENUM ('client', 'lawyer', 'company_staff', 'bot');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS client_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS client_profile_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_profile_id uuid NOT NULL REFERENCES client_profiles(id) ON DELETE CASCADE,
  provider_user_id text NOT NULL UNIQUE,
  derived_phone text,
  phone_override text,
  push_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_group_id text NOT NULL,
  provider_user_id text NOT NULL,
  role group_member_role,
  display_name text,
  derived_phone text,
  phone_override text,
  push_name text,
  client_profile_id uuid REFERENCES client_profiles(id) ON DELETE SET NULL,
  gateway_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_group_id, provider_user_id)
);

CREATE INDEX IF NOT EXISTS ix_group_members_provider_group_id
  ON group_members (provider_group_id);

CREATE TABLE IF NOT EXISTS group_client_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_group_id text NOT NULL,
  client_profile_id uuid NOT NULL REFERENCES client_profiles(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_group_id, client_profile_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_group_client_profiles_primary_group
  ON group_client_profiles (provider_group_id)
  WHERE is_primary = true;

CREATE TABLE IF NOT EXISTS knowledge_personal_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_profile_id uuid NOT NULL REFERENCES client_profiles(id) ON DELETE CASCADE,
  doc_key text NOT NULL,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_profile_id, doc_key)
);

ALTER TABLE embeddings
  ADD COLUMN IF NOT EXISTS embedding_vector vector(1536);

ALTER TABLE retrieval_chunks
  ADD COLUMN IF NOT EXISTS client_profile_id uuid REFERENCES client_profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS embedding_vector vector(1536);

ALTER TABLE todos
  ADD COLUMN IF NOT EXISTS metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION kuuna_try_vector_1536(value text)
RETURNS vector
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN value::vector(1536);
EXCEPTION
  WHEN others THEN
    RETURN NULL;
END;
$$;

UPDATE embeddings
SET embedding_vector = kuuna_try_vector_1536(embedding)
WHERE embedding_vector IS NULL
  AND embedding IS NOT NULL;

UPDATE retrieval_chunks
SET embedding_vector = kuuna_try_vector_1536(embedding)
WHERE embedding_vector IS NULL
  AND embedding IS NOT NULL;

DROP FUNCTION IF EXISTS kuuna_try_vector_1536(text);

CREATE INDEX IF NOT EXISTS ix_embeddings_scope_source_version
  ON embeddings (scope, source_version_id);

CREATE INDEX IF NOT EXISTS ix_retrieval_chunks_scope_group
  ON retrieval_chunks (scope, provider_group_id);

CREATE INDEX IF NOT EXISTS ix_retrieval_chunks_personal_profile
  ON retrieval_chunks (scope, client_profile_id)
  WHERE client_profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_retrieval_chunks_source
  ON retrieval_chunks (source_type, source_id);

CREATE INDEX IF NOT EXISTS ix_embeddings_embedding_vector_hnsw
  ON embeddings USING hnsw (embedding_vector vector_cosine_ops)
  WHERE embedding_vector IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_retrieval_chunks_embedding_vector_hnsw
  ON retrieval_chunks USING hnsw (embedding_vector vector_cosine_ops)
  WHERE embedding_vector IS NOT NULL;

ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_client_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_profile_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_personal_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE retrieval_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE todos ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_group_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_customer_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_common_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS group_members_staff_scope ON group_members;
CREATE POLICY group_members_staff_scope ON group_members
  USING (
    current_setting('app.role', true) IN ('owner', 'admin')
    OR provider_group_id = ANY(string_to_array(current_setting('app.group_scope', true), ','))
  );

DROP POLICY IF EXISTS group_client_profiles_staff_scope ON group_client_profiles;
CREATE POLICY group_client_profiles_staff_scope ON group_client_profiles
  USING (
    current_setting('app.role', true) IN ('owner', 'admin')
    OR provider_group_id = ANY(string_to_array(current_setting('app.group_scope', true), ','))
  );

DROP POLICY IF EXISTS retrieval_chunks_staff_scope ON retrieval_chunks;
CREATE POLICY retrieval_chunks_staff_scope ON retrieval_chunks
  USING (
    scope = 'common'
    OR current_setting('app.role', true) IN ('owner', 'admin')
    OR provider_group_id = ANY(string_to_array(current_setting('app.group_scope', true), ','))
    OR client_profile_id IN (
      SELECT gcp.client_profile_id
      FROM group_client_profiles gcp
      WHERE gcp.provider_group_id = ANY(string_to_array(current_setting('app.group_scope', true), ','))
    )
  );

DROP POLICY IF EXISTS messages_staff_scope ON messages;
CREATE POLICY messages_staff_scope ON messages
  USING (
    current_setting('app.role', true) IN ('owner', 'admin')
    OR provider_group_id = ANY(string_to_array(current_setting('app.group_scope', true), ','))
  );

DROP POLICY IF EXISTS todos_staff_scope ON todos;
CREATE POLICY todos_staff_scope ON todos
  USING (
    current_setting('app.role', true) IN ('owner', 'admin')
    OR provider_group_id = ANY(string_to_array(current_setting('app.group_scope', true), ','))
  );

DROP POLICY IF EXISTS knowledge_common_docs_staff_scope ON knowledge_common_docs;
CREATE POLICY knowledge_common_docs_staff_scope ON knowledge_common_docs
  USING (true);

DROP POLICY IF EXISTS knowledge_group_docs_staff_scope ON knowledge_group_docs;
CREATE POLICY knowledge_group_docs_staff_scope ON knowledge_group_docs
  USING (
    current_setting('app.role', true) IN ('owner', 'admin')
    OR provider_group_id = ANY(string_to_array(current_setting('app.group_scope', true), ','))
  );

DROP POLICY IF EXISTS knowledge_customer_docs_staff_scope ON knowledge_customer_docs;
CREATE POLICY knowledge_customer_docs_staff_scope ON knowledge_customer_docs
  USING (
    current_setting('app.role', true) IN ('owner', 'admin')
    OR provider_group_id = ANY(string_to_array(current_setting('app.group_scope', true), ','))
  );

DROP POLICY IF EXISTS client_profiles_staff_scope ON client_profiles;
CREATE POLICY client_profiles_staff_scope ON client_profiles
  USING (
    current_setting('app.role', true) IN ('owner', 'admin')
    OR id IN (
      SELECT gcp.client_profile_id
      FROM group_client_profiles gcp
      WHERE gcp.provider_group_id = ANY(string_to_array(current_setting('app.group_scope', true), ','))
    )
  );

DROP POLICY IF EXISTS client_profile_identities_staff_scope ON client_profile_identities;
CREATE POLICY client_profile_identities_staff_scope ON client_profile_identities
  USING (
    current_setting('app.role', true) IN ('owner', 'admin')
    OR client_profile_id IN (
      SELECT gcp.client_profile_id
      FROM group_client_profiles gcp
      WHERE gcp.provider_group_id = ANY(string_to_array(current_setting('app.group_scope', true), ','))
    )
  );

DROP POLICY IF EXISTS knowledge_personal_docs_staff_scope ON knowledge_personal_docs;
CREATE POLICY knowledge_personal_docs_staff_scope ON knowledge_personal_docs
  USING (
    current_setting('app.role', true) IN ('owner', 'admin')
    OR client_profile_id IN (
      SELECT gcp.client_profile_id
      FROM group_client_profiles gcp
      WHERE gcp.provider_group_id = ANY(string_to_array(current_setting('app.group_scope', true), ','))
    )
  );

DROP POLICY IF EXISTS knowledge_versions_staff_scope ON knowledge_versions;
CREATE POLICY knowledge_versions_staff_scope ON knowledge_versions
  USING (
    scope = 'common'
    OR current_setting('app.role', true) IN ('owner', 'admin')
    OR (
      scope = 'group'
      AND doc_ref_id IN (
        SELECT kgd.id
        FROM knowledge_group_docs kgd
        WHERE kgd.provider_group_id = ANY(string_to_array(current_setting('app.group_scope', true), ','))
      )
    )
    OR (
      scope = 'customer'
      AND doc_ref_id IN (
        SELECT kcd.id
        FROM knowledge_customer_docs kcd
        WHERE kcd.provider_group_id = ANY(string_to_array(current_setting('app.group_scope', true), ','))
      )
    )
    OR (
      scope = 'personal'
      AND doc_ref_id IN (
        SELECT kpd.id
        FROM knowledge_personal_docs kpd
        INNER JOIN group_client_profiles gcp ON gcp.client_profile_id = kpd.client_profile_id
        WHERE gcp.provider_group_id = ANY(string_to_array(current_setting('app.group_scope', true), ','))
      )
    )
  );
