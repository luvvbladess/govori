const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('node:crypto');

const FREE_TRANSLATIONS = 3;

function getGuest(req) {
  const current = req.session.guest;
  if (!current || typeof current.id !== 'string') {
    req.session.guest = { id: crypto.randomUUID(), translationsUsed: 0, sourceLanguage: 'Русский', targetLanguage: 'Английский' };
  }
  const guest = req.session.guest;
  guest.translationsUsed = Math.max(0, Math.min(FREE_TRANSLATIONS, Number(guest.translationsUsed) || 0));
  guest.sourceLanguage = typeof guest.sourceLanguage === 'string' ? guest.sourceLanguage : 'Русский';
  guest.targetLanguage = typeof guest.targetLanguage === 'string' ? guest.targetLanguage : 'Английский';
  return guest;
}

function guestAccess(req) {
  const guest = getGuest(req);
  return { ok: true, authenticated: false, translationsRemaining: Math.max(0, FREE_TRANSLATIONS - guest.translationsUsed), sourceLanguage: guest.sourceLanguage, targetLanguage: guest.targetLanguage };
}

function establishSession(req, userId, callback) {
  const sharedRooms = req.session.sharedRooms;
  // Do not send the success response until the session store has persisted the
  // new ID. SQLite writes asynchronously; without this, the immediately
  // following /me request can occasionally see an empty session.
  req.session.regenerate((regenerateError) => {
    if (regenerateError) return callback(regenerateError);

    req.session.userId = userId;
    if (sharedRooms) req.session.sharedRooms = sharedRooms;
    req.session.save(callback);
  });
}

function createAuthRouter(db) {
  const router = express.Router();

  router.get('/trial', (req, res) => res.json(guestAccess(req)));

  router.post('/register', async (req, res) => {
    let { email, password, company } = req.body || {};
    email = typeof email === 'string' ? email.trim().toLowerCase() : '';
    company = typeof company === 'string' ? company.trim().replace(/\s+/g, ' ') : '';
    if (!email || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_INPUT',
        message: 'Укажите email и пароль (минимум 8 символов).',
      });
    }
    if (!company) return res.status(400).json({ ok: false, code: 'COMPANY_REQUIRED', message: 'Укажите вашу компанию.' });
    if (company.length > 160) return res.status(400).json({ ok: false, code: 'COMPANY_TOO_LONG', message: 'Название компании не должно быть длиннее 160 символов.' });

    try {
      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (existing) {
        return res.status(409).json({ ok: false, code: 'EMAIL_TAKEN', message: 'Такой email уже зарегистрирован.' });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const info = db
        .prepare('INSERT INTO users (email, password_hash, company, source_language, target_language, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(email, passwordHash, company, 'Русский', 'Английский', new Date().toISOString());

      establishSession(req, info.lastInsertRowid, (sessionError) => {
        if (sessionError) {
          console.error('Registration session could not be saved:', sessionError);
          return res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', message: 'Не удалось выполнить регистрацию.' });
        }
        res.json({ ok: true, email, company, sourceLanguage: 'Русский', targetLanguage: 'Английский' });
      });
    } catch (err) {
      if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({ ok: false, code: 'EMAIL_TAKEN', message: 'Такой email уже зарегистрирован.' });
      }
      res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', message: 'Не удалось выполнить регистрацию.' });
    }
  });

  router.post('/login', async (req, res) => {
    let { email, password } = req.body || {};
    email = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!email || typeof password !== 'string') {
      return res.status(400).json({ ok: false, code: 'INVALID_INPUT', message: 'Укажите email и пароль.' });
    }

    try {
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        return res.status(401).json({ ok: false, code: 'INVALID_CREDENTIALS', message: 'Неверный email или пароль.' });
      }
      establishSession(req, user.id, (sessionError) => {
        if (sessionError) {
          console.error('Login session could not be saved:', sessionError);
          return res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', message: 'Не удалось выполнить вход.' });
        }
        res.json({ ok: true, email: user.email, company: user.company || null, sourceLanguage: user.source_language || 'Русский', targetLanguage: user.target_language || 'Английский' });
      });
    } catch (err) {
      res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', message: 'Не удалось выполнить вход.' });
    }
  });

  router.post('/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  router.get('/me', (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ ok: false, code: 'NOT_AUTHENTICATED' });
    }
    const user = db.prepare('SELECT email, company, source_language, target_language FROM users WHERE id = ?').get(req.session.userId);
    if (!user) {
      return res.status(401).json({ ok: false, code: 'NOT_AUTHENTICATED' });
    }
    res.json({ ok: true, email: user.email, company: user.company || null, sourceLanguage: user.source_language || 'Русский', targetLanguage: user.target_language || 'Английский' });
  });

  return router;
}

function requireAccess(db) {
  return (req, res, next) => {
    if (req.session.userId) {
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
      if (!user) return res.status(401).json({ ok: false, code: 'NOT_AUTHENTICATED' });
      req.user = user;
      req.access = { authenticated: true };
    } else {
      const guest = getGuest(req);
      req.user = { id: `guest:${guest.id}`, source_language: guest.sourceLanguage, target_language: guest.targetLanguage };
      req.access = { authenticated: false, guest };
    }
    next();
  };
}

function requireAuth(db) {
  return (req, res, next) => {
    if (!req.session.userId) return res.status(401).json({ ok: false, code: 'NOT_AUTHENTICATED' });
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (!user) return res.status(401).json({ ok: false, code: 'NOT_AUTHENTICATED' });
    req.user = user;
    next();
  };
}

module.exports = { createAuthRouter, requireAuth, requireAccess, FREE_TRANSLATIONS };
