// test/translatorRoutes.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createDb } = require('../src/db');

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function fetchWithCookies(baseUrl, path, options = {}, cookieJar = { cookie: '' }) {
  if (path === '/api/auth/register' && typeof options.body === 'string') {
    const payload = JSON.parse(options.body);
    if (!payload.company) options = { ...options, body: JSON.stringify({ ...payload, company: 'Test company' }) };
  }
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), cookie: cookieJar.cookie },
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookieJar.cookie = setCookie.split(';')[0];
  return res;
}

function fakeOpenaiClient(responses) {
  let call = 0;
  return {
    callOpenAI: async () => responses[Math.min(call++, responses.length - 1)],
    createSpeech: async () => Buffer.from([1, 2, 3]),
    transcribeAudio: async () => 'Привет',
    createRealtimeTranscriptionCall: async (sdp) => `answer-for:${sdp}`,
  };
}

test('guest can use three translations before registration is required', async () => {
  const db = createDb(':memory:');
  const app = createApp({ db, openaiClient: fakeOpenaiClient([{ detected_lang: 'Русский', translation: 'Hello', new_target_lang: 'Английский' }]) });
  const server = await startServer(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const jar = { cookie: '' };
  try {
    const trial = await fetchWithCookies(baseUrl, '/api/auth/trial', {}, jar);
    assert.equal((await trial.json()).translationsRemaining, 3);
    for (let index = 0; index < 3; index += 1) {
      const res = await fetchWithCookies(baseUrl, '/api/translator/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `Hello ${index}` }) }, jar);
      assert.equal(res.status, 200);
      assert.equal((await res.json()).translationsRemaining, 2 - index);
    }
    const reloaded = await fetchWithCookies(baseUrl, '/api/auth/trial', {}, jar);
    assert.equal((await reloaded.json()).translationsRemaining, 0);
    const blocked = await fetchWithCookies(baseUrl, '/api/translator/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Fourth attempt' }) }, jar);
    assert.equal(blocked.status, 403);
    assert.equal((await blocked.json()).code, 'TRIAL_LIMIT_REACHED');
  } finally {
    server.close();
  }
});

test('failed guest translation does not spend a free translation', async () => {
  const db = createDb(':memory:');
  const app = createApp({ db, openaiClient: fakeOpenaiClient([null]) });
  const server = await startServer(app); const baseUrl = `http://127.0.0.1:${server.address().port}`; const jar = { cookie: '' };
  try {
    await fetchWithCookies(baseUrl, '/api/auth/trial', {}, jar);
    const failed = await fetchWithCookies(baseUrl, '/api/translator/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Привет' }) }, jar);
    assert.equal(failed.status, 502);
    const trial = await fetchWithCookies(baseUrl, '/api/auth/trial', {}, jar);
    assert.equal((await trial.json()).translationsRemaining, 3);
  } finally { server.close(); }
});

test('translate persists the new target language on the user row', async () => {
  const db = createDb(':memory:');
  const app = createApp({
    db,
    openaiClient: fakeOpenaiClient([
      { detected_lang: 'Китайский', translation: 'Здравствуйте', new_target_lang: 'Китайский' },
    ]),
  });
  const server = await startServer(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const jar = { cookie: '' };
  try {
    await fetchWithCookies(baseUrl, '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'x@example.com', password: 'password123' }),
    }, jar);

    const pairRes = await fetchWithCookies(baseUrl, '/api/translator/set-languages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceLanguage: 'Русский', targetLanguage: 'Китайский' }),
    }, jar);
    assert.equal(pairRes.status, 200);

    const res = await fetchWithCookies(baseUrl, '/api/translator/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '你好' }),
    }, jar);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.session.targetLanguage, 'Китайский');

    const row = db.prepare('SELECT target_language FROM users WHERE email = ?').get('x@example.com');
    assert.equal(row.target_language, 'Китайский');
  } finally {
    server.close();
  }
});

test('set-languages rejects a pair with the same language on both sides', async () => {
  const db = createDb(':memory:');
  const app = createApp({ db, openaiClient: fakeOpenaiClient([]) });
  const server = await startServer(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const jar = { cookie: '' };
  try {
    await fetchWithCookies(baseUrl, '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'y@example.com', password: 'password123' }),
    }, jar);

    const res = await fetchWithCookies(baseUrl, '/api/translator/set-languages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceLanguage: 'Русский', targetLanguage: 'Русский' }),
    }, jar);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, 'INVALID_LANGUAGE_PAIR');
  } finally {
    server.close();
  }
});

test('a failed translation still persists the transcript in a conversation', async () => {
  const db = createDb(':memory:');
  const app = createApp({ db, openaiClient: fakeOpenaiClient([null]) });
  const server = await startServer(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const jar = { cookie: '' };
  try {
    await fetchWithCookies(baseUrl, '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'history@example.com', password: 'password123' }) }, jar);
    const failed = await fetchWithCookies(baseUrl, '/api/translator/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Сохрани этот текст' }) }, jar);
    assert.equal(failed.status, 502);
    const failure = await failed.json();
    assert.equal(failure.transcript, 'Сохрани этот текст');
    const history = await fetchWithCookies(baseUrl, '/api/translator/conversations', {}, jar);
    const conversations = await history.json();
    assert.equal(conversations.conversations.length, 1);
    const messages = await fetchWithCookies(baseUrl, `/api/translator/conversations/${failure.conversationId}/messages`, {}, jar);
    const body = await messages.json();
    assert.equal(body.messages[0].sourceText, 'Сохрани этот текст');
    assert.equal(body.messages[0].status, 'transcript');
  } finally { server.close(); }
});

test('a user can delete only their own conversation', async () => {
  const db = createDb(':memory:');
  const app = createApp({ db, openaiClient: fakeOpenaiClient([null]) });
  const server = await startServer(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const jar = { cookie: '' };
  try {
    await fetchWithCookies(baseUrl, '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'delete@example.com', password: 'password123' }) }, jar);
    const failed = await fetchWithCookies(baseUrl, '/api/translator/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Удаляемый текст' }) }, jar);
    const failure = await failed.json();
    const deleted = await fetchWithCookies(baseUrl, `/api/translator/conversations/${failure.conversationId}`, { method: 'DELETE' }, jar);
    assert.equal(deleted.status, 200);
    const history = await fetchWithCookies(baseUrl, '/api/translator/conversations', {}, jar);
    assert.equal((await history.json()).conversations.length, 0);
  } finally { server.close(); }
});

test('set-language validates against the fixed list and persists', async () => {
  const db = createDb(':memory:');
  const app = createApp({ db, openaiClient: fakeOpenaiClient([]) });
  const server = await startServer(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const jar = { cookie: '' };
  try {
    await fetchWithCookies(baseUrl, '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'z@example.com', password: 'password123' }),
    }, jar);

    const badRes = await fetchWithCookies(baseUrl, '/api/translator/set-language', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: 'Клингонский' }),
    }, jar);
    assert.equal(badRes.status, 400);

    const goodRes = await fetchWithCookies(baseUrl, '/api/translator/set-language', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: 'Немецкий' }),
    }, jar);
    assert.equal(goodRes.status, 200);

    const row = db.prepare('SELECT target_language FROM users WHERE email = ?').get('z@example.com');
    assert.equal(row.target_language, 'Немецкий');
  } finally {
    server.close();
  }
});

test('a thrown error in a route handler is converted to clean JSON, not a stack trace', async () => {
  const db = createDb(':memory:');
  const app = createApp({ db, openaiClient: fakeOpenaiClient([]) });
  const server = await startServer(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const jar = { cookie: '' };
  try {
    await fetchWithCookies(baseUrl, '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'errtest@example.com', password: 'password123' }),
    }, jar);

    const originalPrepare = db.prepare.bind(db);
    db.prepare = () => { throw new Error('simulated db failure'); };
    try {
      const res = await fetchWithCookies(baseUrl, '/api/translator/set-language', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: 'Немецкий' }),
      }, jar);
      assert.equal(res.status, 500);
      assert.equal(res.headers.get('content-type').includes('application/json'), true);
      const body = await res.json();
      assert.equal(body.ok, false);
      assert.equal(body.code, 'INTERNAL_ERROR');
    } finally {
      db.prepare = originalPrepare;
    }
  } finally {
    server.close();
  }
});

test('speech returns MP3 bytes for an authenticated user without exposing the API key', async () => {
  const db = createDb(':memory:');
  const app = createApp({ db, openaiClient: fakeOpenaiClient([]) });
  const server = await startServer(app); const baseUrl = `http://127.0.0.1:${server.address().port}`; const jar = { cookie: '' };
  try {
    await fetchWithCookies(baseUrl, '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'audio@example.com', password: 'password123' }) }, jar);
    const res = await fetchWithCookies(baseUrl, '/api/translator/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Hello', language: 'Английский' }) }, jar);
    assert.equal(res.status, 200); assert.equal(res.headers.get('content-type'), 'audio/mpeg'); assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [1, 2, 3]);
  } finally { server.close(); }
});

test('translate accepts a transcript longer than the former 6000 character limit', async () => {
  const db = createDb(':memory:');
  const app = createApp({
    db,
    openaiClient: fakeOpenaiClient([{ detected_lang: 'Русский', translation: 'Long transcript translated.', new_target_lang: null }]),
  });
  const server = await startServer(app); const baseUrl = `http://127.0.0.1:${server.address().port}`; const jar = { cookie: '' };
  try {
    await fetchWithCookies(baseUrl, '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'long@example.com', password: 'password123' }) }, jar);
    const text = 'Это длинная запись разговора. '.repeat(260).trim();
    assert.ok(text.length > 6000);
    const res = await fetchWithCookies(baseUrl, '/api/translator/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }, jar);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.original, text);
    assert.match(body.translation, /Long transcript translated/);
  } finally { server.close(); }
});

test('transcribe accepts browser audio and returns recognized text', async () => {
  const db = createDb(':memory:'); const app = createApp({ db, openaiClient: fakeOpenaiClient([]) }); const server = await startServer(app); const baseUrl = `http://127.0.0.1:${server.address().port}`; const jar = { cookie: '' };
  try {
    await fetchWithCookies(baseUrl, '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'speech@example.com', password: 'password123' }) }, jar);
    const res = await fetchWithCookies(baseUrl, '/api/translator/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: Buffer.from([1, 2]) }, jar);
    assert.equal(res.status, 200); assert.equal((await res.json()).text, 'Привет');
  } finally { server.close(); }
});

test('guest transcription uses the selected language and rejects a mismatched script without spending a translation', async () => {
  const db = createDb(':memory:');
  let receivedLanguage;
  const client = fakeOpenaiClient([]);
  client.transcribeAudio = async (audio, mimeType, language) => { receivedLanguage = language; return '你好'; };
  const app = createApp({ db, openaiClient: client });
  const server = await startServer(app); const baseUrl = `http://127.0.0.1:${server.address().port}`; const jar = { cookie: '' };
  try {
    await fetchWithCookies(baseUrl, '/api/auth/trial', {}, jar);
    const res = await fetchWithCookies(baseUrl, '/api/translator/transcribe?language=%D0%A0%D1%83%D1%81%D1%81%D0%BA%D0%B8%D0%B9', { method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: Buffer.from([1, 2]) }, jar);
    assert.equal(res.status, 422);
    assert.equal((await res.json()).code, 'VOICE_LANGUAGE_MISMATCH');
    assert.equal(receivedLanguage, 'ru');
    const trial = await fetchWithCookies(baseUrl, '/api/auth/trial', {}, jar);
    assert.equal((await trial.json()).translationsRemaining, 3);
  } finally { server.close(); }
});

test('live session exchanges only SDP for an authenticated user', async () => {
  const db = createDb(':memory:'); const app = createApp({ db, openaiClient: fakeOpenaiClient([]) }); const server = await startServer(app); const baseUrl = `http://127.0.0.1:${server.address().port}`; const jar = { cookie: '' };
  try {
    await fetchWithCookies(baseUrl, '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'live@example.com', password: 'password123' }) }, jar);
    const res = await fetchWithCookies(baseUrl, '/api/translator/live/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sdp: 'v=0\r\no=browser' }) }, jar);
    assert.equal(res.status, 200); assert.deepEqual(await res.json(), { ok: true, sdp: 'answer-for:v=0\r\no=browser' });
  } finally { server.close(); }
});
