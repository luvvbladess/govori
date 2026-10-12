const express = require('express');
const rateLimit = require('express-rate-limit');
const { isKnownLanguage, codeForLanguage, matchesLanguageAlphabet } = require('./languages');
const { readSpeech, writeSpeech } = require('./speechCache');
const { SPEECH_VOICES, isSpeechVoice, getDefaultVoice, getSpeechModel } = require('./speechVoices');

const MAX_AUDIO_BYTES = 24 * 1024 * 1024;
const FREE_TRANSLATIONS = 3;

function trialState(req) {
  return { translationsRemaining: Math.max(0, FREE_TRANSLATIONS - req.access.guest.translationsUsed) };
}

function allowGuestTranslation(req, res) {
  if (req.access.authenticated) return true;
  if (req.access.guest.translationsUsed >= FREE_TRANSLATIONS) {
    res.status(403).json({ ok: false, code: 'TRIAL_LIMIT_REACHED', message: 'Три бесплатных перевода уже использованы. Создайте аккаунт, чтобы продолжить.' });
    return false;
  }
  return true;
}

function requireRegistered(req, res) {
  if (req.access.authenticated) return true;
  res.status(403).json({ ok: false, code: 'REGISTRATION_REQUIRED', message: 'Создайте аккаунт, чтобы продолжить.' });
  return false;
}

function createTranslatorRouter(db, translator) {
  const router = express.Router();
  const limiter = rateLimit({ windowMs: 60 * 1000, max: 20, keyGenerator: (req) => String(req.user.id), standardHeaders: true, legacyHeaders: false });

  router.get('/voices', (req, res) => {
    res.set('Cache-Control', 'no-store').json({ ok: true, voices: SPEECH_VOICES, defaultVoice: getDefaultVoice() });
  });

  router.post('/translate', limiter, async (req, res, next) => {
    try {
      const { text, conversationId } = req.body || {};
      if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ ok: false, code: 'INVALID_INPUT', message: 'Введите фразу для перевода.' });
      if (!allowGuestTranslation(req, res)) return;

      if (!req.access.authenticated) {
        const result = await translator.translateText(req.user, text);
        if (!result.ok) return res.status(502).json({ ...result, transcript: text.trim(), ...trialState(req) });
        req.access.guest.translationsUsed += 1;
        return res.json({ ...result, ...trialState(req) });
      }

      const now = new Date().toISOString();
      let conversation;
      if (Number.isInteger(conversationId)) {
        conversation = db.prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?').get(conversationId, req.user.id);
      }
      if (!conversation) {
        const info = db.prepare('INSERT INTO conversations (user_id, title, source_language, target_language, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(req.user.id, text.trim().slice(0, 72), req.user.source_language || 'Русский', req.user.target_language || 'Английский', now, now);
        conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(info.lastInsertRowid);
      }
      const messageInfo = db.prepare('INSERT INTO conversation_messages (conversation_id, source_text, source_language, status, created_at) VALUES (?, ?, ?, ?, ?)').run(conversation.id, text.trim(), req.user.source_language || 'Русский', 'transcript', now);
      const result = await translator.translateText(req.user, text);
      if (!result.ok) {
        db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, conversation.id);
        return res.status(502).json({ ...result, transcript: text.trim(), conversationId: conversation.id, messageId: messageInfo.lastInsertRowid });
      }
      db.prepare('UPDATE conversation_messages SET source_language = ?, translation_text = ?, target_language = ?, status = ? WHERE id = ?').run(result.sourceLanguage, result.translation, result.targetLanguage, 'translated', messageInfo.lastInsertRowid);
      db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, conversation.id);
      res.json({ ...result, conversationId: conversation.id, messageId: messageInfo.lastInsertRowid });
    } catch (error) { next(error); }
  });

  router.post('/speech', limiter, async (req, res, next) => {
    try {
      const { text, language, voice = getDefaultVoice() } = req.body || {};
      if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ ok: false, code: 'INVALID_INPUT', message: 'Не удалось подготовить озвучку.' });
      if (!isSpeechVoice(voice)) return res.status(400).json({ ok: false, code: 'INVALID_VOICE', message: 'Выберите голос из списка.' });
      const languageName = typeof language === 'string' ? language : 'исходном';
      const speechOptions = { voice, model: getSpeechModel() };
      let audio = await readSpeech(req.user.id, text, languageName, speechOptions);
      if (!audio) {
        audio = await translator.createSpeech(text, languageName, voice);
        writeSpeech(req.user.id, text, languageName, audio, speechOptions).catch((error) => console.error('Speech cache write failed:', error));
      }
      res.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': audio.length, 'Cache-Control': 'private, no-store' }).send(audio);
    } catch (error) { next(error); }
  });

  router.post('/transcribe', limiter, express.raw({ type: 'audio/*', limit: '24mb' }), async (req, res, next) => {
    try {
      if (!req.access.authenticated && req.access.guest.translationsUsed >= FREE_TRANSLATIONS) {
        return res.status(403).json({ ok: false, code: 'TRIAL_LIMIT_REACHED', message: 'Три бесплатных перевода уже использованы. Создайте аккаунт, чтобы продолжить.' });
      }
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ ok: false, code: 'EMPTY_AUDIO', message: 'Запись получилась пустой. Попробуйте ещё раз.' });
      if (req.body.length > MAX_AUDIO_BYTES) return res.status(413).json({ ok: false, code: 'AUDIO_TOO_LARGE', message: 'Запись слишком большая. Разделите разговор на две части.' });
      const requestedLanguage = typeof req.query.language === 'string' && isKnownLanguage(req.query.language) ? req.query.language : req.user.source_language;
      const languageCode = codeForLanguage(requestedLanguage)?.split('-')[0] || null;
      const text = await translator.transcribeAudio(req.body, req.get('content-type'), languageCode);
      if (!text) return res.status(422).json({ ok: false, code: 'EMPTY_TRANSCRIPT', message: 'Не удалось распознать речь. Попробуйте ещё раз.' });
      if (!matchesLanguageAlphabet(requestedLanguage, text)) {
        return res.status(422).json({ ok: false, code: 'VOICE_LANGUAGE_MISMATCH', message: 'Речь распознана не на выбранном языке. Проверьте язык «Я говорю» и попробуйте ещё раз.' });
      }
      res.json({ ok: true, text });
    } catch (error) { next(error); }
  });

  // The browser sends only its SDP offer here. Audio travels directly from the
  // device to OpenAI over WebRTC; the long-lived API key never reaches it.
  router.post('/live/session', limiter, async (req, res, next) => {
    try {
      if (!requireRegistered(req, res)) return;
      const { sdp } = req.body || {};
      if (typeof sdp !== 'string' || sdp.length > 200000) return res.status(400).json({ ok: false, code: 'INVALID_LIVE_SESSION', message: 'Не удалось начать живой разговор.' });
      const answer = await translator.createRealtimeTranscriptionCall(sdp, req.user.id);
      if (typeof answer !== 'string' || !answer) return res.status(503).json({ ok: false, code: 'LIVE_UNAVAILABLE', message: 'Живой разговор сейчас недоступен. Попробуйте обычный голосовой ввод.' });
      res.json({ ok: true, sdp: answer });
    } catch (error) {
      // Keep provider details out of the UI, but retain a precise server log
      // so a deployment issue can be diagnosed without reproducing it.
      console.error('Realtime session failed:', error.message);
      return res.status(503).json({ ok: false, code: 'LIVE_UNAVAILABLE', message: 'Живой разговор сейчас недоступен. Попробуйте обычный голосовой ввод.' });
    }
  });

  router.post('/set-language', (req, res) => {
    const { language } = req.body || {};
    if (!isKnownLanguage(language)) return res.status(400).json({ ok: false, code: 'UNKNOWN_LANGUAGE', message: 'Выберите язык из списка.' });
    if (req.access.authenticated) db.prepare('UPDATE users SET target_language = ? WHERE id = ?').run(language, req.user.id);
    else req.access.guest.targetLanguage = language;
    res.json({ ok: true, targetLanguage: language });
  });

  router.post('/set-languages', (req, res) => {
    const { sourceLanguage, targetLanguage } = req.body || {};
    if (!isKnownLanguage(sourceLanguage) || !isKnownLanguage(targetLanguage) || sourceLanguage === targetLanguage) {
      return res.status(400).json({ ok: false, code: 'INVALID_LANGUAGE_PAIR', message: 'Выберите два разных языка.' });
    }
    if (req.access.authenticated) db.prepare('UPDATE users SET source_language = ?, target_language = ? WHERE id = ?').run(sourceLanguage, targetLanguage, req.user.id);
    else { req.access.guest.sourceLanguage = sourceLanguage; req.access.guest.targetLanguage = targetLanguage; }
    res.json({ ok: true, sourceLanguage, targetLanguage });
  });

  router.get('/conversations', (req, res) => {
    if (!requireRegistered(req, res)) return;
    const conversations = db.prepare('SELECT id, title, source_language AS sourceLanguage, target_language AS targetLanguage, updated_at AS updatedAt FROM conversations WHERE user_id = ? ORDER BY updated_at DESC').all(req.user.id);
    res.json({ ok: true, conversations });
  });

  router.get('/conversations/:id/messages', (req, res) => {
    if (!requireRegistered(req, res)) return;
    const conversation = db.prepare('SELECT id, title, source_language AS sourceLanguage, target_language AS targetLanguage FROM conversations WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!conversation) return res.status(404).json({ ok: false, code: 'CONVERSATION_NOT_FOUND' });
    const messages = db.prepare('SELECT id, source_text AS sourceText, source_language AS sourceLanguage, translation_text AS translationText, target_language AS targetLanguage, status, created_at AS createdAt FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC').all(conversation.id);
    res.json({ ok: true, conversation, messages });
  });

  router.delete('/conversations/:id', (req, res) => {
    if (!requireRegistered(req, res)) return;
    const conversation = db.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!conversation) return res.status(404).json({ ok: false, code: 'CONVERSATION_NOT_FOUND' });
    const transaction = db.transaction(() => {
      db.prepare('DELETE FROM conversation_messages WHERE conversation_id = ?').run(conversation.id);
      db.prepare('DELETE FROM conversations WHERE id = ?').run(conversation.id);
    });
    transaction();
    res.json({ ok: true, id: conversation.id });
  });
  return router;
}

module.exports = { createTranslatorRouter };
