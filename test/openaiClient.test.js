// test/openaiClient.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseModelResponse, callOpenAI, createSpeech, transcribeAudio, createRealtimeTranscriptionCall } = require('../src/openaiClient');

test('parseModelResponse parses plain JSON', () => {
  const raw = '{"detected_lang": "Китайский", "translation": "Здравствуйте", "new_target_lang": "Китайский"}';
  assert.deepEqual(parseModelResponse(raw), {
    detected_lang: 'Китайский',
    translation: 'Здравствуйте',
    new_target_lang: 'Китайский',
  });
});

test('parseModelResponse strips ```json fences with CRLF', () => {
  const raw = '```json\r\n{"detected_lang": "Русский", "translation": "我们将参观工厂", "new_target_lang": null}\r\n```';
  const parsed = parseModelResponse(raw);
  assert.equal(parsed.detected_lang, 'Русский');
  assert.equal(parsed.new_target_lang, null);
});

test('parseModelResponse strips ``` fences without "json" label, case-insensitive', () => {
  const raw = '```JSON\n{"detected_lang": "Английский", "translation": "Hi", "new_target_lang": "Английский"}\n```';
  const parsed = parseModelResponse(raw);
  assert.equal(parsed.translation, 'Hi');
});

test('parseModelResponse returns null on invalid JSON', () => {
  assert.equal(parseModelResponse('not json at all'), null);
});

test('parseModelResponse returns null when the parsed JSON is not an object (e.g. bare null)', () => {
  assert.equal(parseModelResponse('null'), null);
  assert.equal(parseModelResponse('42'), null);
  assert.equal(parseModelResponse('"just a string"'), null);
});

test('parseModelResponse returns null when translation is missing/empty', () => {
  assert.equal(parseModelResponse('{"detected_lang":"Русский","translation":"","new_target_lang":null}'), null);
  assert.equal(parseModelResponse('{"detected_lang":"Русский","new_target_lang":null}'), null);
});

test('callOpenAI sends expected request and returns parsed response', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.TRANSLATOR_MODEL = 'test-model';

  let capturedUrl, capturedOptions;
  globalThis.fetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"detected_lang":"Китайский","translation":"Здравствуйте","new_target_lang":"Китайский"}' } }],
      }),
    };
  };

  try {
    const result = await callOpenAI(null, '你好，你好吗？');
    assert.equal(capturedUrl, 'https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(capturedOptions.body);
    assert.equal(body.model, 'test-model');
    assert.equal(capturedOptions.headers.Authorization, 'Bearer test-key');
    assert.equal(result.translation, 'Здравствуйте');
  } finally {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  }
});

test('callOpenAI adds a stricter instruction when options.strict is true', async () => {
  const originalFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'test-key';
  let capturedBody;
  globalThis.fetch = async (url, options) => {
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"detected_lang":"Русский","translation":"我们将参观工厂","new_target_lang":null}' } }],
      }),
    };
  };

  try {
    await callOpenAI('Китайский', 'Мы посетим фабрику', { strict: true });
    const systemMessage = capturedBody.messages[0];
    const lastMessage = capturedBody.messages[capturedBody.messages.length - 1];
    assert.match(systemMessage.content, /Повторная проверка/);
    assert.equal(lastMessage.role, 'user');
    assert.equal(lastMessage.content, 'Мы посетим фабрику');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('callOpenAI returns null when the model reply cannot be parsed', async () => {
  const originalFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'test-key';
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: 'garbage' } }] }),
  });

  try {
    const result = await callOpenAI(null, 'hi');
    assert.equal(result, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('group translation prompts specify one recipient language even on a strict retry', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ choices: [{ message: {
      content: '{"detected_lang":"Русский","translation":"Hola","new_target_lang":null}',
    } }] }) };
  };
  try {
    for (const strict of [false, true]) {
      await callOpenAI('Испанский', 'Привет', { sourceLanguage: 'Русский', fixedDirection: true, strict });
    }
    for (const request of requests) {
      assert.match(request.messages[0].content, /язык отправителя: Русский/i);
      assert.match(request.messages[0].content, /всегда на язык получателя: Испанский/i);
      assert.doesNotMatch(request.messages[0].content, /другой язык (?:пары|выбранной пары)/i);
      assert.deepEqual(request.messages.at(-1), { role: 'user', content: 'Привет' });
    }
    assert.match(requests[1].messages[0].content, /Повторная проверка/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});

test('callOpenAI exposes only the provider HTTP status for retry classification', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';
  globalThis.fetch = async () => ({ ok: false, status: 429 });
  try {
    await assert.rejects(callOpenAI('Английский', 'Привет'), (error) => {
      assert.equal(error.status, 429);
      assert.equal(error.message, 'OpenAI request failed with status 429');
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});

test('createSpeech requests OpenAI TTS and returns an audio buffer', async () => {
  const originalFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'test-key';
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
  };
  try {
    const audio = await createSpeech('Hello', 'Английский');
    assert.equal(request.url, 'https://api.openai.com/v1/audio/speech');
    const body = JSON.parse(request.options.body);
    assert.equal(body.model, 'gpt-4o-mini-tts');
    assert.equal(body.input, 'Hello');
    assert.deepEqual([...audio], [1, 2, 3]);
  } finally { globalThis.fetch = originalFetch; }
});

test('transcribeAudio posts an audio file to OpenAI and returns its text', async () => {
  const originalFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'test-key';
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ text: 'Привет' }) };
  };
  try {
    assert.equal(await transcribeAudio(Buffer.from([1, 2]), 'audio/webm', 'ru'), 'Привет');
    assert.equal(request.url, 'https://api.openai.com/v1/audio/transcriptions');
    assert.equal(request.options.body.get('model'), 'gpt-transcribe');
    assert.deepEqual(request.options.body.getAll('languages[]'), ['ru']);
  } finally { globalThis.fetch = originalFetch; }
});

test('transcribeAudio uses a filename matching Safari MP4 recordings', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    const file = options.body.get('file');
    assert.equal(file.name, 'recording.mp4');
    assert.equal(file.type, 'audio/mp4');
    return { ok: true, json: async () => ({ text: '你好' }) };
  };
  try {
    assert.equal(await transcribeAudio(Buffer.from([1, 2]), 'audio/mp4;codecs=mp4a.40.2', 'zh'), '你好');
  } finally {
    global.fetch = originalFetch;
  }
});

test('createRealtimeTranscriptionCall sends SDP and session as multipart text fields', async () => {
  const originalFetch = globalThis.fetch; process.env.OPENAI_API_KEY = 'test-key'; let request;
  globalThis.fetch = async (url, options) => { request = { url, options }; return { ok: true, text: async () => 'v=0\r\no=openai' }; };
  try {
    assert.equal(await createRealtimeTranscriptionCall('v=0\r\no=browser', 42), 'v=0\r\no=openai');
    assert.equal(request.url, 'https://api.openai.com/v1/realtime/calls');
    assert.equal(request.options.body.get('sdp'), 'v=0\r\no=browser');
    assert.equal(JSON.parse(request.options.body.get('session')).type, 'transcription');
    assert.match(request.options.headers['OpenAI-Safety-Identifier'], /^[a-f0-9]{64}$/);
  } finally { globalThis.fetch = originalFetch; }
});

test('default translation model uses GPT-6 Luna compatible parameters and legacy override remains supported', async t => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  t.after(() => { globalThis.fetch = originalFetch; process.env = originalEnv; });
  process.env.OPENAI_API_KEY = 'test-key';
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"detected_lang":"Русский","translation":"Hello","new_target_lang":null}' } }] }) };
  };
  delete process.env.TRANSLATOR_MODEL;
  await callOpenAI('Английский', 'Привет');
  assert.equal(requests[0].model, 'gpt-6-luna');
  assert.equal(requests[0].reasoning_effort, 'none');
  assert.equal(requests[0].temperature, undefined);
  process.env.TRANSLATOR_MODEL = 'gpt-4o-mini';
  await callOpenAI('Английский', 'Привет');
  assert.equal(requests[1].model, 'gpt-4o-mini');
  assert.equal(requests[1].temperature, 0);
  assert.equal(requests[1].reasoning_effort, undefined);
  for (const model of ['gpt-6-astra', 'gpt-6.1-sol']) {
    process.env.TRANSLATOR_MODEL = model;
    await callOpenAI('Английский', 'Привет');
    assert.equal(requests.at(-1).reasoning_effort, 'low');
    assert.equal(requests.at(-1).temperature, undefined);
  }
});

test('selected TTS voice reaches provider and invalid voices are rejected before fetch', async t => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  t.after(() => { globalThis.fetch = originalFetch; process.env = originalEnv; });
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.TTS_VOICE = 'invalid-environment-value';
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer };
  };
  await createSpeech('Hello', 'Английский', 'cedar');
  assert.equal(requests[0].voice, 'cedar');
  await createSpeech('Hello', 'Английский');
  assert.equal(requests[1].voice, 'marin');
  await assert.rejects(createSpeech('Hello', 'Английский', 'custom-invalid'));
  assert.equal(requests.length, 2);
});

test('file transcription uses new model languages hint and preserves configured legacy language field', async t => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  t.after(() => { globalThis.fetch = originalFetch; process.env = originalEnv; });
  process.env.OPENAI_API_KEY = 'test-key';
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(options.body);
    return { ok: true, json: async () => ({ text: 'Hello' }) };
  };
  delete process.env.TRANSCRIBE_MODEL;
  await transcribeAudio(Buffer.from([1]), 'audio/webm', 'en');
  assert.equal(requests[0].get('model'), 'gpt-transcribe');
  assert.deepEqual(requests[0].getAll('languages[]'), ['en']);
  assert.equal(requests[0].get('language'), null);
  process.env.TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe';
  await transcribeAudio(Buffer.from([1]), 'audio/webm', 'en');
  assert.equal(requests[1].get('language'), 'en');
  assert.deepEqual(requests[1].getAll('languages[]'), []);
});
