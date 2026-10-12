const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { getDefaultVoice, getSpeechModel } = require('./speechVoices');

const CACHE_DIR = path.join(__dirname, '..', 'data', 'speech-cache');
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;

function fileFor(userId, text, language, {voice = getDefaultVoice(), model = getSpeechModel()} = {}) {
  const key = crypto.createHash('sha256').update(JSON.stringify([String(userId), language, text, voice, model])).digest('hex');
  return path.join(CACHE_DIR, `${key}.mp3`);
}

async function readSpeech(userId, text, language, options) {
  const file = fileFor(userId, text, language, options);
  try {
    const info = await fs.stat(file);
    if (Date.now() - info.mtimeMs > MAX_AGE_MS) { await fs.unlink(file); return null; }
    return await fs.readFile(file);
  } catch { return null; }
}

async function writeSpeech(userId, text, language, audio, options) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const file = fileFor(userId, text, language, options);
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, audio);
  await fs.rename(temporary, file);
}

module.exports = { readSpeech, writeSpeech };
