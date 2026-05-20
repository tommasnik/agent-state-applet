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

export function initDb(): Database.Database {
  ensureConfigDir();
  const db = new Database(DB_PATH);

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
