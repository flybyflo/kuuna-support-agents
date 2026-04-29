ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS system_prompt text,
  ADD COLUMN IF NOT EXISTS user_prompt text,
  ADD COLUMN IF NOT EXISTS input_context jsonb NOT NULL DEFAULT '{}'::jsonb;
