CREATE TABLE IF NOT EXISTS app_schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
