-- A connection is created only after the OAuth callback from Hermes succeeds.
-- It replaces the temporary browser-issued bearer token as the assignment gate.
CREATE TABLE hermes_connections (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  connected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
