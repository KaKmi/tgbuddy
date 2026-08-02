CREATE TABLE app_interaction_decisions (
  request_id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('permission', 'plan', 'ask_user')),
  response_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  execution_state TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE app_permission_audit (
  decision_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  tool_call_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  allowed INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
