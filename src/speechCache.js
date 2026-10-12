const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const CACHE_DIR = path.join(__dirname, '..', 'data', 'speech-cache');
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;

function fileFor(userId, text, language) {
  const key = crypto.createHash('sha256').update(`${userId}\n${language}\n${text}`).digest('hex');
  return path.join(CACHE_DIR, `${key}.mp3`);
}

async function readSpeech(userId, text, language) {
  const file = fileFor(userId, text, language);
  try {
    const info = await fs.stat(file);
    if (Date.now() - info.mtimeMs > MAX_AGE_MS) { await fs.unlink(file); return null; }
    return await fs.readFile(file);
  } catch { return null; }
}

async function writeSpeech(userId, text, language, audio) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const file = fileFor(userId, text, language);
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, audio);
  await fs.rename(temporary, file);
}

module.exports = { readSpeech, writeSpeech };
