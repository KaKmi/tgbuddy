CREATE TABLE IF NOT EXISTS app_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  workspace_id TEXT,
  channel_id TEXT,
  model_id TEXT,
  expert_id TEXT,
  pinned INTEGER CHECK (pinned IN (0, 1)),
  archived INTEGER CHECK (archived IN (0, 1)),
  permission_mode TEXT CHECK (permission_mode IN ('plan', 'auto', 'bypass')),
  status TEXT CHECK (status IN ('idle', 'running', 'done', 'failed')),
  status_detail TEXT,
  last_activity TEXT,
  artifact_count INTEGER,
  context_usage_json TEXT,
  origin_session_id TEXT,
  origin_message_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (
    (origin_session_id IS NULL AND origin_message_id IS NULL)
    OR (origin_session_id IS NOT NULL AND origin_message_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS app_sessions_workspace_updated_idx
  ON app_sessions (workspace_id, updated_at DESC, id ASC);
