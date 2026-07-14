const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LANGUAGES,
  isKnownLanguage,
  codeForLanguage,
  matchesLanguageAlphabet,
  looksLikeUnqualifiedRussian,
  isExplicitRequest,
} = require('../src/languages');

test('LANGUAGES has 16 fixed entries with codes', () => {
  assert.equal(LANGUAGES.length, 16);
  assert.ok(LANGUAGES.every((l) => typeof l.name === 'string' && typeof l.code === 'string'));
});

test('isKnownLanguage / codeForLanguage', () => {
  assert.equal(isKnownLanguage('Китайский'), true);
  assert.equal(isKnownLanguage('Клингонский'), false);
  assert.equal(codeForLanguage('Китайский'), 'zh-CN');
  assert.equal(codeForLanguage('Клингонский'), null);
});

test('matchesLanguageAlphabet enforces Chinese/Russian/English, passes others', () => {
  assert.equal(matchesLanguageAlphabet('Китайский', '我们将参观工厂'), true);
  assert.equal(matchesLanguageAlphabet('Китайский', 'Мы посетим фабрику'), false);
  assert.equal(matchesLanguageAlphabet('Русский', 'Здравствуйте, как вы?'), true);
  assert.equal(matchesLanguageAlphabet('Русский', '你好'), false);
  assert.equal(matchesLanguageAlphabet('Английский', 'How are you?'), true);
  assert.equal(matchesLanguageAlphabet('Английский', 'Как дела?'), false);
  assert.equal(matchesLanguageAlphabet('Тайский', 'สวัสดี'), true);
});

test('looksLikeUnqualifiedRussian is true only for pure Cyrillic text', () => {
  assert.equal(looksLikeUnqualifiedRussian('Мы посетим фабрику'), true);
  assert.equal(looksLikeUnqualifiedRussian('请联系Яндекс'), false);
  assert.equal(looksLikeUnqualifiedRussian('你好，你好吗？'), false);
});

test('isExplicitRequest matches "Переведи на X:" prefix', () => {
  assert.equal(isExplicitRequest('Переведи на английский: как дела?'), true);
  assert.equal(isExplicitRequest('Переведи «你好» на китайский'), false);
  assert.equal(isExplicitRequest('Мы посетим фабрику'), false);
});
