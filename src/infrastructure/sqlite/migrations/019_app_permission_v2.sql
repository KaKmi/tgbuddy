ALTER TABLE app_permission_rules RENAME TO app_permission_rules_legacy;

CREATE TABLE app_permission_rules (
  id TEXT PRIMARY KEY,
  tool TEXT NOT NULL,
  match TEXT NOT NULL CHECK (match IN ('tool', 'path', 'prefix', 'method', 'command', 'origin', 'account')),
  pattern TEXT NOT NULL,
  matcher_json TEXT NOT NULL DEFAULT '{}',
  action TEXT NOT NULL DEFAULT 'allow' CHECK (action IN ('allow', 'deny')),
  scope TEXT NOT NULL CHECK (scope IN ('agent_run', 'delegation', 'session', 'project', 'global')),
  never_persist INTEGER NOT NULL DEFAULT 0,
  owner_id TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'system')),
  reason TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  needs_review INTEGER NOT NULL DEFAULT 0,
  created_by_subject TEXT NOT NULL DEFAULT '',
  max_applicable_scope TEXT NOT NULL DEFAULT 'global',
  created_at INTEGER NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  last_hit_at INTEGER,
  UNIQUE (tool, match, pattern, scope, owner_id)
);

INSERT INTO app_permission_rules (
  id, tool, match, pattern, matcher_json, action, scope, never_persist,
  owner_id, source, reason, revision, enabled, needs_review,
  created_by_subject, max_applicable_scope, created_at, hits, last_hit_at
)
SELECT
  id, tool, match, pattern, '{}', action, scope, never_persist,
  owner_id, source, reason, 1,
  CASE WHEN match = 'prefix' THEN 0 ELSE 1 END,
  CASE WHEN match = 'prefix' THEN 1 ELSE 0 END,
  '', scope, created_at, hits, NULL
FROM app_permission_rules_legacy;

DROP TABLE app_permission_rules_legacy;

CREATE INDEX idx_app_permission_rules_scope_owner
  ON app_permission_rules (scope, owner_id, enabled);

CREATE TABLE app_plan_effects (
  effect_id TEXT PRIMARY KEY,
  root_run_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  plan_revision INTEGER NOT NULL,
  subject_json TEXT NOT NULL,
  matcher_json TEXT NOT NULL,
  max_risk TEXT NOT NULL CHECK (max_risk IN ('R2', 'R3')),
  resource_identity_hash TEXT NOT NULL DEFAULT '',
  expires_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_app_plan_effects_root_revision
  ON app_plan_effects (root_run_id, plan_id, plan_revision);
