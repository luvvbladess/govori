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
