ALTER TABLE app_sessions
  ADD COLUMN visibility TEXT NOT NULL DEFAULT 'top_level'
  CHECK (visibility IN ('top_level', 'internal'));

ALTER TABLE app_sessions
  ADD COLUMN parent_task_id TEXT;

CREATE INDEX idx_app_sessions_visibility_updated
  ON app_sessions (visibility, updated_at DESC, id ASC);
