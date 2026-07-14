// src/translatorRoutes.js
const express = require('express');
const rateLimit = require('express-rate-limit');
const { isKnownLanguage } = require('./languages');

const MAX_TEXT_LENGTH = 6000;

function createTranslatorRouter(db, translator) {
  const router = express.Router();
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    keyGenerator: (req) => String(req.user.id),
    standardHeaders: true,
    legacyHeaders: false,
  });

  router.post('/translate', limiter, async (req, res) => {
    const { text } = req.body || {};
    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ ok: false, code: 'INVALID_INPUT', message: 'Пустой текст.' });
    }
    if (text.length > MAX_TEXT_LENGTH) {
      return res.status(400).json({
        ok: false,
        code: 'TEXT_TOO_LONG',
        message: `Слишком длинное сообщение (максимум ${MAX_TEXT_LENGTH} символов).`,
      });
    }

    const result = await translator.translateText(req.user, text);
    if (!result.ok) {
      const status = result.code === 'TARGET_LANGUAGE_REQUIRED' ? 409 : 502;
      return res.status(status).json(result);
    }

    if (result.session.targetLanguage !== req.user.target_language) {
      db.prepare('UPDATE users SET target_language = ? WHERE id = ?').run(result.session.targetLanguage, req.user.id);
    }
    res.json(result);
  });

  router.post('/set-language', (req, res) => {
    const { language } = req.body || {};
    if (!isKnownLanguage(language)) {
      return res.status(400).json({ ok: false, code: 'UNKNOWN_LANGUAGE', message: 'Язык не из поддерживаемого списка.' });
    }
    db.prepare('UPDATE users SET target_language = ? WHERE id = ?').run(language, req.user.id);
    res.json({ ok: true, targetLanguage: language });
  });

  return router;
}

module.exports = { createTranslatorRouter };
