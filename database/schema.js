/** Inicializa SQLite, suas restrições e as tabelas persistentes da aplicação. */
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
// Functions da Vercel só podem gravar arquivos temporários em /tmp.
const dbPath = process.env.DATABASE_PATH || (process.env.VERCEL ? "/tmp/inventory.db" : path.join(__dirname, "inventory.db"));
const dbDir = path.dirname(dbPath);
fs.mkdirSync(dbDir, { recursive: true });
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT DEFAULT 'admin', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS computers (
 id INTEGER PRIMARY KEY, hostname TEXT NOT NULL, department TEXT NOT NULL, location TEXT NOT NULL, responsible TEXT NOT NULL, brand TEXT NOT NULL, model TEXT NOT NULL, serial_number TEXT NOT NULL,
 processor TEXT NOT NULL, ram_gb INTEGER NOT NULL, ram_type TEXT, storage_type TEXT NOT NULL, storage_capacity TEXT NOT NULL,
 operating_system TEXT NOT NULL, windows_version TEXT, windows_build TEXT, ip_address TEXT, computer_password TEXT,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT NOT NULL, entity TEXT NOT NULL, entity_id INTEGER, details TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, data TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_computer_search ON computers(hostname, department, location, responsible);
CREATE INDEX IF NOT EXISTS idx_computer_department ON computers(department);
CREATE INDEX IF NOT EXISTS idx_computer_brand ON computers(brand);
CREATE INDEX IF NOT EXISTS idx_computer_os ON computers(operating_system);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
`);
// Migração: preserva somente os campos definidos no formulário simplificado.
const computerColumns = db.prepare("PRAGMA table_info(computers)").all();
if (computerColumns.some((column) => column.name === "asset_tag")) {
  db.exec(`
    ALTER TABLE computers RENAME TO computers_legacy;
    CREATE TABLE computers (
      id INTEGER PRIMARY KEY, hostname TEXT NOT NULL, department TEXT NOT NULL, location TEXT NOT NULL,
      responsible TEXT NOT NULL, brand TEXT NOT NULL, model TEXT NOT NULL, serial_number TEXT NOT NULL,
      processor TEXT NOT NULL, ram_gb INTEGER NOT NULL, ram_type TEXT, storage_type TEXT NOT NULL,
      storage_capacity TEXT NOT NULL, operating_system TEXT NOT NULL, windows_version TEXT,
      windows_build TEXT, ip_address TEXT, computer_password TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO computers (id,hostname,department,location,responsible,brand,model,serial_number,processor,ram_gb,ram_type,storage_type,storage_capacity,operating_system,windows_version,windows_build,ip_address,computer_password,created_at,updated_at)
    SELECT id,hostname,department,COALESCE(sector,''),responsible,brand,model,serial_number,processor,ram_gb,ram_type,storage_type,storage_capacity,operating_system,windows_version,windows_build,ip_address,computer_password,created_at,updated_at FROM computers_legacy;
    DROP TABLE computers_legacy;
    CREATE INDEX IF NOT EXISTS idx_computer_search ON computers(hostname, department, location, responsible);
    CREATE INDEX IF NOT EXISTS idx_computer_department ON computers(department);
    CREATE INDEX IF NOT EXISTS idx_computer_brand ON computers(brand);
    CREATE INDEX IF NOT EXISTS idx_computer_os ON computers(operating_system);
  `);
}
module.exports = db;
