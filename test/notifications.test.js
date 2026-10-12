const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup({ permission = 'default', denied = false, enabled = true, apple = false, existing = false, apiFailure = false, unsupported = false } = {}) {
  const elements = new Map(); const events = {}; const calls = []; const storage = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { hidden: false, disabled: false, dataset: {}, handlers: {}, textContent: '',
      addEventListener(name, callback) { this.handlers[name] = callback; }, setAttribute(name, value) { this[name] = value; },
      click() { return this.handlers.click?.(); }, showModal() {},
    });
    return elements.get(id);
  };
  const subscription = { endpoint: 'https://fcm.googleapis.com/push/device',
    toJSON: () => ({ endpoint: subscription.endpoint, keys: { p256dh: 'test', auth: 'test' } }),
    unsubscribe: async () => { calls.push('unsubscribe'); return true; } };
  let current = existing ? subscription : null;
  const registration = { pushManager: { getSubscription: async () => current, subscribe: async options => { calls.push(options); current = subscription; return subscription; } } };
  const Notification = { permission, requestPermission: async () => { calls.push('permission'); Notification.permission = denied ? 'denied' : 'granted'; return Notification.permission; } };
  const window = { Notification, PushManager: function () {}, isSecureContext: true,
    t: key => key, getLocale: () => 'ru', accessState: { authenticated: true },
    addEventListener: (name, callback) => { events[name] = callback; },
    matchMedia: () => ({ matches: false }), Api: {
      pushConfig: async () => ({ enabled, publicKey: Buffer.from([4, ...Array(64).fill(1)]).toString('base64url') }),
      pushSubscribe: async body => { calls.push(body); if (apiFailure) throw new Error('offline'); return { ok: true }; },
      pushUnsubscribe: async endpoint => { calls.push(['delete', endpoint]); return { ok: true }; },
    },
  };
  if (unsupported) delete window.Notification;
  const context = vm.createContext({ window, Notification, Uint8Array, atob: value => Buffer.from(value, 'base64').toString('binary'),
    navigator: { userAgent: apple ? 'iPhone' : 'Android', language: 'ru-RU', standalone: false,
      serviceWorker: { register: async () => { calls.push('register'); return registration; }, ready: Promise.resolve(registration) } },
    document: { getElementById: element }, localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
  });
  if (unsupported) context.Notification = undefined;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/notifications.js'), 'utf8'), context);
  return { element, events, calls, storage, window, setServerEnabled: value => { enabled = value; } };
}
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

test('refresh clears the enabled indicator when push becomes unavailable on the server', async () => {
  const h = setup({ permission: 'granted', existing: true }); await flush();
  assert.equal(h.element('notifications-toggle')['aria-pressed'], 'true');
  h.setServerEnabled(false);
  await h.events.authenticated();
  assert.equal(h.element('notifications-toggle')['aria-pressed'], 'false');
  assert.equal(h.element('notifications-status').textContent, 'notifications.serverDisabled');
});

test('notification permission is requested only after a click and a subscription is saved', async () => {
  const h = setup(); await flush();
  assert.ok(!h.calls.includes('permission'));
  await h.element('notifications-toggle').click();
  assert.ok(h.calls.includes('permission'));
  assert.ok(h.calls.some(call => call?.userVisibleOnly === true));
  assert.ok(h.calls.some(call => call?.subscription?.endpoint));
  assert.equal(h.storage.get('notifications-enabled'), 'true');
  assert.equal(h.element('notifications-toggle')['aria-pressed'], 'true');
});

test('permission denial never creates a subscription and displays the browser settings hint', async () => {
  const h = setup({ denied: true }); await flush(); await h.element('notifications-toggle').click();
  assert.ok(!h.calls.some(call => call?.subscription));
  assert.equal(h.element('notifications-status').textContent, 'notifications.denied');
});

test('disable removes the server subscription before unsubscribing this device', async () => {
  const h = setup({ permission: 'granted', existing: true }); await flush();
  await h.element('notifications-toggle').click();
  const removed = h.calls.findIndex(call => Array.isArray(call) && call[0] === 'delete');
  assert.ok(removed >= 0 && h.calls.indexOf('unsubscribe') > removed);
  assert.equal(h.storage.get('notifications-enabled'), 'false');
});

test('iPhone browser explains Add to Home Screen before requesting notification permission', async () => {
  const h = setup({ apple: true }); await flush();
  assert.equal(h.element('notifications-help').textContent, 'notifications.appleInstall');
  assert.equal(h.element('notifications-toggle').disabled, true);
  assert.ok(!h.calls.includes('permission'));
});

test('failed server registration does not claim that notifications are enabled', async () => {
  const h = setup({ apiFailure: true }); await flush(); await h.element('notifications-toggle').click();
  assert.notEqual(h.storage.get('notifications-enabled'), 'true');
  assert.equal(h.element('notifications-status').textContent, 'notifications.error');
  assert.equal(h.element('notifications-toggle').disabled, false);
});

test('a browser without the Notifications API displays a support hint without crashing', async () => {
  const h = setup({ unsupported: true }); await flush();
  assert.equal(h.element('notifications-status').textContent, 'notifications.unavailable');
  assert.equal(h.element('notifications-toggle').disabled, true);
});

function worker() {
  const handlers = {}; const shown = []; const opened = [];
  const self = { location: { origin: 'https://test.local' }, skipWaiting: async () => {},
    addEventListener: (name, callback) => { handlers[name] = callback; },
    registration: { showNotification: async (title, options) => { shown.push({ title, options }); } },
    clients: { claim: async () => {}, matchAll: async () => [], openWindow: async url => { opened.push(url); } },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/service-worker.js'), 'utf8'), { self, URL });
  async function dispatch(name, properties) { let work; handlers[name]({ ...properties, waitUntil: promise => { work = promise; } }); await work; }
  return { self, shown, opened, dispatch };
}

test('background push shows a visible notification with a safe room link', async () => {
  const h = worker();
  await h.dispatch('push', { data: { json: () => ({ title: 'Говори', body: 'New message', data: { roomId: 'room-1', messageId: 2, url: 'https://evil.example' } }) } });
  assert.equal(h.shown[0].title, 'Говори');
  assert.equal(h.shown[0].options.data.url, '/#room=room-1');
  await h.dispatch('notificationclick', { notification: { data: h.shown[0].options.data, close() {} } });
  assert.equal(h.opened[0], 'https://test.local/#room=room-1');
});

test('malformed push still displays a generic notification and cannot open another website', async () => {
  const h = worker();
  await h.dispatch('push', { data: { json: () => { throw new SyntaxError('invalid'); } } });
  assert.equal(h.shown.length, 1);
  await h.dispatch('notificationclick', { notification: { data: { url: 'https://evil.example' }, close() {} } });
  assert.equal(h.opened[0], 'https://test.local/');
});

test('a null push payload still displays a generic visible notification', async () => {
  const h = worker(); await h.dispatch('push', { data: { json: () => null } });
  assert.equal(h.shown.length, 1);
});
