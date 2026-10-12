const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'data', 'app.db');

function createDb(dbPath = DEFAULT_DB_PATH) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      target_language TEXT,
      created_at TEXT NOT NULL
    );
  `);
  const columns = db.prepare('PRAGMA table_info(users)').all().map((column) => column.name);
  if (!columns.includes('source_language')) db.exec('ALTER TABLE users ADD COLUMN source_language TEXT');
  if (!columns.includes('company')) db.exec('ALTER TABLE users ADD COLUMN company TEXT');
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      source_language TEXT NOT NULL,
      target_language TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversation_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      source_text TEXT NOT NULL,
      source_language TEXT,
      translation_text TEXT,
      target_language TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON conversation_messages(conversation_id, created_at ASC);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS shared_rooms (
      id TEXT PRIMARY KEY, owner_id INTEGER NOT NULL, invite_token TEXT UNIQUE NOT NULL,
      source_language TEXT NOT NULL, target_language TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shared_members (
      id TEXT PRIMARY KEY, room_id TEXT NOT NULL, user_key TEXT NOT NULL,
      role TEXT NOT NULL, name TEXT NOT NULL, last_seen TEXT NOT NULL,
      UNIQUE(room_id, role)
    );
    CREATE TABLE IF NOT EXISTS shared_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT NOT NULL, member_id TEXT NOT NULL,
      request_id TEXT NOT NULL, source_text TEXT NOT NULL, source_language TEXT NOT NULL,
      translation_text TEXT, target_language TEXT NOT NULL, status TEXT NOT NULL,
      created_at TEXT NOT NULL, UNIQUE(room_id, member_id, request_id)
    );
    CREATE INDEX IF NOT EXISTS idx_shared_messages_room ON shared_messages(room_id, id);
    CREATE INDEX IF NOT EXISTS idx_shared_members_user ON shared_members(user_key, room_id);
  `);
  const roomColumns = db.prepare('PRAGMA table_info(shared_rooms)').all().map((c) => c.name);
  if (!roomColumns.includes('title')) db.exec("ALTER TABLE shared_rooms ADD COLUMN title TEXT NOT NULL DEFAULT ''");
  const memberColumns = db.prepare('PRAGMA table_info(shared_members)').all().map((c) => c.name);
  if (!memberColumns.includes('language')) {
    db.transaction(() => {
      db.exec(`CREATE TABLE shared_members_group (
        id TEXT PRIMARY KEY, room_id TEXT NOT NULL, user_key TEXT NOT NULL,
        role TEXT NOT NULL, name TEXT NOT NULL, last_seen TEXT NOT NULL, language TEXT NOT NULL,
        UNIQUE(room_id, user_key)
      );
      INSERT INTO shared_members_group SELECT m.id,m.room_id,m.user_key,m.role,m.name,m.last_seen,
        CASE WHEN m.role='host' THEN r.source_language ELSE r.target_language END
        FROM shared_members m JOIN shared_rooms r ON r.id=m.room_id;
      DROP TABLE shared_members;
      ALTER TABLE shared_members_group RENAME TO shared_members;`);
    })();
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_shared_members_user ON shared_members(user_key, room_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_shared_single_host ON shared_members(room_id) WHERE role='host';
    CREATE TABLE IF NOT EXISTS shared_translations (
      message_id INTEGER NOT NULL, language TEXT NOT NULL, text TEXT, status TEXT NOT NULL,
      PRIMARY KEY(message_id, language)
    );
    INSERT OR IGNORE INTO shared_translations SELECT id,target_language,translation_text,'translated'
      FROM shared_messages WHERE status='translated' AND translation_text IS NOT NULL;`);
  return db;
}

module.exports = { createDb, DEFAULT_DB_PATH };
