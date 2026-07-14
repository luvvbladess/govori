const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const session = require('express-session');
const { createDb } = require('../src/db');
const { createAuthRouter, requireAuth } = require('../src/auth');

function buildTestApp() {
  const db = createDb(':memory:');
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: false }));
  app.use('/api/auth', createAuthRouter(db));
  app.get('/api/protected', requireAuth(db), (req, res) => res.json({ ok: true, email: req.user.email }));
  return { app, db };
}

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

test('register creates a user and starts a session', async () => {
  const { app } = buildTestApp();
  const server = await startServer(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const jar = { cookie: '' };
  try {
    const res = await fetchWithCookies(baseUrl, '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password: 'password123' }),
    }, jar);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.email, 'a@example.com');
    assert.equal(body.targetLanguage, null);

    const protectedRes = await fetchWithCookies(baseUrl, '/api/protected', {}, jar);
    assert.equal(protectedRes.status, 200);
  } finally {
    server.close();
  }
});

test('register rejects a duplicate email', async () => {
  const { app } = buildTestApp();
  const server = await startServer(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await fetchWithCookies(baseUrl, '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'dup@example.com', password: 'password123' }),
    });
    const res = await fetchWithCookies(baseUrl, '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'dup@example.com', password: 'password123' }),
    });
    assert.equal(res.status, 409);
  } finally {
    server.close();
  }
});

test('login with correct credentials starts a session; wrong password is rejected', async () => {
  const { app } = buildTestApp();
  const server = await startServer(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'b@example.com', password: 'password123' }),
    });

    const badLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'b@example.com', password: 'wrongpass' }),
    });
    assert.equal(badLogin.status, 401);

    const jar = { cookie: '' };
    const goodLogin = await fetchWithCookies(baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'b@example.com', password: 'password123' }),
    }, jar);
    assert.equal(goodLogin.status, 200);

    const me = await fetchWithCookies(baseUrl, '/api/auth/me', {}, jar);
    assert.equal(me.status, 200);
    const meBody = await me.json();
    assert.equal(meBody.email, 'b@example.com');
  } finally {
    server.close();
  }
});

test('protected route without a session returns 401', async () => {
  const { app } = buildTestApp();
  const server = await startServer(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${baseUrl}/api/protected`);
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

test('logout clears the session', async () => {
  const { app } = buildTestApp();
  const server = await startServer(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const jar = { cookie: '' };
  try {
    await fetchWithCookies(baseUrl, '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'c@example.com', password: 'password123' }),
    }, jar);
    await fetchWithCookies(baseUrl, '/api/auth/logout', { method: 'POST' }, jar);
    const res = await fetchWithCookies(baseUrl, '/api/protected', {}, jar);
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});
