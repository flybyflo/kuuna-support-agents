CREATE UNIQUE INDEX IF NOT EXISTS uq_group_bindings_active_provider_group
  ON group_bindings (provider_group_id)
  WHERE status = 'active';
