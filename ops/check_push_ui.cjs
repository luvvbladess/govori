// Real browser/service worker; only the external push subscription is simulated.
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const { chromium } = require('playwright');
const webpush = require('web-push');

async function main() {
  const keys = webpush.generateVAPIDKeys();
  const app = express();
  app.get('/push-fixture', (req, res) => res.type('html').send('<!doctype html><title>Local push check</title>'));
  app.use(express.static(path.join(__dirname, '../public')));
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  let browser;
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
    const context = await browser.newContext({ permissions: ['notifications'] });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/push-fixture`);
    await page.setContent('<button id="notifications-toggle"></button><button id="notifications-open"></button><button id="speech-settings-open"></button><p id="notifications-status"></p><p id="notifications-help"></p>');
    await page.evaluate(publicKey => {
      window.savedSubscriptions = []; window.removedSubscriptions = [];
      window.t = key => key; window.getLocale = () => 'ru'; window.accessState = {};
      window.Api = {
        pushConfig: async () => ({ enabled: true, publicKey }),
        pushSubscribe: async body => window.savedSubscriptions.push(body),
        pushUnsubscribe: async endpoint => window.removedSubscriptions.push(endpoint),
      };
      let subscription = null;
      PushManager.prototype.getSubscription = async () => subscription;
      PushManager.prototype.subscribe = async () => {
        subscription = { endpoint: 'https://fcm.googleapis.com/push/local-browser-fixture',
          toJSON: () => ({ endpoint: subscription.endpoint, keys: {} }),
          unsubscribe: async () => { subscription = null; return true; } };
        return subscription;
      };
    }, keys.publicKey);
    await page.addScriptTag({ url: `${base}/js/notifications.js` });
    await page.waitForFunction(() => !document.getElementById('notifications-toggle').disabled);
    assert.equal(await page.evaluate(() => savedSubscriptions.length), 0);
    await page.locator('#notifications-toggle').click();
    await page.waitForFunction(() => document.getElementById('notifications-toggle').getAttribute('aria-pressed') === 'true');
    assert.equal(await page.evaluate(() => savedSubscriptions.length), 1);
    await page.locator('#notifications-toggle').click();
    await page.waitForFunction(() => document.getElementById('notifications-toggle').getAttribute('aria-pressed') === 'false');
    assert.equal(await page.evaluate(() => removedSubscriptions.length), 1);
    await page.locator('#notifications-toggle').click();
    await page.waitForFunction(() => document.getElementById('notifications-toggle').getAttribute('aria-pressed') === 'true');
    const worker = context.serviceWorkers()[0];
    assert.ok(worker, 'Real service worker registered');
    // The app tab is closed: process an incoming event in the real background worker.
    await page.close();
    await worker.evaluate(async () => {
      let completion;
      const event = new Event('push');
      Object.defineProperty(event, 'data', { value: { json: () => ({ title: 'Говори', body: 'Alex: новое сообщение', data: { roomId: 'local-room' } }) } });
      Object.defineProperty(event, 'waitUntil', { value: promise => { completion = promise; } });
      self.dispatchEvent(event); await completion;
    });
    const notices = await worker.evaluate(async () => (await self.registration.getNotifications()).map(item => ({ title: item.title, body: item.body, url: item.data.url })));
    assert.deepEqual(notices, [{ title: 'Говори', body: 'Alex: новое сообщение', url: '/#room=local-room' }]);
    const reopened = await context.newPage();
    await reopened.goto(`${base}/push-fixture`);
    // Existing-window click path exercises actual navigation, without OS interaction.
    await worker.evaluate(async () => {
      let completion;
      const notification = (await self.registration.getNotifications())[0];
      const event = new Event('notificationclick');
      Object.defineProperty(event, 'notification', { value: notification });
      Object.defineProperty(event, 'waitUntil', { value: promise => { completion = promise; } });
      self.dispatchEvent(event);
      try { await completion; } catch (error) {
        // Synthetic clicks lack OS user activation; navigation is still verified below.
        if (error.name !== 'InvalidAccessError') throw error;
      }
    });
    await reopened.waitForURL(`${base}/#room=local-room`);
    await worker.evaluate(async () => { for (const item of await self.registration.getNotifications()) item.close(); });
    assert.deepEqual(errors, []);
    console.log('PASS: enable/disable notification, real service worker, notification with closed app tab, click opens room. External push transport simulated.');
  } finally {
    await browser?.close(); await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
