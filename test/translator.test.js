const test = require('node:test');
const assert = require('node:assert/strict');
const { createTranslator } = require('../src/translator');

function fakeClient(responses) {
  const calls = [];
  return {
    calls,
    callOpenAI: async (currentTarget, text, options) => {
      calls.push({ currentTarget, text, options });
      return responses[Math.min(calls.length - 1, responses.length - 1)];
    },
  };
}

test('1. First Russian text without a pair returns TARGET_LANGUAGE_REQUIRED without calling the model', async () => {
  let called = false;
  const client = { callOpenAI: async () => { called = true; } };
  const translator = createTranslator(client);
  const result = await translator.translateText({ target_language: null }, 'Мы посетим фабрику');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'TARGET_LANGUAGE_REQUIRED');
  assert.equal(called, false);
});

test('2. Chinese text translates to Russian and sets Chinese as the new target', async () => {
  const client = fakeClient([
    { detected_lang: 'Китайский', translation: 'Здравствуйте, как вы?', new_target_lang: 'Китайский' },
  ]);
  const translator = createTranslator(client);
  const result = await translator.translateText({ target_language: null }, '你好，你好吗？');
  assert.equal(result.ok, true);
  assert.equal(result.sourceLanguage, 'Китайский');
  assert.equal(result.targetLanguage, 'Русский');
  assert.equal(result.translation, 'Здравствуйте, как вы?');
  assert.equal(result.voiceText, 'Здравствуйте, как вы?');
  assert.equal(result.session.targetLanguage, 'Китайский');
});

test('3. Russian text with a known pair translates to Chinese', async () => {
  const client = fakeClient([
    { detected_lang: 'Русский', translation: '我们将参观工厂', new_target_lang: null },
  ]);
  const translator = createTranslator(client);
  const result = await translator.translateText({ target_language: 'Китайский' }, 'Мы посетим фабрику');
  assert.equal(result.ok, true);
  assert.equal(result.sourceLanguage, 'Русский');
  assert.equal(result.targetLanguage, 'Китайский');
  assert.equal(result.translation, '我们将参观工厂');
  assert.equal(result.session.targetLanguage, 'Китайский');
});

test('4. An English phrase switches the pair from Chinese to English', async () => {
  const client = fakeClient([
    { detected_lang: 'Английский', translation: 'Привет', new_target_lang: 'Английский' },
  ]);
  const translator = createTranslator(client);
  const result = await translator.translateText({ target_language: 'Китайский' }, 'Hello there');
  assert.equal(result.ok, true);
  assert.equal(result.sourceLanguage, 'Английский');
  assert.equal(result.targetLanguage, 'Русский');
  assert.equal(result.session.targetLanguage, 'Английский');
});

test('5. Explicit command switches the language', async () => {
  const client = fakeClient([
    { detected_lang: 'Русский', translation: 'How are you?', new_target_lang: 'Английский' },
  ]);
  const translator = createTranslator(client);
  const result = await translator.translateText({ target_language: null }, 'Переведи на английский: как дела?');
  assert.equal(result.ok, true);
  assert.equal(result.sourceLanguage, 'Русский');
  assert.equal(result.targetLanguage, 'Английский');
  assert.equal(result.translation, 'How are you?');
  assert.equal(result.session.targetLanguage, 'Английский');
});

test('6. JSON in a code block with CRLF is parsed correctly', async () => {
  const client = {
    callOpenAI: async () => ({
      detected_lang: 'Китайский',
      translation: 'Привет',
      new_target_lang: 'Китайский',
    }),
  };
  const translator = createTranslator(client);
  const result = await translator.translateText({ target_language: null }, '你好');
  assert.equal(result.ok, true);
  assert.equal(result.translation, 'Привет');
});

test('7-8. Russian source wrongly echoed as the Chinese translation retries once, then fails', async () => {
  const client = fakeClient([
    { detected_lang: 'Русский', translation: 'Мы посетим фабрику', new_target_lang: null },
    { detected_lang: 'Русский', translation: 'Мы посетим фабрику', new_target_lang: null },
  ]);
  const translator = createTranslator(client);
  const result = await translator.translateText({ target_language: 'Китайский' }, 'Мы посетим фабрику');
  assert.equal(client.calls.length, 2);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'TRANSLATION_FAILED');
});

test('7b. A single bad attempt is corrected by the retry and succeeds', async () => {
  const client = fakeClient([
    { detected_lang: 'Русский', translation: 'Мы посетим фабрику', new_target_lang: null },
    { detected_lang: 'Русский', translation: '我们将参观工厂', new_target_lang: null },
  ]);
  const translator = createTranslator(client);
  const result = await translator.translateText({ target_language: 'Китайский' }, 'Мы посетим фабрику');
  assert.equal(client.calls.length, 2);
  assert.equal(result.ok, true);
  assert.equal(result.translation, '我们将参观工厂');
});

test('9a. Chinese phrase with a Russian brand name keeps Chinese-source direction', async () => {
  const client = fakeClient([
    { detected_lang: 'Китайский', translation: 'Свяжитесь с Яндекс', new_target_lang: 'Китайский' },
  ]);
  const translator = createTranslator(client);
  const result = await translator.translateText({ target_language: null }, '请联系Яндекс');
  assert.equal(result.ok, true);
  assert.equal(result.sourceLanguage, 'Китайский');
  assert.equal(result.targetLanguage, 'Русский');
});

test('9b. Russian request quoting Chinese text keeps Russian-to-Chinese direction', async () => {
  const client = fakeClient([
    { detected_lang: 'Русский', translation: '你好', new_target_lang: 'Китайский' },
  ]);
  const translator = createTranslator(client);
  const result = await translator.translateText({ target_language: null }, 'Переведи «你好» на китайский');
  assert.equal(result.ok, true);
  assert.equal(result.sourceLanguage, 'Русский');
  assert.equal(result.targetLanguage, 'Китайский');
});
