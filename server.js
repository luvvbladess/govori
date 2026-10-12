require('dotenv').config();
const { createDb } = require('./src/db');
const { createApp } = require('./src/app');

const db = createDb();
// An interrupted provider request can be retried after a service restart.
db.prepare("UPDATE shared_messages SET status = 'failed' WHERE status = 'pending'").run();
db.prepare("UPDATE shared_translations SET status = 'failed' WHERE status = 'pending'").run();
const app = createApp({ db, openaiClient: require('./src/openaiClient') });
const port = process.env.PORT || 3000;

app.listen(port, process.env.HOST || '0.0.0.0', () => {
  console.log(`Listening on port ${port}`);
});
