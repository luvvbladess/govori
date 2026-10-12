const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const webpush = require('web-push');

const PUSH_TIMEOUT_MS = 5000;
const DISABLED_PUSH_SERVICE = Object.freeze({
  getConfig: () => ({ enabled: false, publicKey: null }),
  publishNewMessage: async () => {},
});

function isPushEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return false;
  try {
    const url = new URL(endpoint);
    const host = url.hostname;
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash &&
      (host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com' ||
        host.endsWith('.push.services.mozilla.com') || host.endsWith('.push.apple.com') || host.endsWith('.notify.windows.com'));
  } catch { return false; }
}

function decodeKey(value, length) {
  if (typeof value !== 'string' || value.length > 100 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const bytes = Buffer.from(value, 'base64url');
  return bytes.length === length && bytes.toString('base64url') === value ? bytes : null;
}

function isPublicKey(value) {
  const bytes = decodeKey(value, 65);
  if (!bytes || bytes[0] !== 4) return false;
  try { crypto.ECDH.convertKey(bytes, 'prime256v1'); return true; } catch { return false; }
}

function validateSubscription(value) {
  if (!value || !isPushEndpoint(value.endpoint) || !isPublicKey(value.keys?.p256dh) || !decodeKey(value.keys?.auth, 16)) return null;
  const expirationTime = value.expirationTime ?? null;
  if (expirationTime !== null && (!Number.isSafeInteger(expirationTime) || expirationTime <= Date.now())) return null;
  return { endpoint: value.endpoint, keys: { p256dh: value.keys.p256dh, auth: value.keys.auth }, expirationTime };
}

function validateVapidKeys(keys) {
  if (!keys || !isPublicKey(keys.publicKey) || !decodeKey(keys.privateKey, 32)) throw new Error('Invalid Web Push key configuration');
  const ecdh = crypto.createECDH('prime256v1');
  try {
    ecdh.setPrivateKey(Buffer.from(keys.privateKey, 'base64url'));
    if (ecdh.getPublicKey().toString('base64url') !== keys.publicKey) throw new Error('mismatch');
  } catch { throw new Error('Invalid Web Push key configuration'); }
  return { publicKey: keys.publicKey, privateKey: keys.privateKey };
}

function loadVapidKeys({ keyFile = path.join(__dirname, '..', 'data', 'push-keys.json'), env = process.env } = {}) {
  if (env.VAPID_PUBLIC_KEY || env.VAPID_PRIVATE_KEY) {
    return validateVapidKeys({ publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY });
  }
  try { return validateVapidKeys(JSON.parse(fs.readFileSync(keyFile, 'utf8'))); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Unable to load Web Push keys'); }
  fs.mkdirSync(path.dirname(keyFile), { recursive: true });
  const keys = webpush.generateVAPIDKeys();
  try { fs.writeFileSync(keyFile, JSON.stringify(keys), { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code === 'EEXIST') return validateVapidKeys(JSON.parse(fs.readFileSync(keyFile, 'utf8')));
    throw new Error('Unable to save Web Push keys');
  }
  return keys;
}

function isVapidSubject(subject) {
  if (typeof subject !== 'string' || subject.length > 2048) return false;
  if (/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subject)) return true;
  try {
    const url = new URL(subject);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      url.hostname.includes('.') && !/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) && !url.hostname.endsWith('.localhost');
  } catch { return false; }
}

function notificationBody(locale, sender, room) {
  const title = room || (locale === 'en' ? 'Group conversation' : locale === 'zh' ? '群聊' : 'Групповая беседа');
  if (locale === 'en') return `${sender}: new message in ${title}`;
  if (locale === 'zh') return `${sender}：${title}中有新消息`;
  return `${sender}: новое сообщение в «${title}»`;
}

async function withTimeout(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Push delivery timed out')), PUSH_TIMEOUT_MS);
    })]);
  } finally { clearTimeout(timer); }
}

function createPushService(db, { vapidKeys, subject, sendNotification = webpush.sendNotification.bind(webpush), logger = message => console.error(message) } = {}) {
  if (!vapidKeys) return DISABLED_PUSH_SERVICE;
  const keys = validateVapidKeys(vapidKeys);
  if (subject !== undefined && !isVapidSubject(subject)) throw new Error('Invalid Web Push contact configuration');
  async function sendTo(subscription, message) {
    if (!isPushEndpoint(subscription.endpoint)) return;
    const payload = {
      title: 'Говори', body: notificationBody(subscription.locale, message.senderName, message.title),
      tag: `${message.roomId}:${message.messageId}`,
      data: { url: `/#room=${encodeURIComponent(message.roomId)}`, roomId: message.roomId, messageId: message.messageId },
    };
    try {
      await withTimeout(sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify(payload), {
        vapidDetails: { subject, ...keys }, timeout: PUSH_TIMEOUT_MS, TTL: 3600, urgency: 'normal',
      }));
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) db.prepare('DELETE FROM push_subscriptions WHERE endpoint=? AND user_key=?').run(subscription.endpoint, subscription.user_key);
      else logger('Web Push delivery failed.');
    }
  }
  async function publishNewMessage({ roomId, messageId, senderMemberId }) {
    const message = db.prepare(`SELECT r.title,p.name AS senderName,p.user_key AS senderUser FROM shared_messages m
      JOIN shared_rooms r ON r.id=m.room_id JOIN shared_members p ON p.id=m.member_id
      WHERE m.id=? AND m.room_id=? AND m.member_id=?`).get(messageId, roomId, senderMemberId);
    if (!message) return;
    db.prepare('DELETE FROM push_subscriptions WHERE expiration_time IS NOT NULL AND expiration_time<=?').run(Date.now());
    const recipients = db.prepare(`SELECT DISTINCT s.* FROM push_subscriptions s JOIN shared_members p ON p.user_key=s.user_key
      WHERE p.room_id=? AND p.left_at IS NULL AND p.id<>? AND p.user_key<>?`).all(roomId, senderMemberId, message.senderUser);
    await Promise.allSettled(recipients.map(subscription => sendTo(subscription, { ...message, roomId, messageId })));
  }
  return { getConfig: () => ({ enabled: true, publicKey: keys.publicKey }), publishNewMessage };
}

module.exports = { DISABLED_PUSH_SERVICE, isPushEndpoint, validateSubscription, loadVapidKeys, isVapidSubject, createPushService };
