CREATE TABLE IF NOT EXISTS app_tool_settings (
  tool_id TEXT PRIMARY KEY,
  permission TEXT NOT NULL CHECK (permission IN ('allow', 'ask', 'deny')),
  updated_at INTEGER NOT NULL
);
