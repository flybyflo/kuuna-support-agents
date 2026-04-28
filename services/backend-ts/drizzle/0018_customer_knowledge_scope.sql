ALTER TYPE knowledge_scope ADD VALUE IF NOT EXISTS 'customer';
ALTER TYPE embedding_scope ADD VALUE IF NOT EXISTS 'customer';

CREATE TABLE IF NOT EXISTS knowledge_customer_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_group_id text NOT NULL,
  customer_key text NOT NULL,
  doc_key text NOT NULL,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_customer_docs_customer_doc_key
  ON knowledge_customer_docs (customer_key, doc_key);

CREATE INDEX IF NOT EXISTS ix_knowledge_customer_docs_provider_group_id
  ON knowledge_customer_docs (provider_group_id);
