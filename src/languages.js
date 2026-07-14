const LANGUAGES = [
  { name: 'Русский', code: 'ru-RU' },
  { name: 'Английский', code: 'en-US' },
  { name: 'Китайский', code: 'zh-CN' },
  { name: 'Испанский', code: 'es-ES' },
  { name: 'Немецкий', code: 'de-DE' },
  { name: 'Французский', code: 'fr-FR' },
  { name: 'Японский', code: 'ja-JP' },
  { name: 'Корейский', code: 'ko-KR' },
  { name: 'Арабский', code: 'ar-SA' },
  { name: 'Турецкий', code: 'tr-TR' },
  { name: 'Итальянский', code: 'it-IT' },
  { name: 'Португальский', code: 'pt-PT' },
  { name: 'Вьетнамский', code: 'vi-VN' },
  { name: 'Тайский', code: 'th-TH' },
  { name: 'Хинди', code: 'hi-IN' },
  { name: 'Польский', code: 'pl-PL' },
];

const CYRILLIC_RE = /[Ѐ-ӿ]/;
const CJK_RE = /[一-鿿]/;
const LATIN_RE = /[A-Za-z]/;
// Latin + CJK + Japanese kana + Hangul + Arabic + Thai + Devanagari
const FOREIGN_SCRIPT_RE = /[A-Za-z一-鿿぀-ヿ가-힣؀-ۿ฀-๿ऀ-ॿ]/;
const EXPLICIT_REQUEST_RE = /^\s*переведи\s+на\s+[^:]+:/i;

function isKnownLanguage(name) {
  return LANGUAGES.some((l) => l.name === name);
}

function codeForLanguage(name) {
  const found = LANGUAGES.find((l) => l.name === name);
  return found ? found.code : null;
}

function matchesLanguageAlphabet(language, text) {
  if (language === 'Китайский') return CJK_RE.test(text) && !CYRILLIC_RE.test(text);
  if (language === 'Русский') return CYRILLIC_RE.test(text);
  if (language === 'Английский') return LATIN_RE.test(text) && !CYRILLIC_RE.test(text);
  return true;
}

function looksLikeUnqualifiedRussian(text) {
  return CYRILLIC_RE.test(text) && !FOREIGN_SCRIPT_RE.test(text);
}

function isExplicitRequest(text) {
  return EXPLICIT_REQUEST_RE.test(text);
}

module.exports = {
  LANGUAGES,
  isKnownLanguage,
  codeForLanguage,
  matchesLanguageAlphabet,
  looksLikeUnqualifiedRussian,
  isExplicitRequest,
};
