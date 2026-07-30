DROP INDEX IF EXISTS app_sessions_workspace_updated_idx;

ALTER TABLE app_sessions RENAME TO app_sessions_before_interrupted;

CREATE TABLE app_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  workspace_id TEXT,
  channel_id TEXT,
  model_id TEXT,
  expert_id TEXT,
  pinned INTEGER CHECK (pinned IN (0, 1)),
  archived INTEGER CHECK (archived IN (0, 1)),
  permission_mode TEXT CHECK (permission_mode IN ('plan', 'auto', 'bypass')),
  status TEXT CHECK (status IN ('idle', 'running', 'done', 'failed', 'interrupted')),
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

INSERT INTO app_sessions (
  id,
  title,
  workspace_id,
  channel_id,
  model_id,
  expert_id,
  pinned,
  archived,
  permission_mode,
  status,
  status_detail,
  last_activity,
  artifact_count,
  context_usage_json,
  origin_session_id,
  origin_message_id,
  created_at,
  updated_at
)
SELECT
  id,
  title,
  workspace_id,
  channel_id,
  model_id,
  expert_id,
  pinned,
  archived,
  permission_mode,
  status,
  status_detail,
  last_activity,
  artifact_count,
  context_usage_json,
  origin_session_id,
  origin_message_id,
  created_at,
  updated_at
FROM app_sessions_before_interrupted;

DROP TABLE app_sessions_before_interrupted;

CREATE INDEX app_sessions_workspace_updated_idx
  ON app_sessions (workspace_id, updated_at DESC, id ASC);
