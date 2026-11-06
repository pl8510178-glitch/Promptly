const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const projectRoot = path.resolve(__dirname, '..');
const databasePath = process.env.DB_PATH
  ? path.resolve(projectRoot, process.env.DB_PATH)
  : path.join(projectRoot, 'data', 'promptly.sqlite');
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new DatabaseSync(databasePath, { timeout: 5000 });
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS extension_tokens (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS prompts (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
    mode TEXT NOT NULL CHECK(mode IN ('study','code','image','general')),
    task TEXT NOT NULL,
    current_text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX IF NOT EXISTS prompts_user_updated_idx ON prompts(user_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS prompt_versions (
    id INTEGER PRIMARY KEY,
    prompt_id INTEGER NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(prompt_id, version_number)
  );
  CREATE INDEX IF NOT EXISTS prompt_versions_prompt_idx ON prompt_versions(prompt_id, version_number DESC);

  CREATE TABLE IF NOT EXISTS prompt_runs (
    id INTEGER PRIMARY KEY,
    prompt_id INTEGER NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
    version_id INTEGER REFERENCES prompt_versions(id) ON DELETE SET NULL,
    model TEXT NOT NULL,
    response_text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX IF NOT EXISTS prompt_runs_prompt_idx ON prompt_runs(prompt_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS user_avatars (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    mime_type TEXT NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp')),
    image_data BLOB NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
`);

const promptTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'prompts'").get()?.sql || '';
if (!promptTableSql.includes("'image'") || !promptTableSql.includes("'general'")) {
  db.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN IMMEDIATE;
    CREATE TABLE prompts_next (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
      mode TEXT NOT NULL CHECK(mode IN ('study','code','image','general')),
      task TEXT NOT NULL,
      current_text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    INSERT INTO prompts_next (id, user_id, title, mode, task, current_text, created_at, updated_at)
      SELECT id, user_id, title, mode, task, current_text, created_at, updated_at FROM prompts;
    DROP TABLE prompts;
    ALTER TABLE prompts_next RENAME TO prompts;
    CREATE INDEX prompts_user_updated_idx ON prompts(user_id, updated_at DESC);
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
}

module.exports = { db, databasePath };
