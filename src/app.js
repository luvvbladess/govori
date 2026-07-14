// src/app.js
const path = require('node:path');
const fs = require('node:fs');
const sqlite3 = require('sqlite3');
const express = require('express');
const session = require('express-session');
const SQLiteStoreFactory = require('connect-sqlite3');
const { createAuthRouter, requireAuth } = require('./auth');
const { createTranslatorRouter } = require('./translatorRoutes');
const { createTranslator } = require('./translator');

function createApp({ db, openaiClient }) {
  const app = express();
  const SQLiteStore = SQLiteStoreFactory(session);

  // connect-sqlite3@0.9.17 (the version installed here) takes an already-opened
  // sqlite3 connection as `db`, not a filename/dir pair — see node_modules/connect-sqlite3/Readme.md.
  const dataDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const sessionDb = new sqlite3.Database(path.join(dataDir, 'sessions.sqlite'));

  app.use(express.json());
  app.use(
    session({
      store: new SQLiteStore({ db: sessionDb }),
      secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 },
    })
  );

  app.get('/health', (req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/auth', createAuthRouter(db));

  const translator = createTranslator(openaiClient);
  app.use('/api/translator', requireAuth(db), createTranslatorRouter(db, translator));

  app.use(express.static(path.join(__dirname, '..', 'public')));

  return app;
}

module.exports = { createApp };
