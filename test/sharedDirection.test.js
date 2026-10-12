const test = require('node:test');
const assert = require('node:assert/strict');
const { createDb } = require('../src/db');
const { createApp } = require('../src/app');

test('three languages receive fixed translations of ambiguous phrases from every sender', async () => {
  const db = createDb(':memory:');
  const calls = [];
  const translations = { Русский: 'ОК', Английский: 'OK', Испанский: 'Vale' };
  const app = createApp({ db, openaiClient: {
    callOpenAI: async (target, text, options) => {
      calls.push({ target, text, options });
      // Ambiguous short phrases can be detected as either side of a pair.
      // A bidirectional prompt then returns the other side; group mode must
      // instead request the recipient's language regardless of that metadata.
      return { detected_lang: target, translation: translations[options.fixedDirection ? target : options.sourceLanguage], new_target_lang: null };
    },
  } });
  const server = await new Promise(resolve => { const instance = app.listen(0, () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(jar, route, body) {
    const response = await fetch(base + route, {
      method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', cookie: jar.cookie || '' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.headers.get('set-cookie')) jar.cookie = response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, ...await response.json() };
  }
  try {
    const host = {}, english = {}, spanish = {}, alsoSpanish = {};
    await request(host, '/api/auth/register', { email: 'direction@example.com', password: 'password123', company: 'Test' });
    const room = (await request(host, '/api/shared', { sourceLanguage: 'Русский', targetLanguage: 'Английский' })).room;
    for (const [member, language] of [[english, 'Английский'], [spanish, 'Испанский'], [alsoSpanish, 'Испанский']]) {
      assert.equal((await request(member, '/api/shared/join', { token: room.inviteToken, language })).status, 200);
    }
    for (const [sender, sourceLanguage] of [[host, 'Русский'], [english, 'Английский'], [spanish, 'Испанский']]) {
      const before = calls.length;
      const sent = await request(sender, `/api/shared/${room.id}/messages`, { text: 'OK', requestId: `ambiguous-${before}` });
      assert.equal(sent.status, 200);
      assert.equal(sent.message.sourceLanguage, sourceLanguage);
      assert.equal(sent.message.status, 'translated');
      for (const language of Object.keys(translations).filter(language => language !== sourceLanguage)) {
        assert.equal(sent.message.translations[language].text, translations[language]);
        assert.equal(sent.message.translations[language].status, 'translated');
      }
      assert.equal(calls.length - before, 2, 'one translation per distinct recipient language');
    }
    assert.ok(calls.every(call => call.options.fixedDirection === true));
    assert.equal((await request(alsoSpanish, `/api/shared/${room.id}`)).messages.length, 3);
  } finally {
    server.closeAllConnections(); server.close(); db.close();
  }
});
