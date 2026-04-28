ALTER TYPE runtime_status ADD VALUE IF NOT EXISTS 'pending' BEFORE 'provisioning';

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_instances_runtime_container_name
  ON agent_instances (runtime_container_name)
  WHERE runtime_container_name IS NOT NULL;
