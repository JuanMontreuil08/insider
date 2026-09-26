-- Identity comes from Cloudflare Access. MCP tokens are stored only as SHA-256 hashes.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  access_subject TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE mcp_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT
);

CREATE INDEX mcp_tokens_active_hash ON mcp_tokens(token_hash) WHERE revoked_at IS NULL;

CREATE TABLE reel_assignments (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reel_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  viewed_at TEXT,
  PRIMARY KEY (user_id, reel_id)
);

CREATE INDEX reel_assignments_pending ON reel_assignments(user_id, viewed_at, created_at DESC);
