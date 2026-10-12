const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const express = require('express');
const { createDb } = require('../src/db');
const { createSharedRouter } = require('../src/sharedRoutes');

async function setup(t) {
  const db = createDb(':memory:');
  const translations = [];
  const sessions = new Map();
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const key = req.get('x-session') || req.get('x-user');
    if (!sessions.has(key)) sessions.set(key, {});
    req.session = sessions.get(key);
    req.user = { id: req.get('x-user') };
    req.access = { authenticated: !req.user.id.startsWith('guest:') };
    next();
  });
  app.use('/api/shared', createSharedRouter(db, {
    translateText: async (pair, text) => {
      translations.push(pair.target_language);
      return { ok: true, sourceLanguage: pair.source_language,
        targetLanguage: pair.target_language, translation: `${pair.target_language}: ${text}` };
    },
    transcribeAudio: async () => 'hello',
    createRealtimeTranscriptionCall: async () => 'answer',
  }));
  const server = await new Promise(resolve => {
    const listener = app.listen(0, () => resolve(listener));
  });
  t.after(() => { server.closeAllConnections(); server.close(); db.close(); });
  async function request(user, path, body, session = user) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/shared${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', 'x-user': user, 'x-session': session },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (response.headers.get('content-type') || '').includes('application/json')
      ? await response.json() : {};
    return { status: response.status, ...data };
  }
  const { room } = await request('host', '', {
    sourceLanguage: 'Русский', targetLanguage: 'Английский', name: 'Host',
  });
  return { db, sessions, request, room, translations };
}

test('leaving removes membership across sessions, keeps message history, and permits invitation rejoin', async t => {
  const { request, room, sessions } = await setup(t);
  const joined = await request('member', '/join', { token: room.inviteToken, name: 'Alice', language: 'Французский' });
  await request('member', '/join', { token: room.inviteToken }, 'second-device');
  const sent = await request('member', `/${room.id}/messages`, { text: 'Bonjour', requestId: 'leave-message' });
  assert.equal(sent.status, 200);
  assert.equal((await request('stranger', `/${room.id}/leave`, {})).status, 404);
  assert.equal((await request('member', `/${room.id}/leave`, {})).status, 200);
  assert.equal(sessions.get('member').sharedRooms[room.id], undefined);
  for (const session of ['member', 'second-device']) {
    assert.deepEqual((await request('member', '', undefined, session)).rooms, []);
    assert.equal((await request('member', `/${room.id}`, undefined, session)).status, 404);
    assert.equal((await request('member', `/${room.id}/messages`, { text: 'Again', requestId: 'after-leave' }, session)).status, 404);
    assert.equal((await request('member', `/${room.id}/live/session`, { sdp: 'offer' }, session)).status, 404);
    assert.equal((await request('member', `/${room.id}/messages/${sent.message.id}/translation`, {}, session)).status, 404);
  }
  const history = await request('host', `/${room.id}`);
  assert.deepEqual(history.room.participants.map(member => member.name), ['Host']);
  assert.equal(history.messages[0].senderName, 'Alice');
  assert.equal(history.messages[0].sourceText, 'Bonjour');
  const rejoined = await request('member', '/join', { token: room.inviteToken, name: 'Alice again', language: 'Испанский' });
  assert.equal(rejoined.status, 200);
  assert.equal(rejoined.room.memberId, joined.room.memberId);
  assert.equal(rejoined.room.sourceLanguage, 'Испанский');
  assert.equal(rejoined.room.participants.length, 2);
  assert.equal((await request('member', '', undefined, 'second-device')).rooms.length, 1);
});

test('departed guest language is excluded from new translations and guest can explicitly rejoin', async t => {
  const { request, room, translations } = await setup(t);
  const joined = await request('guest:alice', '/join', { token: room.inviteToken, language: 'Французский' });
  await request('guest:bob', '/join', { token: room.inviteToken, language: 'Немецкий' });
  assert.equal((await request('guest:alice', `/${room.id}/leave`, {})).status, 200);
  const sent = await request('host', `/${room.id}/messages`, { text: 'Привет', requestId: 'new-message' });
  assert.equal(sent.status, 200);
  assert.deepEqual(new Set(translations), new Set(['Английский', 'Немецкий']));
  assert.equal(sent.message.translations['Французский'], undefined);
  assert.deepEqual((await request('guest:alice', '')).rooms, []);
  const rejoined = await request('guest:alice', '/join', { token: room.inviteToken });
  assert.equal(rejoined.status, 200);
  assert.equal(rejoined.room.memberId, joined.room.memberId);
});

test('host departure leaves the group and history available to others without violating the host constraint', async t => {
  const { request, room } = await setup(t);
  await request('guest:alice', '/join', { token: room.inviteToken, name: 'Alice' });
  const sent = await request('host', `/${room.id}/messages`, { text: 'Привет', requestId: 'host-history' });
  assert.equal((await request('host', `/${room.id}/leave`, {})).status, 200);
  assert.deepEqual((await request('host', '')).rooms, []);
  const history = await request('guest:alice', `/${room.id}`);
  assert.equal(history.status, 200);
  assert.deepEqual(history.room.participants.map(member => member.name), ['Alice']);
  assert.equal(history.messages[0].id, sent.message.id);
  assert.equal(history.messages[0].senderName, 'Host');
  assert.equal((await request('guest:alice', `/${room.id}/messages`, { text: 'Hello', requestId: 'after-host-left' })).status, 200);
  const rejoined = await request('host', '/join', { token: room.inviteToken });
  assert.equal(rejoined.status, 200);
  assert.equal(rejoined.room.role, 'host');
  assert.equal(rejoined.room.participants.filter(member => member.role === 'host').length, 1);
});

test('polling restarts a persisted pending language translation after interrupted work', async t => {
  const { db, request, room, translations } = await setup(t);
  const sent = await request('host', `/${room.id}/messages`, { text: 'Привет', requestId: 'pending-language' });
  await request('guest:alice', '/join', { token: room.inviteToken, language: 'Французский' });
  db.prepare("INSERT INTO shared_translations (message_id,language,text,status) VALUES (?,?,NULL,'pending')")
    .run(sent.message.id, 'Французский');
  const history = await request('guest:alice', `/${room.id}?pending=${sent.message.id}`);
  assert.equal(history.status, 200);
  assert.equal(history.messages[0].translations['Французский'].status, 'translated');
  assert.equal(history.messages[0].translations['Французский'].text, 'Французский: Привет');
  assert.equal(translations.filter(language => language === 'Французский').length, 1);
});

test('migration keeps existing group memberships active and preserves departures on reopen', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-leave-'));
  const filename = path.join(directory, 'app.db');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const legacy = new Database(filename);
  legacy.exec(`CREATE TABLE shared_members (
    id TEXT PRIMARY KEY,room_id TEXT NOT NULL,user_key TEXT NOT NULL,
    role TEXT NOT NULL,name TEXT NOT NULL,last_seen TEXT NOT NULL,language TEXT NOT NULL,
    UNIQUE(room_id,user_key));
    INSERT INTO shared_members VALUES ('member','room','guest:old','guest','Alice','date','Французский');`);
  legacy.close();
  const migrated = createDb(filename);
  try {
    assert.equal(migrated.prepare('SELECT left_at FROM shared_members WHERE id=?').get('member').left_at, null);
    migrated.prepare('UPDATE shared_members SET left_at=? WHERE id=?').run('2026-10-12T12:00:00.000Z', 'member');
  } finally { migrated.close(); }
  const reopened = createDb(filename);
  try {
    const member = reopened.prepare('SELECT * FROM shared_members WHERE id=?').get('member');
    assert.equal(member.left_at, '2026-10-12T12:00:00.000Z');
    assert.equal(member.name, 'Alice');
    assert.equal(member.language, 'Французский');
  } finally { reopened.close(); }
});
