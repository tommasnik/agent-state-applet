import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const CONFIG_DIR = path.join(os.homedir(), ".config", "agent-manager");
const DB_PATH = path.join(CONFIG_DIR, "db.sqlite");

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/** New columns added in migration v1. */
const MIGRATION_V1_COLUMNS = [
  { name: "pid", def: "INTEGER" },
  { name: "launch_type", def: "TEXT" },
  { name: "terminal_type", def: "TEXT" },
  { name: "ai_title", def: "TEXT" },
  { name: "session_id", def: "TEXT" },
] as const;

/**
 * Run an idempotent migration that adds new columns to the `runs` table.
 * SQLite does not support ADD COLUMN IF NOT EXISTS, so we check PRAGMA table_info first.
 */
function migrateRunsTable(db: Database.Database): void {
  const existing = db
    .prepare("PRAGMA table_info(runs)")
    .all() as Array<{ name: string }>;
  const existingNames = new Set(existing.map((col) => col.name));

  for (const col of MIGRATION_V1_COLUMNS) {
    if (!existingNames.has(col.name)) {
      db.exec(`ALTER TABLE runs ADD COLUMN ${col.name} ${col.def} DEFAULT NULL`);
    }
  }
}

export function initDb(dbPath?: string): Database.Database {
  const resolvedPath = dbPath ?? DB_PATH;

  // Only create CONFIG_DIR for the real (non-memory, non-custom) path
  if (!dbPath) {
    ensureConfigDir();
  }

  const db = new Database(resolvedPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS project_roots (
      id INTEGER PRIMARY KEY,
      path TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      project_path TEXT NOT NULL,
      prompt TEXT NOT NULL,
      cron TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('interactive', 'headless')),
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY,
      schedule_id INTEGER REFERENCES schedules(id),
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT CHECK(status IN ('running', 'success', 'failed', 'cancelled')),
      output TEXT
    );
  `);

  migrateRunsTable(db);

  return db;
}

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = initDb();
  }
  return _db;
}

export default getDb;
