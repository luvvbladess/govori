const express = require('express');

function createApp({ db, openaiClient }) {
  const app = express();
  app.use(express.json());

  app.get('/health', (req, res) => {
    res.json({ ok: true });
  });

  return app;
}

module.exports = { createApp };
