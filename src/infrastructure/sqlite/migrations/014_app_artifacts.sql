CREATE TABLE IF NOT EXISTS app_artifacts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  session_id TEXT NOT NULL,
  producer_run_id TEXT,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  kind TEXT NOT NULL,
  mime TEXT,
  size INTEGER,
  blob_hash TEXT,
  blob_size INTEGER,
  blob_mime TEXT,
  source_skill TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (session_id, path)
);
CREATE INDEX IF NOT EXISTS idx_app_artifacts_session ON app_artifacts (session_id, created_at);
