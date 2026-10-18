import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nowIso } from './ids.js';
import { CHANGEABLE_CATEGORIES } from '../../shared/src/progress.js';

const here = dirname(fileURLToPath(import.meta.url));

export type Row = Record<string, unknown>;

export interface UserRow {
  id: string;
  name: string;
  token_hash: string;
  pair_id: string;
  tz: string;
  notif_morning: string;
  notif_evening: string;
  notif_enabled: number;
  last_seen_at: string | null;
  created_at: string;
  recovery_hash?: string | null;
  recovery_created_at?: string | null;
  email?: string | null;
  email_verified_at?: string | null;
  intimacy_ok?: number;
  care_hints?: number;
}

export interface PairRow {
  id: string;
  invite_code: string;
  tz: string;
  is_guest: number;
  week_theme: string | null;
  created_at: string;
  deleted_at: string | null;
  stage?: string | null;
  has_kids?: number | null;
}

export interface QuestionRow {
  id: string;
  pair_id: string | null;
  author_id: string | null;
  layer: string;
  category: string;
  format: string;
  text: string;
  a: string;
  b: string;
  why_chips: string | null;
  topic: string | null;
  is_active: number;
  created_at: string;
  changeable?: number;
  source?: string | null;
}

export interface RoundRow {
  id: string;
  pair_id: string;
  question_id: string;
  date: string;
  kind: string;
  challenge_id: string | null;
  origin_round_id?: string | null;
  status: string;
  revealed_at: string | null;
  created_at: string;
}

export interface AnswerRow {
  id: string;
  round_id: string;
  user_id: string;
  client_id: string | null;
  choice: string;
  guess: string | null;
  why_text: string | null;
  why_chip: string | null;
  created_at: string;
}

export interface GestureRow {
  id: string;
  pair_id: string;
  from_user_id: string;
  to_user_id: string;
  type: string;
  text: string;
  client_id: string | null;
  created_at: string;
  seen_at: string | null;
}

export let db: DatabaseSync;

export function openDb(dataDir: string): DatabaseSync {
  mkdirSync(dataDir, { recursive: true });
  db = new DatabaseSync(join(dataDir, 'polovinka.db'));
  const schemaPath = [join(here, 'schema.sql'), join(here, '..', 'src', 'schema.sql')].find((p) => existsSync(p));
  if (!schemaPath) throw new Error('schema.sql не найден');
  db.exec(readFileSync(schemaPath, 'utf8'));
  migrate();
  seedQuestions();
  return db;
}

/** Добавление колонок в существующие таблицы (CREATE TABLE IF NOT EXISTS их не трогает). */
function migrate() {
  const has = (table: string, col: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((c) => c.name === col);
  if (!has('rounds', 'origin_round_id')) db.exec('ALTER TABLE rounds ADD COLUMN origin_round_id TEXT');
  // Доступ без пароля: код восстановления и почта
  if (!has('users', 'recovery_hash')) db.exec('ALTER TABLE users ADD COLUMN recovery_hash TEXT');
  if (!has('users', 'recovery_created_at')) db.exec('ALTER TABLE users ADD COLUMN recovery_created_at TEXT');
  if (!has('users', 'email')) db.exec('ALTER TABLE users ADD COLUMN email TEXT');
  if (!has('users', 'email_verified_at')) db.exec('ALTER TABLE users ADD COLUMN email_verified_at TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users(email) WHERE email IS NOT NULL');
  // Ссылка «посоветовать друзьям»: отдельный код, не путать с приглашением в пару
  if (!has('pairs', 'ref_code')) db.exec('ALTER TABLE pairs ADD COLUMN ref_code TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS pairs_ref ON pairs(ref_code) WHERE ref_code IS NOT NULL');
  // Профиль пары и личные настройки: стадия, дети, «Близость», подсказки заботы
  if (!has('pairs', 'stage')) db.exec('ALTER TABLE pairs ADD COLUMN stage TEXT');
  if (!has('pairs', 'has_kids')) db.exec('ALTER TABLE pairs ADD COLUMN has_kids INTEGER');
  if (!has('users', 'intimacy_ok')) db.exec('ALTER TABLE users ADD COLUMN intimacy_ok INTEGER NOT NULL DEFAULT 0');
  if (!has('users', 'care_hints')) db.exec('ALTER TABLE users ADD COLUMN care_hints INTEGER NOT NULL DEFAULT 1');
  // Вопросы: «меняется со временем» и источник (ai — составлен по истории пары)
  if (!has('questions', 'changeable')) db.exec('ALTER TABLE questions ADD COLUMN changeable INTEGER NOT NULL DEFAULT 0');
  if (!has('questions', 'source')) db.exec('ALTER TABLE questions ADD COLUMN source TEXT');
  // Разовые исправления данных
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
  const once = (key: string, sql: string) => {
    if (db.prepare('SELECT 1 FROM meta WHERE key = ?').get(key)) return;
    db.exec(sql);
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run(key, new Date().toISOString());
  };
  // Подсказки заботы до исправления промпта могли быть адресованы не тому — пересоздадутся
  once('care_hints_v2', "DELETE FROM care_hints WHERE seen_at IS NULL");
  db.exec('CREATE INDEX IF NOT EXISTS users_recovery ON users(recovery_hash) WHERE recovery_hash IS NOT NULL');
}

function findQuestionsJson(): string {
  const candidates = [
    join(here, '..', '..', 'shared', 'questions.json'),
    join(here, '..', '..', '..', 'shared', 'questions.json'),
    join(here, '..', '..', '..', '..', 'shared', 'questions.json'),
    join(process.cwd(), 'shared', 'questions.json'),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('shared/questions.json не найден');
  return found;
}

interface SeedQuestion {
  id: string;
  layer: string;
  category: string;
  format?: string;
  text: string;
  a: string;
  b: string;
  topic?: string;
  whyChips?: string[];
  changeable?: boolean;
}

function seedQuestions() {
  const list = JSON.parse(readFileSync(findQuestionsJson(), 'utf8')) as SeedQuestion[];
  const upsert = db.prepare(`
    INSERT INTO questions (id, pair_id, author_id, layer, category, format, text, a, b, why_chips, topic, is_active, created_at, changeable)
    VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      layer = excluded.layer, category = excluded.category, format = excluded.format,
      text = excluded.text, a = excluded.a, b = excluded.b, why_chips = excluded.why_chips, topic = excluded.topic,
      changeable = excluded.changeable
  `);
  const ts = nowIso();
  db.exec('BEGIN');
  try {
    for (const q of list) {
      const changeable = q.changeable || CHANGEABLE_CATEGORIES.includes(q.category) ? 1 : 0;
      upsert.run(q.id, q.layer, q.category, q.format ?? 'ab', q.text, q.a, q.b, q.whyChips ? JSON.stringify(q.whyChips) : null, q.topic ?? null, ts, changeable);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function one<T = Row>(sql: string, ...params: Array<string | number | null>): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function all<T = Row>(sql: string, ...params: Array<string | number | null>): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function run(sql: string, ...params: Array<string | number | null>) {
  return db.prepare(sql).run(...params);
}

export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function logEvent(type: string, opts: { pairId?: string | null; userId?: string | null; meta?: Record<string, unknown> } = {}) {
  run(
    'INSERT INTO events (pair_id, user_id, type, meta, created_at) VALUES (?, ?, ?, ?, ?)',
    opts.pairId ?? null,
    opts.userId ?? null,
    type,
    opts.meta ? JSON.stringify(opts.meta) : null,
    nowIso(),
  );
}
