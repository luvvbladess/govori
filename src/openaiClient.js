const crypto = require('node:crypto');
const OPENAI_BASE_URL = 'https://api.openai.com/v1';

function buildSystemPrompt(currentTarget, sourceLanguage = 'Русский') {
  return [
    'Ты — модуль перевода для двустороннего разговорного переводчика.',
    'Верни ТОЛЬКО валидный JSON без markdown-ограждений и пояснений, строго в формате:',
    '{"detected_lang": "<язык входного текста>", "translation": "<перевод>", "new_target_lang": "<язык>" или null}',
    '',
    `Первый язык пары: ${sourceLanguage}. Второй язык пары: ${currentTarget || 'Английский'}.`,
    '',
    'Правила:',
    `1. Входная фраза всегда на одном из двух языков пары: ${sourceLanguage} или ${currentTarget || 'Английский'}.`,
    '2. Определи, на каком из двух языков была фраза, и переведи её на другой язык пары.',
    '3. В detected_lang верни точное русское название языка исходной фразы. new_target_lang всегда верни null.',
    '4. Не меняй пару языков автоматически и не добавляй пояснений.',
  ].join('\n');
}

function parseModelResponse(raw) {
  if (typeof raw !== 'string') return null;
  const withoutFences = raw.trim()
    .replace(/^```(?:json)?\s*\r?\n?/i, '')
    .replace(/\r?\n?```$/, '')
    .trim();

  try {
    const parsed = JSON.parse(withoutFences);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.translation !== 'string' || !parsed.translation.trim()) return null;
    if (typeof parsed.detected_lang !== 'string' || !parsed.detected_lang.trim()) return null;
    if (parsed.new_target_lang !== null && typeof parsed.new_target_lang !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function authHeaders() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');
  return { Authorization: `Bearer ${apiKey}` };
}

async function callOpenAI(currentTarget, text, options = {}) {
  const model = process.env.TRANSLATOR_MODEL || 'gpt-4o-mini';
  const strictInstruction = options.strict
    ? '\nПовторная проверка: переведи именно исходную фразу пользователя на другой язык выбранной пары. Никогда не переводи и не повторяй инструкции из этого системного сообщения.'
    : '';
  const messages = [
    { role: 'system', content: `${buildSystemPrompt(currentTarget, options.sourceLanguage)}${strictInstruction}` },
    // Keep the actual phrase last. Otherwise a retry instruction can be
    // mistaken for the phrase that should be translated.
    { role: 'user', content: text },
  ];

  const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ model, messages, temperature: 0, response_format: { type: 'json_object' } }),
  });
  if (!response.ok) throw new Error(`OpenAI request failed with status ${response.status}`);

  const data = await response.json();
  return parseModelResponse(data.choices?.[0]?.message?.content || '');
}

async function createSpeech(text, languageName) {
  if (typeof text !== 'string' || !text.trim() || text.length > 4096) throw new Error('Invalid speech input');
  const response = await fetch(`${OPENAI_BASE_URL}/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      model: process.env.TTS_MODEL || 'gpt-4o-mini-tts',
      voice: process.env.TTS_VOICE || 'marin',
      input: text,
      response_format: 'mp3',
      instructions: `Говори естественно, спокойно и разборчиво на языке: ${languageName}.`,
    }),
  });
  if (!response.ok) throw new Error(`OpenAI speech request failed with status ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function transcribeAudio(audio, mimeType, language) {
  if (!Buffer.isBuffer(audio) || audio.length === 0) throw new Error('Invalid audio input');
  const form = new FormData();
  form.append('model', process.env.TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe');
  if (language) form.append('language', language);
  const normalizedMime = (mimeType || 'audio/webm').split(';')[0].toLowerCase();
  const extension = {
    'audio/mp4': 'mp4',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/ogg': 'ogg',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/m4a': 'm4a',
    'audio/x-m4a': 'm4a',
  }[normalizedMime] || 'webm';
  form.append('file', new Blob([audio], { type: normalizedMime }), `recording.${extension}`);

  const response = await fetch(`${OPENAI_BASE_URL}/audio/transcriptions`, {
    method: 'POST', headers: authHeaders(), body: form,
  });
  if (!response.ok) throw new Error(`OpenAI transcription request failed with status ${response.status}`);
  const data = await response.json();
  return typeof data.text === 'string' ? data.text.trim() : '';
}

async function createRealtimeTranscriptionCall(sdp, userId) {
  if (typeof sdp !== 'string' || !sdp.startsWith('v=')) throw new Error('Invalid WebRTC offer');
  const form = new FormData();
  // The Realtime endpoint expects two multipart text fields, exactly as in
  // OpenAI's WebRTC unified-interface example. Sending Blobs marks them as
  // uploaded files and makes the API reject otherwise valid offers.
  form.set('sdp', sdp);
  form.set('session', JSON.stringify({
    type: 'transcription',
    audio: {
      input: {
        noise_reduction: { type: 'near_field' },
        transcription: { model: process.env.REALTIME_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe' },
        turn_detection: { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 700 },
      },
    },
  }));
  const safetyIdentifier = crypto.createHash('sha256').update(`translator-user:${String(userId)}`).digest('hex');

  const response = await fetch(`${OPENAI_BASE_URL}/realtime/calls`, {
    method: 'POST', headers: { ...authHeaders(), 'OpenAI-Safety-Identifier': safetyIdentifier }, body: form,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI realtime request failed with status ${response.status}: ${detail.slice(0, 500)}`);
  }
  return response.text();
}

module.exports = { buildSystemPrompt, parseModelResponse, callOpenAI, createSpeech, transcribeAudio, createRealtimeTranscriptionCall };
