CREATE TABLE app_permission_rules (
  id TEXT PRIMARY KEY,
  tool TEXT NOT NULL,
  match TEXT NOT NULL CHECK (match IN ('tool', 'path', 'prefix', 'method')),
  pattern TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT 'allow' CHECK (action IN ('allow', 'deny')),
  scope TEXT NOT NULL CHECK (scope IN ('session', 'project', 'global')),
  never_persist INTEGER NOT NULL DEFAULT 0,
  owner_id TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'system')),
  reason TEXT,
  created_at INTEGER NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tool, match, pattern, scope, owner_id)
);

CREATE INDEX idx_app_permission_rules_scope_owner
  ON app_permission_rules (scope, owner_id);
