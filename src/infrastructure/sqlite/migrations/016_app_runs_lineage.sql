ALTER TABLE app_runs ADD COLUMN workspace_id TEXT;
ALTER TABLE app_runs ADD COLUMN root_run_id TEXT;
ALTER TABLE app_runs ADD COLUMN agent_run_id TEXT;
ALTER TABLE app_runs ADD COLUMN parent_tool_call_id TEXT;
CREATE INDEX idx_app_runs_root ON app_runs (root_run_id);
