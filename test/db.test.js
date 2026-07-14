const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { createDb } = require('../src/db');

test('createDb creates users table with expected columns', () => {
  const tmpPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'translator-db-')), 'test.db');
  const db = createDb(tmpPath);
  try {
    const columns = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
    assert.deepEqual(
      columns.sort(),
      ['created_at', 'email', 'id', 'password_hash', 'target_language'].sort()
    );

    const info = db.prepare(
      'INSERT INTO users (email, password_hash, target_language, created_at) VALUES (?, ?, ?, ?)'
    ).run('a@example.com', 'hash', null, new Date().toISOString());
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    assert.equal(row.email, 'a@example.com');
    assert.equal(row.target_language, null);
  } finally {
    db.close();
  }
});

test('createDb enforces unique email', () => {
  const tmpPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'translator-db-')), 'test.db');
  const db = createDb(tmpPath);
  try {
    db.prepare(
      'INSERT INTO users (email, password_hash, target_language, created_at) VALUES (?, ?, ?, ?)'
    ).run('dup@example.com', 'hash', null, new Date().toISOString());
    assert.throws(() => {
      db.prepare(
        'INSERT INTO users (email, password_hash, target_language, created_at) VALUES (?, ?, ?, ?)'
      ).run('dup@example.com', 'hash2', null, new Date().toISOString());
    });
  } finally {
    db.close();
  }
});
