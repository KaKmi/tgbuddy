CREATE TABLE app_authorization_claims (
  ticket_id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  root_run_id TEXT NOT NULL,
  agent_run_id TEXT NOT NULL,
  invocation_fingerprint TEXT NOT NULL,
  resource_identity_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'accepted_not_executed', 'execution_claimed', 'completed', 'failed', 'revoked'
  )),
  claimed_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_app_authorization_claims_root_state
  ON app_authorization_claims (root_run_id, state);
