require('dotenv').config();
const { createDb } = require('./src/db');
const { createApp } = require('./src/app');

const db = createDb();
const app = createApp({ db, openaiClient: require('./src/openaiClient') });
const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});
