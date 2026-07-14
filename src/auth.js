const express = require('express');
const bcrypt = require('bcrypt');

function createAuthRouter(db) {
  const router = express.Router();

  router.post('/register', async (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_INPUT',
        message: 'Укажите email и пароль (минимум 8 символов).',
      });
    }

    try {
      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (existing) {
        return res.status(409).json({ ok: false, code: 'EMAIL_TAKEN', message: 'Такой email уже зарегистрирован.' });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const info = db
        .prepare('INSERT INTO users (email, password_hash, target_language, created_at) VALUES (?, ?, NULL, ?)')
        .run(email, passwordHash, new Date().toISOString());

      req.session.userId = info.lastInsertRowid;
      res.json({ ok: true, email, targetLanguage: null });
    } catch (err) {
      if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({ ok: false, code: 'EMAIL_TAKEN', message: 'Такой email уже зарегистрирован.' });
      }
      res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', message: 'Не удалось выполнить регистрацию.' });
    }
  });

  router.post('/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || !email.trim() || typeof password !== 'string') {
      return res.status(400).json({ ok: false, code: 'INVALID_INPUT', message: 'Укажите email и пароль.' });
    }

    try {
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        return res.status(401).json({ ok: false, code: 'INVALID_CREDENTIALS', message: 'Неверный email или пароль.' });
      }
      req.session.regenerate((err) => {
        if (err) {
          return res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', message: 'Не удалось выполнить вход.' });
        }
        req.session.userId = user.id;
        res.json({ ok: true, email: user.email, targetLanguage: user.target_language });
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
    const user = db.prepare('SELECT email, target_language FROM users WHERE id = ?').get(req.session.userId);
    if (!user) {
      return res.status(401).json({ ok: false, code: 'NOT_AUTHENTICATED' });
    }
    res.json({ ok: true, email: user.email, targetLanguage: user.target_language });
  });

  return router;
}

function requireAuth(db) {
  return (req, res, next) => {
    if (!req.session.userId) {
      return res.status(401).json({ ok: false, code: 'NOT_AUTHENTICATED' });
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (!user) {
      return res.status(401).json({ ok: false, code: 'NOT_AUTHENTICATED' });
    }
    req.user = user;
    next();
  };
}

module.exports = { createAuthRouter, requireAuth };
