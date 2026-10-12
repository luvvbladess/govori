const test = require('node:test');
const assert = require('node:assert/strict');
const { createDb } = require('../src/db');
const { createApp } = require('../src/app');

test('two participants share durable messages, fixed languages, guest voice, and private access', async () => {
  const db = createDb(':memory:'); let fail = false; let translations = 0;
  const app = createApp({ db, openaiClient: {
    callOpenAI: async (target, text, options) => {
      translations++;
      if (fail) return null;
      return { detected_lang: options.sourceLanguage, translation: target === 'Русский' ? 'Привет' : 'Hello', new_target_lang: null };
    },
    transcribeAudio: async (audio, type, language) => { assert.equal(language, 'en'); return 'Hello'; },
    createRealtimeTranscriptionCall: async () => 'answer',
  } });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const host = {}; const guest = {}; const stranger = {};
  async function request(jar, path, body, method = body ? 'POST' : 'GET') {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', cookie: jar.cookie || '' }, body: body ? JSON.stringify(body) : undefined });
    if (response.headers.get('set-cookie')) jar.cookie = response.headers.get('set-cookie').split(';')[0];
    const data = await response.json(); return { status: response.status, ...data };
  }
  try {
    assert.equal((await request(stranger, '/api/shared', { sourceLanguage: 'Русский', targetLanguage: 'Английский' })).status, 403);
    assert.equal((await request(host, '/api/auth/register', { email: 'shared-test@example.com', password: 'password123', company: 'Test' })).status, 200);
    assert.equal((await request(host, '/api/shared', { sourceLanguage: 'Русский', targetLanguage: 'Русский' })).status, 400);
    const { room } = await request(host, '/api/shared', { sourceLanguage: 'Русский', targetLanguage: 'Английский', name: 'Host' });
    assert.equal((await request(stranger, `/api/shared/${room.id}`)).status, 404);
    const joined = await request(guest, '/api/shared/join', { token: room.inviteToken, name: 'Guest' });
    assert.equal(joined.room.sourceLanguage, 'Английский'); assert.equal(joined.room.targetLanguage, 'Русский');
    assert.equal(joined.room.inviteToken, undefined);
    assert.equal((await request(stranger, '/api/shared/join', { token: room.inviteToken })).status, 200);
    assert.equal((await request(host, `/api/shared/${room.id}`)).room.participants.length, 3);
    assert.equal((await request(guest, '/api/shared/join', { token: room.inviteToken })).room.memberId, joined.room.memberId);
    const [first, second] = await Promise.all([
      request(host, `/api/shared/${room.id}/messages`, { text: 'Привет', requestId: 'request-host' }),
      request(guest, `/api/shared/${room.id}/messages`, { text: 'Hello', requestId: 'request-guest' }),
    ]);
    assert.equal(first.message.translationText, 'Hello'); assert.equal(second.message.translationText, 'Привет');
    const a = await request(host, `/api/shared/${room.id}`); const b = await request(guest, `/api/shared/${room.id}`);
    assert.deepEqual(a.messages, b.messages); assert.equal(a.messages.length, 2);
    const highWater = Math.max(...a.messages.map((message) => message.id));
    assert.equal((await request(host, `/api/shared/${room.id}?after=${highWater}`)).messages.length, 0);
    assert.equal((await request(host, `/api/shared/${room.id}?after=${highWater}&pending=${first.message.id}`)).messages[0].id, first.message.id);
    assert.equal((await request(host, `/api/shared/${room.id}?after=-1`)).status, 400);
    assert.equal((await request(host, `/api/shared/${room.id}?pending=invalid`)).status, 400);
    await request(host, `/api/shared/${room.id}/messages`, { text: 'Привет', requestId: 'request-host' });
    assert.equal(translations, 2);
    fail = true;
    const failed = await request(guest, `/api/shared/${room.id}/messages`, { text: 'Hello again', requestId: 'request-failed' });
    assert.equal(failed.status, 502); assert.equal(failed.message.status, 'failed');
    fail = false;
    const retried = await request(guest, `/api/shared/${room.id}/messages`, { text: 'Hello again', requestId: 'request-failed' });
    assert.equal(retried.message.id, failed.message.id); assert.equal(retried.message.status, 'translated');
    const audio = await fetch(`${base}/api/shared/${room.id}/transcribe`, { method: 'POST', headers: { cookie: guest.cookie, 'Content-Type': 'audio/webm' }, body: Buffer.from([1, 2, 3]) });
    assert.equal((await audio.json()).text, 'Hello');
    assert.equal((await request(guest, `/api/shared/${room.id}/live/session`, { sdp: 'offer' })).sdp, 'answer');
    assert.equal((await request(guest, '/api/auth/trial')).translationsRemaining, 3);
    await request(guest, '/api/auth/register', { email: 'shared-guest@example.com', password: 'password123', company: 'Test' });
    assert.equal((await request(guest, `/api/shared/${room.id}`)).status, 200);
    assert.equal((await request(guest, '/api/shared')).rooms.length, 1);
    // Account membership survives losing the original guest session.
    const newDevice = {};
    await request(newDevice, '/api/auth/login', { email: 'shared-guest@example.com', password: 'password123' });
    assert.equal((await request(newDevice, `/api/shared/${room.id}`)).status, 200);
  } finally { server.closeAllConnections(); server.close(); }
});
