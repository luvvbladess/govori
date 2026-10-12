const test = require('node:test');
const assert = require('node:assert/strict');
const { createTranslator, mapModelResponse, looksLikePromptLeak, splitText } = require('../src/translator');

function fakeClient(responses) {
  const calls = [];
  return { calls, callOpenAI: async (targetLanguage, text, options) => { calls.push({ targetLanguage, text, options }); return responses[Math.min(calls.length - 1, responses.length - 1)]; } };
}

test('translates from the first chosen language to the second', async () => {
  const client = fakeClient([{ detected_lang: 'Русский', translation: 'Hello', new_target_lang: null }]);
  const result = await createTranslator(client).translateText({ source_language: 'Русский', target_language: 'Английский' }, 'Привет');
  assert.equal(result.ok, true);
  assert.equal(result.sourceLanguage, 'Русский');
  assert.equal(result.targetLanguage, 'Английский');
  assert.equal(client.calls[0].options.sourceLanguage, 'Русский');
});

test('translates in the reverse direction when the second language is spoken', async () => {
  const client = fakeClient([{ detected_lang: 'Китайский', translation: 'Здравствуйте', new_target_lang: null }]);
  const result = await createTranslator(client).translateText({ source_language: 'Русский', target_language: 'Китайский' }, '你好');
  assert.equal(result.ok, true);
  assert.equal(result.sourceLanguage, 'Китайский');
  assert.equal(result.targetLanguage, 'Русский');
});

test('fixed direction preserves the sender and recipient languages for ambiguous text', async () => {
  const client = fakeClient([{ detected_lang: 'Английский', translation: 'OK', new_target_lang: null }]);
  const result = await createTranslator(client).translateText(
    { source_language: 'Русский', target_language: 'Английский' }, 'ОК', { fixedDirection: true }
  );
  assert.equal(result.ok, true);
  assert.equal(result.sourceLanguage, 'Русский');
  assert.equal(result.targetLanguage, 'Английский');
  assert.equal(result.translation, 'OK');
  assert.equal(client.calls[0].options.fixedDirection, true);
});

test('fixed direction retries wrong output script without reversing the language pair', async () => {
  const client = fakeClient([
    { detected_lang: 'Английский', translation: 'ОК', new_target_lang: null },
    { detected_lang: 'Английский', translation: 'OK', new_target_lang: null },
  ]);
  const result = await createTranslator(client).translateText(
    { source_language: 'Русский', target_language: 'Английский' }, 'ОК', { fixedDirection: true }
  );
  assert.equal(result.ok, true);
  assert.equal(result.targetLanguage, 'Английский');
  assert.equal(client.calls.length, 2);
  assert.equal(client.calls[1].options.strict, true);
});

test('fixed direction still rejects wrong scripts and leaked prompt instructions', async () => {
  for (const translation of ['Привет', 'Return the translation strictly in the target language.']) {
    const client = fakeClient([{ detected_lang: 'Английский', translation, new_target_lang: null }]);
    const result = await createTranslator(client).translateText(
      { source_language: 'Русский', target_language: 'Английский' }, 'Привет', { fixedDirection: true }
    );
    assert.equal(result.ok, false);
    assert.equal(client.calls.length, 2);
  }
});

test('fixed direction keeps a long message together despite varying detected language metadata', async () => {
  const client = fakeClient([
    { detected_lang: 'Английский', translation: 'First part.', new_target_lang: null },
    { detected_lang: 'Русский', translation: 'Second part.', new_target_lang: null },
  ]);
  const result = await createTranslator(client).translateText(
    { source_language: 'Русский', target_language: 'Английский' },
    'Это длинная русская фраза. '.repeat(300).trim(), { fixedDirection: true }
  );
  assert.equal(result.ok, true);
  assert.equal(result.sourceLanguage, 'Русский');
  assert.equal(result.targetLanguage, 'Английский');
  assert.equal(result.translation, 'First part.\nSecond part.');
});

test('fixed direction retries one transient provider failure', async () => {
  for (const error of [new TypeError('fetch failed'), Object.assign(new Error('rate limited'), { status: 429 }), Object.assign(new Error('unavailable'), { status: 503 })]) {
    let calls = 0;
    const client = { callOpenAI: async () => {
      if (++calls === 1) throw error;
      return { detected_lang: 'Русский', translation: 'Hello', new_target_lang: null };
    } };
    const result = await createTranslator(client).translateText(
      { source_language: 'Русский', target_language: 'Английский' }, 'Привет', { fixedDirection: true }
    );
    assert.equal(result.ok, true);
    assert.equal(calls, 2);
  }
});

test('provider retry is bounded and does not retry permanent failures or personal translations', async () => {
  for (const [error, options, expectedCalls] of [
    [Object.assign(new Error('unavailable'), { status: 503 }), { fixedDirection: true }, 2],
    [Object.assign(new Error('bad input'), { status: 400 }), { fixedDirection: true }, 1],
    [Object.assign(new Error('unauthorized'), { status: 401 }), { fixedDirection: true }, 1],
    [new Error('missing configuration'), { fixedDirection: true }, 1],
    [new TypeError('fetch failed'), {}, 1],
  ]) {
    let calls = 0;
    const result = await createTranslator({ callOpenAI: async () => { calls++; throw error; } }).translateText(
      { source_language: 'Русский', target_language: 'Английский' }, 'Привет', options
    );
    assert.equal(result.ok, false);
    assert.equal(calls, expectedCalls);
  }
});

test('retries once when the response is not in the selected target language', async () => {
  const client = fakeClient([
    { detected_lang: 'Русский', translation: 'Привет', new_target_lang: null },
    { detected_lang: 'Русский', translation: 'Hello', new_target_lang: null },
  ]);
  const result = await createTranslator(client).translateText({ source_language: 'Русский', target_language: 'Английский' }, 'Привет');
  assert.equal(result.ok, true);
  assert.equal(client.calls.length, 2);
});

test('rejects a model response whose detected language is outside the selected pair', async () => {
  const client = fakeClient([{ detected_lang: 'Китайский', translation: '你好', new_target_lang: null }]);
  const result = await createTranslator(client).translateText({ source_language: 'Русский', target_language: 'Английский' }, 'Привет');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'TRANSLATION_FAILED');
  assert.deepEqual(mapModelResponse('Русский', 'Английский', { detected_lang: 'Китайский' }), null);
});

test('rejects leaked internal translation instructions', () => {
  assert.equal(looksLikePromptLeak('Return the translation strictly in the target language, do not copy the original.'), true);
  assert.equal(looksLikePromptLeak('Hello, how are you?'), false);
});

test('splits long text without losing its contents', () => {
  const text = 'Длинная фраза для проверки. '.repeat(500).trim();
  const chunks = splitText(text, 500);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 500));
  assert.equal(chunks.join(' ').replace(/\s+/g, ' '), text.replace(/\s+/g, ' '));
});

test('translates long transcripts in chunks and joins the result', async () => {
  const source = 'Это длинная русская фраза. '.repeat(300).trim();
  const client = fakeClient([
    { detected_lang: 'Русский', translation: 'First translated part.', new_target_lang: null },
    { detected_lang: 'Русский', translation: 'Second translated part.', new_target_lang: null },
  ]);
  const result = await createTranslator(client).translateText({ source_language: 'Русский', target_language: 'Английский' }, source);
  assert.equal(result.ok, true);
  assert.equal(result.original, source);
  assert.ok(client.calls.length > 1);
  assert.equal(result.translation, 'First translated part.\nSecond translated part.');
});

test('creates speech for long translations in multiple chunks', async () => {
  const calls = [];
  const client = {
    createSpeech: async (text, language) => {
      calls.push({ text, language });
      return Buffer.from(`part-${calls.length}`);
    },
  };
  const audio = await createTranslator(client).createSpeech('a'.repeat(8000), 'English');
  assert.ok(calls.length > 1);
  assert.ok(calls.every(({ text }) => text.length <= 3500));
  assert.equal(audio.toString(), 'part-1part-2part-3');
});

test('chosen speech voice is forwarded unchanged to every long-text chunk', async () => {
  const calls = [];
  const translator = createTranslator({ createSpeech: async (text, language, voice) => {
    calls.push({ text, language, voice }); return Buffer.from([1]);
  } });
  await translator.createSpeech('a'.repeat(8000), 'Английский', 'cedar');
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.voice === 'cedar' && call.language === 'Английский'));
});
