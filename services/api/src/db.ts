/**
 * SQLite persistence for the MVP.
 *
 * The spec targets PostgreSQL in production (§8.3); this module isolates all SQL
 * behind a single connection so the storage engine can be swapped without touching
 * domain logic. Schema mirrors the §8.4 core data model plus operational tables
 * (sessions, notifications, ingest_emails) required by the MVP loop.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  locale        TEXT NOT NULL DEFAULT 'en-IN',
  timezone      TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  status        TEXT NOT NULL DEFAULT 'active',
  mfa_enabled   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS households (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name  TEXT,
  household_id  TEXT REFERENCES households(id) ON DELETE SET NULL,
  preferences   TEXT NOT NULL DEFAULT '{}'
);

-- documents: original source + metadata + provenance (§3.1)
CREATE TABLE IF NOT EXISTS documents (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'other',
  source      TEXT NOT NULL DEFAULT 'upload',
  mime_type   TEXT NOT NULL DEFAULT 'text/plain',
  size_bytes  INTEGER NOT NULL DEFAULT 0,
  hash        TEXT NOT NULL,
  storage_ref TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'received',
  raw_text    TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents(owner_id, hash);

-- document_fields: typed extraction output with confidence + source span (§2.4, FR-004/005)
CREATE TABLE IF NOT EXISTS document_fields (
  id                    TEXT PRIMARY KEY,
  document_id           TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  field                 TEXT NOT NULL,
  value                 TEXT NOT NULL,
  normalized_value      TEXT,
  confidence            REAL NOT NULL DEFAULT 0,
  span_start            INTEGER NOT NULL DEFAULT 0,
  span_end              INTEGER NOT NULL DEFAULT 0,
  requires_confirmation INTEGER NOT NULL DEFAULT 1,
  confirmed             INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fields_document ON document_fields(document_id);

-- assets (§3.1)
CREATE TABLE IF NOT EXISTS assets (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  name       TEXT NOT NULL,
  metadata   TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

-- obligations (§2.5)
CREATE TABLE IF NOT EXISTS obligations (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id        TEXT REFERENCES assets(id) ON DELETE SET NULL,
  document_id     TEXT REFERENCES documents(id) ON DELETE SET NULL,
  type            TEXT NOT NULL,
  title           TEXT NOT NULL,
  detail          TEXT,
  due_at          TEXT NOT NULL,
  recurrence      TEXT NOT NULL DEFAULT 'none',
  status          TEXT NOT NULL DEFAULT 'open',
  priority        TEXT NOT NULL DEFAULT 'medium',
  reminder_policy TEXT NOT NULL DEFAULT '[30,7,1]',
  action_plan     TEXT,
  provenance      TEXT,
  snoozed_until   TEXT,
  completed_at    TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_obligations_owner_due ON obligations(owner_id, due_at);
CREATE INDEX IF NOT EXISTS idx_obligations_status ON obligations(owner_id, status);

-- subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  merchant    TEXT NOT NULL,
  amount      REAL NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'INR',
  cadence     TEXT NOT NULL DEFAULT 'monthly',
  renewal_at  TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'other',
  status      TEXT NOT NULL DEFAULT 'active',
  document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL
);

-- events (calendar/travel/appointments)
CREATE TABLE IF NOT EXISTS events (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  start_at   TEXT NOT NULL,
  end_at     TEXT,
  location   TEXT,
  source     TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL
);

-- integrations + consent center state (§4.6)
CREATE TABLE IF NOT EXISTS integrations (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL,
  scopes       TEXT NOT NULL DEFAULT '[]',
  status       TEXT NOT NULL DEFAULT 'connected',
  last_sync_at TEXT,
  created_at   TEXT NOT NULL,
  UNIQUE(owner_id, provider)
);

-- fine-grained sharing permissions (§6.6, UC-011)
CREATE TABLE IF NOT EXISTS permissions (
  id                TEXT PRIMARY KEY,
  subject_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource_owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource_type     TEXT NOT NULL,
  resource_id       TEXT NOT NULL,
  role              TEXT NOT NULL DEFAULT 'viewer',
  granted_fields    TEXT,
  expires_at        TEXT,
  created_at        TEXT NOT NULL
);

-- agent actions with approval trail (§5.4, §5.5)
CREATE TABLE IF NOT EXISTS agent_actions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool       TEXT NOT NULL,
  level      INTEGER NOT NULL DEFAULT 0,
  input      TEXT NOT NULL,
  result     TEXT,
  approval   TEXT NOT NULL DEFAULT 'not_required',
  status     TEXT NOT NULL DEFAULT 'succeeded',
  created_at TEXT NOT NULL
);

-- audit events (FR-013)
CREATE TABLE IF NOT EXISTS audit_events (
  id            TEXT PRIMARY KEY,
  actor         TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  resource_type TEXT,
  resource_id   TEXT,
  metadata      TEXT,
  ip            TEXT,
  timestamp     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_events(actor, timestamp DESC);

-- notifications with dedupe keys (§2.6)
CREATE TABLE IF NOT EXISTS notifications (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  obligation_id  TEXT REFERENCES obligations(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL DEFAULT 'reminder',
  title          TEXT NOT NULL,
  body           TEXT NOT NULL,
  scheduled_for  TEXT NOT NULL,
  sent_at        TEXT,
  read_at        TEXT,
  dedupe_key     TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'scheduled',
  created_at     TEXT NOT NULL,
  UNIQUE(user_id, dedupe_key)
);

-- raw forwarded emails before processing (§4.2)
CREATE TABLE IF NOT EXISTS ingest_emails (
  id                   TEXT PRIMARY KEY,
  owner_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender               TEXT NOT NULL,
  subject              TEXT NOT NULL,
  body                 TEXT NOT NULL,
  hash                 TEXT NOT NULL,
  received_at          TEXT NOT NULL,
  processed_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  created_at           TEXT NOT NULL,
  UNIQUE(owner_id, hash)
);
`);

export type Row = Record<string, unknown>;

/** Parse JSON columns defensively. */
export function parseJSON<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}