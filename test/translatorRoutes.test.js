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
  };
}

test('translate requires authentication', async () => {
  const db = createDb(':memory:');
  const app = createApp({ db, openaiClient: fakeOpenaiClient([]) });
  const server = await startServer(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${baseUrl}/api/translator/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'привет' }),
    });
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
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

test('translate without a known pair returns 409 TARGET_LANGUAGE_REQUIRED', async () => {
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

    const res = await fetchWithCookies(baseUrl, '/api/translator/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Мы посетим фабрику' }),
    }, jar);
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, 'TARGET_LANGUAGE_REQUIRED');
  } finally {
    server.close();
  }
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
