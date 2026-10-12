const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { createTranslatorRouter } = require('../src/translatorRoutes');
const { readSpeech, writeSpeech } = require('../src/speechCache');

async function setup(t) {
  const calls = [];
  const userId = randomUUID();
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { id: userId }; req.access = { authenticated: true }; next(); });
  app.use('/api/translator', createTranslatorRouter({}, {
    createSpeech: async (text, language, voice) => {
      calls.push({ text, language, voice }); return Buffer.from(voice || 'missing-voice');
    },
  }));
  const server = await new Promise(resolve => { const listener = app.listen(0, () => resolve(listener)); });
  t.after(() => { server.closeAllConnections(); server.close(); });
  async function request(route, body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/translator${route}`, {
      method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = response.headers.get('content-type')?.includes('application/json');
    return { status: response.status, data: json ? await response.json() : await response.text() };
  }
  return { request, calls };
}

test('voice catalog exposes supported voices with a validated environment default', async t => {
  const previous = process.env.TTS_VOICE;
  t.after(() => { if (previous === undefined) delete process.env.TTS_VOICE; else process.env.TTS_VOICE = previous; });
  const { request } = await setup(t);
  process.env.TTS_VOICE = 'cedar';
  const response = await request('/voices');
  assert.equal(response.status, 200);
  assert.equal(response.data.defaultVoice, 'cedar');
  assert.equal(response.data.voices.length, 13);
  assert.ok(response.data.voices.every(voice => typeof voice.id === 'string' && typeof voice.name === 'string'));
  assert.ok(response.data.voices.some(voice => voice.id === 'marin'));
  process.env.TTS_VOICE = 'unsupported';
  assert.equal((await request('/voices')).data.defaultVoice, 'marin');
});

test('speech endpoint validates requested voice and applies the default when omitted', async t => {
  const previous = process.env.TTS_VOICE;
  t.after(() => { if (previous === undefined) delete process.env.TTS_VOICE; else process.env.TTS_VOICE = previous; });
  process.env.TTS_VOICE = 'marin';
  const { request, calls } = await setup(t);
  for (const voice of ['unsupported', null, 12, {}, ['marin']]) {
    const invalid = await request('/speech', { text: 'Hello', language: 'Английский', voice });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.data.code, 'INVALID_VOICE');
  }
  assert.equal(calls.length, 0);
  const selected = await request('/speech', { text: 'Hello', language: 'Английский', voice: 'cedar' });
  assert.equal(selected.status, 200);
  assert.equal(selected.data, 'cedar');
  const defaulted = await request('/speech', { text: 'Hello', language: 'Английский' });
  assert.equal(defaulted.data, 'marin');
  assert.deepEqual(calls.map(call => call.voice), ['cedar', 'marin']);
});

test('speech cache isolates voice, model, and user while retaining compatible optional arguments', async () => {
  const user = randomUUID();
  const text = 'Hello';
  await writeSpeech(user, text, 'Английский', Buffer.from('cedar-one'), { voice: 'cedar', model: 'model-one' });
  await writeSpeech(user, text, 'Английский', Buffer.from('marin-one'), { voice: 'marin', model: 'model-one' });
  await writeSpeech(user, text, 'Английский', Buffer.from('cedar-two'), { voice: 'cedar', model: 'model-two' });
  assert.equal((await readSpeech(user, text, 'Английский', { voice: 'cedar', model: 'model-one' })).toString(), 'cedar-one');
  assert.equal((await readSpeech(user, text, 'Английский', { voice: 'marin', model: 'model-one' })).toString(), 'marin-one');
  assert.equal((await readSpeech(user, text, 'Английский', { voice: 'cedar', model: 'model-two' })).toString(), 'cedar-two');
  assert.equal(await readSpeech(randomUUID(), text, 'Английский', { voice: 'cedar', model: 'model-one' }), null);
  await writeSpeech(user, 'Default', 'Английский', Buffer.from('default'));
  assert.equal((await readSpeech(user, 'Default', 'Английский')).toString(), 'default');
});
