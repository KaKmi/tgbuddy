CREATE TABLE app_delegation_tasks (
  id TEXT PRIMARY KEY,
  root_run_id TEXT NOT NULL,
  root_session_id TEXT NOT NULL,
  child_session_id TEXT NOT NULL UNIQUE,
  parent_task_id TEXT,
  role TEXT NOT NULL CHECK (role IN ('explorer', 'worker')),
  title TEXT NOT NULL,
  task TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'queued', 'starting', 'running', 'stopping', 'stopped', 'completed', 'failed', 'interrupted'
  )),
  version INTEGER NOT NULL,
  usage_json TEXT NOT NULL,
  permission_ceiling_json TEXT NOT NULL,
  last_activity_at INTEGER NOT NULL,
  stop_reason TEXT,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_app_delegation_tasks_root_created
  ON app_delegation_tasks (root_run_id, created_at ASC, id ASC);
