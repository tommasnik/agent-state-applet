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
  { name: "tty", def: "TEXT" },
  { name: "project_root", def: "TEXT" },
] as const;

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
  return !!row;
}

function columnNames(db: Database.Database, table: string): Set<string> {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(cols.map((c) => c.name));
}

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

/**
 * Migration v2 — rename the `schedules` feature to `agents`:
 *   - rebuild the legacy `schedules` table as `agents` with relaxed constraints
 *     (cron / prompt now NULLABLE — an agent may have no schedule and/or no prompt)
 *     and the new `shortcut_icon` column,
 *   - rebuild `runs`, renaming `schedule_id` → `agent_id` and pointing its
 *     foreign key at agents(id) (a plain RENAME COLUMN would leave the FK
 *     dangling at the dropped `schedules` table).
 *
 * Done with foreign keys disabled so the table swaps don't trip FK enforcement
 * (foreign_keys defaults to ON with this better-sqlite3 build). Idempotent and
 * safe on fresh DBs (guarded by tableExists / column checks).
 */
function migrateSchedulesToAgents(db: Database.Database): void {
  const hasSchedules = tableExists(db, "schedules");
  const hasAgents = tableExists(db, "agents");
  const runsExists = tableExists(db, "runs");
  const runsCols = runsExists ? columnNames(db, "runs") : new Set<string>();
  const runsSql = runsExists
    ? ((db.prepare("SELECT sql FROM sqlite_master WHERE name = 'runs'").get() as { sql: string } | undefined)?.sql ?? "")
    : "";
  // Rebuild runs when it still has the old column name, OR when its foreign key
  // still points at the (renamed/dropped) schedules table — the latter happens
  // if an earlier migration used ALTER TABLE RENAME COLUMN (which keeps the FK).
  const needRuns = runsExists && (runsCols.has("schedule_id") || /REFERENCES\s+schedules/i.test(runsSql));
  const needAgents = hasSchedules && !hasAgents;

  if (!hasSchedules && !needRuns) return;

  db.pragma("foreign_keys = OFF");
  try {
    const migrate = db.transaction(() => {
      if (needAgents) {
        db.exec(`
          CREATE TABLE agents (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            project_path TEXT NOT NULL,
            prompt TEXT,
            cron TEXT,
            type TEXT NOT NULL CHECK(type IN ('interactive', 'headless', 'calendar_agent', 'calendar_agent_cli')),
            enabled INTEGER NOT NULL DEFAULT 1,
            shortcut_icon TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          INSERT INTO agents (id, name, project_path, prompt, cron, type, enabled, created_at)
            SELECT id, name, project_path, prompt, cron, type, enabled, created_at FROM schedules;
        `);
      }

      if (needRuns) {
        // Rebuild runs preserving every existing column (incl. v1 additions),
        // renaming schedule_id → agent_id and redirecting the FK to agents(id).
        const cols = db.prepare("PRAGMA table_info(runs)").all() as ColumnInfo[];
        const defs: string[] = [];
        const newNames: string[] = [];
        const oldNames: string[] = [];
        for (const c of cols) {
          const name = c.name === "schedule_id" ? "agent_id" : c.name;
          let def = `${name} ${c.type || "TEXT"}`;
          if (c.pk) def += " PRIMARY KEY";
          else if (c.notnull) def += " NOT NULL";
          if (c.dflt_value !== null && c.dflt_value !== undefined) def += ` DEFAULT ${c.dflt_value}`;
          defs.push(def);
          newNames.push(name);
          oldNames.push(c.name);
        }
        defs.push("FOREIGN KEY(agent_id) REFERENCES agents(id)");
        db.exec(`CREATE TABLE runs_migrated (${defs.join(", ")})`);
        db.exec(
          `INSERT INTO runs_migrated (${newNames.join(", ")}) SELECT ${oldNames.join(", ")} FROM runs`
        );
        db.exec("DROP TABLE runs");
        db.exec("ALTER TABLE runs_migrated RENAME TO runs");
      }

      // Drop the legacy table last (data already lives in `agents`). Covers both
      // a clean upgrade and a stale leftover from an interrupted earlier migration.
      if (tableExists(db, "schedules")) {
        db.exec("DROP TABLE schedules");
      }
    });
    migrate();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

/**
 * Run an idempotent migration that adds new columns to the `runs` table.
 * SQLite does not support ADD COLUMN IF NOT EXISTS, so we check PRAGMA table_info first.
 */
function migrateRunsTable(db: Database.Database): void {
  const existingNames = columnNames(db, "runs");

  for (const col of MIGRATION_V1_COLUMNS) {
    if (!existingNames.has(col.name)) {
      db.exec(`ALTER TABLE runs ADD COLUMN ${col.name} ${col.def} DEFAULT NULL`);
    }
  }
}

/** Ensure the `agents` table has all expected columns (idempotent). */
function migrateAgentsTable(db: Database.Database): void {
  const existingNames = columnNames(db, "agents");
  if (!existingNames.has("shortcut_icon")) {
    db.exec("ALTER TABLE agents ADD COLUMN shortcut_icon TEXT DEFAULT NULL");
  }
  migrateAgentsTypeCheck(db);
}

/**
 * Widen the agents.type CHECK constraint to allow 'calendar_agent' and
 * 'calendar_agent_cli'. SQLite cannot ALTER a CHECK constraint, so rebuild the
 * table when the stored schema still lacks 'calendar_agent_cli'. Idempotent: a
 * no-op once migrated or on a fresh DB (the CREATE TABLE above already includes
 * the new values). The guard checks the *narrowest* value ('calendar_agent_cli')
 * so a DB previously widened only to 'calendar_agent' is still upgraded.
 */
function migrateAgentsTypeCheck(db: Database.Database): void {
  if (!tableExists(db, "agents")) return;
  const sql =
    (db.prepare("SELECT sql FROM sqlite_master WHERE name = 'agents'").get() as
      | { sql: string }
      | undefined)?.sql ?? "";
  if (sql.includes("calendar_agent_cli")) return; // already widened (or fresh DB)

  db.pragma("foreign_keys = OFF");
  try {
    const migrate = db.transaction(() => {
      db.exec(`
        CREATE TABLE agents_migrated (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          project_path TEXT NOT NULL,
          prompt TEXT,
          cron TEXT,
          type TEXT NOT NULL CHECK(type IN ('interactive', 'headless', 'calendar_agent', 'calendar_agent_cli')),
          enabled INTEGER NOT NULL DEFAULT 1,
          shortcut_icon TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO agents_migrated (id, name, project_path, prompt, cron, type, enabled, shortcut_icon, created_at)
          SELECT id, name, project_path, prompt, cron, type, enabled, shortcut_icon, created_at FROM agents;
        DROP TABLE agents;
        ALTER TABLE agents_migrated RENAME TO agents;
      `);
    });
    migrate();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

export function initDb(dbPath?: string): Database.Database {
  const resolvedPath = dbPath ?? DB_PATH;

  // Only create CONFIG_DIR for the real (non-memory, non-custom) path
  if (!dbPath) {
    ensureConfigDir();
  }

  const db = new Database(resolvedPath);

  // Rename legacy schedules→agents and runs.schedule_id→agent_id BEFORE the
  // CREATE TABLE IF NOT EXISTS below, so an existing DB is migrated rather than
  // shadowed by a fresh empty `agents` table.
  migrateSchedulesToAgents(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS project_roots (
      id INTEGER PRIMARY KEY,
      path TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      project_path TEXT NOT NULL,
      prompt TEXT,
      cron TEXT,
      type TEXT NOT NULL CHECK(type IN ('interactive', 'headless')),
      enabled INTEGER NOT NULL DEFAULT 1,
      shortcut_icon TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY,
      agent_id INTEGER REFERENCES agents(id),
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT CHECK(status IN ('running', 'success', 'failed', 'cancelled')),
      output TEXT
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id INTEGER PRIMARY KEY,
      run_id INTEGER,
      session_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'answered', 'dismissed')),
      payload TEXT,
      answer TEXT,
      answered_at TEXT
    );
  `);

  migrateRunsTable(db);
  migrateAgentsTable(db);

  return db;
}

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = initDb();
  }
  return _db;
}

/** Override the singleton for tests. Call with an in-memory DB before each test. */
export function setTestDb(db: Database.Database): void {
  _db = db;
}

export default getDb;
