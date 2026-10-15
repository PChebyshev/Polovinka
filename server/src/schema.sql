PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  pair_id TEXT NOT NULL,
  tz TEXT NOT NULL DEFAULT 'Europe/Moscow',
  notif_morning TEXT NOT NULL DEFAULT '09:00',
  notif_evening TEXT NOT NULL DEFAULT '20:00',
  notif_enabled INTEGER NOT NULL DEFAULT 1,
  last_seen_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS users_pair ON users(pair_id);

CREATE TABLE IF NOT EXISTS pairs (
  id TEXT PRIMARY KEY,
  invite_code TEXT NOT NULL UNIQUE,
  tz TEXT NOT NULL DEFAULT 'Europe/Moscow',
  is_guest INTEGER NOT NULL DEFAULT 0,
  week_theme TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  pair_id TEXT,
  author_id TEXT,
  layer TEXT NOT NULL,
  category TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'ab',
  text TEXT NOT NULL,
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  why_chips TEXT,
  topic TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS questions_pair ON questions(pair_id);

CREATE TABLE IF NOT EXISTS question_marks (
  pair_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (pair_id, user_id, question_id)
);

CREATE TABLE IF NOT EXISTS rounds (
  id TEXT PRIMARY KEY,
  pair_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  date TEXT NOT NULL,
  kind TEXT NOT NULL,
  challenge_id TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  revealed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (pair_id, date, kind, question_id)
);
CREATE INDEX IF NOT EXISTS rounds_pair_date ON rounds(pair_id, date);

CREATE TABLE IF NOT EXISTS answers (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  client_id TEXT UNIQUE,
  choice TEXT NOT NULL,
  guess TEXT,
  why_text TEXT,
  why_chip TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (round_id, user_id)
);

CREATE TABLE IF NOT EXISTS gestures (
  id TEXT PRIMARY KEY,
  pair_id TEXT NOT NULL,
  from_user_id TEXT NOT NULL,
  to_user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  text TEXT NOT NULL,
  client_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  seen_at TEXT
);
CREATE INDEX IF NOT EXISTS gestures_pair ON gestures(pair_id, created_at);

CREATE TABLE IF NOT EXISTS gesture_templates (
  id TEXT PRIMARY KEY,
  pair_id TEXT NOT NULL,
  type TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS favorites (
  pair_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (pair_id, user_id, kind, ref_id)
);

CREATE TABLE IF NOT EXISTS milestones (
  pair_id TEXT NOT NULL,
  key TEXT NOT NULL,
  reached_at TEXT NOT NULL,
  seen_by TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (pair_id, key)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL,
  failed_at TEXT
);

CREATE TABLE IF NOT EXISTS notification_log (
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, date, kind)
);

CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  from_pair_id TEXT NOT NULL,
  question_ids TEXT NOT NULL,
  created_at TEXT NOT NULL,
  opened_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS challenge_pairs (
  challenge_id TEXT NOT NULL,
  pair_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (challenge_id, pair_id)
);

CREATE TABLE IF NOT EXISTS weekly_cards (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  pair_id TEXT NOT NULL,
  week_start TEXT NOT NULL,
  stats TEXT NOT NULL,
  png_path TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (pair_id, week_start)
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pair_id TEXT,
  user_id TEXT,
  type TEXT NOT NULL,
  meta TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_type_time ON events(type, created_at);

-- Дополнительные устройства одного пользователя (Safari и приложение на экране «Домой» на iOS не делят хранилище).
CREATE TABLE IF NOT EXISTS user_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS user_tokens_user ON user_tokens(user_id);

-- Короткие одноразовые коды для переноса входа на другое устройство.
CREATE TABLE IF NOT EXISTS login_codes (
  code TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

-- Журнал отправки push: для диагностики на странице /stats. Без текстов и адресов подписок.
CREATE TABLE IF NOT EXISTS push_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  service TEXT NOT NULL,
  status INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS push_log_time ON push_log(created_at);

-- Капсула времени: письма друг другу, которые откроются позже.
CREATE TABLE IF NOT EXISTS capsules (
  id TEXT PRIMARY KEY,
  pair_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  opens_at TEXT NOT NULL,
  read_by TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS capsules_pair ON capsules(pair_id, opens_at);

CREATE TABLE IF NOT EXISTS capsule_letters (
  capsule_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (capsule_id, user_id)
);

-- Коды из писем: привязка почты и вход по почте. Хранится хеш кода.
CREATE TABLE IF NOT EXISTS email_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  purpose TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS email_codes_email ON email_codes(email, purpose);
