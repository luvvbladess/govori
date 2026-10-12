const express = require('express');
const rateLimit = require('express-rate-limit');
const { DISABLED_PUSH_SERVICE, validateSubscription, isPushEndpoint } = require('./pushNotifications');

function createPushRouter(db, pushService = DISABLED_PUSH_SERVICE) {
  const router = express.Router();
  const limiter = rateLimit({ windowMs: 60000, max: 20, keyGenerator: req => String(req.user.id), standardHeaders: true, legacyHeaders: false,
    message: { ok: false, code: 'RATE_LIMITED' } });
  function sameOrigin(req, res, next) {
    const origin = req.get('origin');
    if (origin && origin !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({ ok: false, code: 'INVALID_ORIGIN' });
    next();
  }
  router.get('/config', (req, res) => {
    const config = pushService.getConfig();
    res.set('Cache-Control', 'no-store').json({ ok: true, enabled: config.enabled === true, publicKey: config.enabled ? config.publicKey : null });
  });
  router.post('/subscriptions', sameOrigin, limiter, (req, res) => {
    if (!pushService.getConfig().enabled) return res.status(503).json({ ok: false, code: 'PUSH_UNAVAILABLE' });
    const subscription = validateSubscription(req.body?.subscription);
    const locale = req.body?.locale;
    if (!subscription || !['ru', 'en', 'zh'].includes(locale)) return res.status(400).json({ ok: false, code: 'INVALID_SUBSCRIPTION' });
    const userKey = String(req.user.id);
    const existing = db.prepare('SELECT * FROM push_subscriptions WHERE endpoint=?').get(subscription.endpoint);
    if (existing && existing.user_key !== userKey && (existing.p256dh !== subscription.keys.p256dh || existing.auth !== subscription.keys.auth)) {
      return res.status(409).json({ ok: false, code: 'SUBSCRIPTION_OWNED' });
    }
    const count = db.prepare('SELECT COUNT(*) AS total FROM push_subscriptions WHERE user_key=?').get(userKey).total;
    if (count >= 10 && (!existing || existing.user_key !== userKey)) return res.status(409).json({ ok: false, code: 'SUBSCRIPTION_LIMIT' });
    db.prepare(`INSERT INTO push_subscriptions (endpoint,user_key,p256dh,auth,locale,expiration_time,created_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(endpoint) DO UPDATE SET user_key=excluded.user_key,p256dh=excluded.p256dh,auth=excluded.auth,locale=excluded.locale,expiration_time=excluded.expiration_time`)
      .run(subscription.endpoint, userKey, subscription.keys.p256dh, subscription.keys.auth, locale, subscription.expirationTime, new Date().toISOString());
    res.json({ ok: true });
  });
  router.delete('/subscriptions', sameOrigin, limiter, (req, res) => {
    const endpoint = req.body?.endpoint;
    if (!isPushEndpoint(endpoint)) return res.status(400).json({ ok: false, code: 'INVALID_SUBSCRIPTION' });
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint=? AND user_key=?').run(endpoint, String(req.user.id));
    res.json({ ok: true });
  });
  return router;
}

module.exports = { createPushRouter };
