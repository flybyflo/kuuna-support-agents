CREATE EXTENSION IF NOT EXISTS vector;

ALTER TYPE knowledge_scope ADD VALUE IF NOT EXISTS 'personal';
ALTER TYPE embedding_scope ADD VALUE IF NOT EXISTS 'personal';
