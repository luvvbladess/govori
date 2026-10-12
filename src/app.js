// src/app.js
const path = require('node:path');
const fs = require('node:fs');
const sqlite3 = require('sqlite3');
const express = require('express');
const session = require('express-session');
const SQLiteStoreFactory = require('connect-sqlite3');
const { createAuthRouter, requireAccess } = require('./auth');
const { createTranslatorRouter } = require('./translatorRoutes');
const { createTranslator } = require('./translator');
const { createSharedRouter } = require('./sharedRoutes');
const { createPushRouter } = require('./pushRoutes');
const { DISABLED_PUSH_SERVICE } = require('./pushNotifications');

function createApp({ db, openaiClient, pushService = DISABLED_PUSH_SERVICE }) {
  const app = express();
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  const SQLiteStore = SQLiteStoreFactory(session);

  // connect-sqlite3 takes an already-opened
  // sqlite3 connection as `db`, not a filename/dir pair — see node_modules/connect-sqlite3/Readme.md.
  const dataDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const sessionDb = new sqlite3.Database(path.join(dataDir, 'sessions.sqlite'), (error) => {
    if (error) console.error('Unable to open the session database:', error);
  });
  sessionDb.on('error', (error) => console.error('Session database error:', error));
  const sessionStore = new SQLiteStore({ db: sessionDb, concurrentDb: true });

  app.use(express.json({ limit: '1mb' }));
  app.use(
    session({
      store: sessionStore,
      secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 1000 * 60 * 60 * 24 * 30, httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === '1' },
    })
  );

  app.get('/health', (req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/auth', createAuthRouter(db));

  const translator = createTranslator(openaiClient);
  app.use('/api/translator', requireAccess(db), createTranslatorRouter(db, translator));
  app.use('/api/shared', requireAccess(db), createSharedRouter(db, translator, { publishNewMessage: message => pushService.publishNewMessage(message) }));
  app.use('/api/push', requireAccess(db), createPushRouter(db, pushService));

  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Catch-all error handler: prevents stack traces from leaking in HTTP
  // responses for any unhandled error thrown by a route (sync DB/bcrypt
  // errors, etc). Must be last, and must keep all 4 params for Express to
  // recognize it as an error handler.
  app.use((err, req, res, next) => {
    if (err?.type === 'entity.too.large') return res.status(413).json({ ok: false, code: 'AUDIO_TOO_LARGE', message: 'Запись слишком большая. Разделите разговор на две части.' });
    res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', message: 'Внутренняя ошибка сервера.' });
  });

  return app;
}

module.exports = { createApp };
