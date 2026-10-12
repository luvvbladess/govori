const { matchesLanguageAlphabet } = require('./languages');

const PROMPT_LEAK_RE = /return\s+(?:the\s+)?translation\s+strictly|do not copy.{0,40}(?:original|source)|detected_lang|new_target_lang|верни перевод строго|не копируй.{0,40}исходник/i;

function looksLikePromptLeak(text) {
  return typeof text === 'string' && PROMPT_LEAK_RE.test(text);
}

function splitText(text, maxLength = 6000) {
  const parts = [];
  let remaining = text.trim();
  while (remaining.length > maxLength) {
    const window = remaining.slice(0, maxLength + 1);
    const punctuation = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '), window.lastIndexOf('。'), window.lastIndexOf('\n'));
    const whitespace = window.lastIndexOf(' ');
    const cut = punctuation > maxLength * 0.55 ? punctuation + 1 : whitespace > maxLength * 0.55 ? whitespace : maxLength;
    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

function mapModelResponse(sourceLanguage, targetLanguage, parsed) {
  const { detected_lang: detectedLanguage } = parsed;
  if (detectedLanguage === sourceLanguage) return { sourceLanguage, targetLanguage };
  if (detectedLanguage === targetLanguage) return { sourceLanguage: targetLanguage, targetLanguage: sourceLanguage };
  return null;
}

function createTranslator(openaiClient) {
  async function attemptOnce(sourceLanguage, targetLanguage, text, strict) {
    const parsed = await openaiClient.callOpenAI(targetLanguage, text, { strict, sourceLanguage });
    if (!parsed) return null;
    const mapped = mapModelResponse(sourceLanguage, targetLanguage, parsed);
    if (!mapped) return null;
    if (looksLikePromptLeak(parsed.translation)) return null;
    if (!matchesLanguageAlphabet(mapped.targetLanguage, parsed.translation)) return null;
    return { ...mapped, original: text, translation: parsed.translation };
  }

  async function translateText(user, text) {
    const sourceLanguage = user.source_language || 'Русский';
    const targetLanguage = user.target_language || 'Английский';

    const chunks = splitText(text);
    const translatedChunks = [];
    let direction;
    try {
      for (const chunk of chunks) {
        let result = await attemptOnce(sourceLanguage, targetLanguage, chunk, false);
        if (!result) result = await attemptOnce(sourceLanguage, targetLanguage, chunk, true);
        if (!result) throw new Error('TRANSLATION_FAILED');
        if (!direction) direction = { sourceLanguage: result.sourceLanguage, targetLanguage: result.targetLanguage };
        if (result.sourceLanguage !== direction.sourceLanguage || result.targetLanguage !== direction.targetLanguage) throw new Error('INCONSISTENT_LANGUAGE');
        translatedChunks.push(result.translation);
      }
    } catch {
      translatedChunks.length = 0;
    }

    if (!translatedChunks.length || !direction) {
      return {
        ok: false,
        code: 'TRANSLATION_FAILED',
        message: 'Не удалось перевести сообщение. Попробуйте ещё раз.',
      };
    }

    return {
      ok: true,
      sourceLanguage: direction.sourceLanguage,
      targetLanguage: direction.targetLanguage,
      original: text,
      translation: translatedChunks.join('\n'),
      voiceText: translatedChunks.join('\n'),
      session: { sourceLanguage, targetLanguage },
    };
  }

  return {
    translateText,
    createSpeech: async (text, language) => {
      const audioParts = [];
      for (const chunk of splitText(text, 3500)) audioParts.push(await openaiClient.createSpeech(chunk, language));
      return Buffer.concat(audioParts);
    },
    transcribeAudio: (audio, mimeType, language) => openaiClient.transcribeAudio(audio, mimeType, language),
    createRealtimeTranscriptionCall: (sdp, userId) => openaiClient.createRealtimeTranscriptionCall?.(sdp, userId),
  };
}

module.exports = { createTranslator, mapModelResponse, looksLikePromptLeak, splitText };
