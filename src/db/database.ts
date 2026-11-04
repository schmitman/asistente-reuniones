import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import type { DatabaseSync as SqliteDatabase } from 'node:sqlite';

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:' + 'sqlite') as { DatabaseSync: typeof SqliteDatabase };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY,
  base_key TEXT NOT NULL,
  record_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  seniority_raw TEXT,
  seniority TEXT,
  seniority_rank INTEGER,
  english_raw TEXT,
  english TEXT,
  english_rank INTEGER,
  area TEXT,
  area_norm TEXT,
  status TEXT,
  status_norm TEXT,
  years_experience REAL,
  position_name TEXT,
  position_norm TEXT,
  profile_text TEXT,
  profile_norm TEXT,
  country TEXT,
  country_norm TEXT,
  data_share_ok INTEGER NOT NULL DEFAULT 0,
  skills_preview TEXT NOT NULL DEFAULT '',
  search_text TEXT NOT NULL DEFAULT '',
  skill_tags TEXT NOT NULL DEFAULT '',
  skill_text TEXT NOT NULL DEFAULT '',
  synced_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_candidates_base ON candidates(base_key);
CREATE INDEX IF NOT EXISTS idx_candidates_seniority ON candidates(seniority);
CREATE INDEX IF NOT EXISTS idx_candidates_english ON candidates(english);

CREATE TABLE IF NOT EXISTS candidate_skills (
  candidate_id TEXT NOT NULL,
  skill TEXT NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (candidate_id, skill, source)
);

CREATE INDEX IF NOT EXISTS idx_candidate_skills_skill ON candidate_skills(skill);

CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY,
  meet_code TEXT,
  meet_url TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  consent_posted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transcript_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  speaker TEXT NOT NULL,
  text TEXT NOT NULL,
  source TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transcript_meeting ON transcript_lines(meeting_id, id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  sender TEXT NOT NULL,
  text TEXT NOT NULL,
  addressed INTEGER NOT NULL DEFAULT 0,
  reply TEXT
);

CREATE INDEX IF NOT EXISTS idx_chat_meeting ON chat_messages(meeting_id, id);

CREATE TABLE IF NOT EXISTS suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id TEXT,
  ts TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  base_key TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  record_count INTEGER,
  status TEXT NOT NULL,
  error TEXT
);
`;

export function openDatabase(path: string): SqliteDatabase {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Agrega columnas nuevas a caches viejos. Si faltan, hay que volver a correr npm run sync. */
function migrate(db: SqliteDatabase): void {
  const columns = new Set(
    (db.prepare(`PRAGMA table_info(candidates)`).all() as Array<{ name: string }>).map((row) => row.name),
  );
  if (!columns.has('skill_tags')) db.exec(`ALTER TABLE candidates ADD COLUMN skill_tags TEXT NOT NULL DEFAULT ''`);
  if (!columns.has('skill_text')) db.exec(`ALTER TABLE candidates ADD COLUMN skill_text TEXT NOT NULL DEFAULT ''`);
}
