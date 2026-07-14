// test/app.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

test('GET /health returns ok', async () => {
  const app = createApp({ db: null, openaiClient: null });
  const server = await startServer(app);
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { ok: true });
  } finally {
    server.close();
  }
});
