require('dotenv').config();
const { createDb } = require('./src/db');
const { createApp } = require('./src/app');
const { loadVapidKeys, createPushService } = require('./src/pushNotifications');

const db = createDb();
// An interrupted provider request can be retried after a service restart.
db.prepare("UPDATE shared_messages SET status = 'failed' WHERE status = 'pending'").run();
db.prepare("UPDATE shared_translations SET status = 'failed' WHERE status = 'pending'").run();
const pushService = createPushService(db, {
  vapidKeys: loadVapidKeys(),
  subject: process.env.VAPID_SUBJECT || process.env.PUBLIC_URL || 'https://lexiqs.space',
});
const app = createApp({ db, openaiClient: require('./src/openaiClient'), pushService });
const port = process.env.PORT || 3000;

app.listen(port, process.env.HOST || '0.0.0.0', () => {
  console.log(`Listening on port ${port}`);
});
