const { matchesLanguageAlphabet, looksLikeUnqualifiedRussian, isExplicitRequest } = require('./languages');

function mapModelResponse(currentTarget, parsed) {
  const { detected_lang, new_target_lang } = parsed;
  if (new_target_lang) {
    if (detected_lang === 'Русский') {
      return { sourceLanguage: 'Русский', targetLanguage: new_target_lang, newTargetLanguage: new_target_lang };
    }
    return { sourceLanguage: detected_lang, targetLanguage: 'Русский', newTargetLanguage: new_target_lang };
  }
  return { sourceLanguage: 'Русский', targetLanguage: currentTarget, newTargetLanguage: currentTarget };
}

function createTranslator(openaiClient) {
  async function attemptOnce(currentTarget, text, strict) {
    const parsed = await openaiClient.callOpenAI(currentTarget, text, { strict });
    if (!parsed) return null;
    const mapped = mapModelResponse(currentTarget, parsed);
    if (!matchesLanguageAlphabet(mapped.targetLanguage, parsed.translation)) return null;
    return { ...mapped, original: text, translation: parsed.translation };
  }

  async function translateText(user, text) {
    const currentTarget = user.target_language || null;

    if (!currentTarget && !isExplicitRequest(text) && looksLikeUnqualifiedRussian(text)) {
      return {
        ok: false,
        code: 'TARGET_LANGUAGE_REQUIRED',
        message: 'Сначала отправьте фразу собеседника на его языке или укажите язык явно.',
      };
    }

    let result;
    try {
      result = await attemptOnce(currentTarget, text, false);
      if (!result) {
        result = await attemptOnce(currentTarget, text, true);
      }
    } catch {
      result = null;
    }

    if (!result) {
      return {
        ok: false,
        code: 'TRANSLATION_FAILED',
        message: 'Не удалось перевести сообщение. Попробуйте ещё раз.',
      };
    }

    return {
      ok: true,
      sourceLanguage: result.sourceLanguage,
      targetLanguage: result.targetLanguage,
      original: result.original,
      translation: result.translation,
      voiceText: result.translation,
      session: { targetLanguage: result.newTargetLanguage },
    };
  }

  return { translateText };
}

module.exports = { createTranslator, mapModelResponse };
