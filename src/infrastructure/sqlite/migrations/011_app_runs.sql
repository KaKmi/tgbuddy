CREATE TABLE IF NOT EXISTS app_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  settled_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('running', 'done', 'failed', 'interrupted')),
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  error TEXT NOT NULL DEFAULT '',
  UNIQUE (session_id, created_at)
);

CREATE INDEX idx_app_runs_session ON app_runs (session_id, created_at DESC);
