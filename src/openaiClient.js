// src/openaiClient.js

function buildSystemPrompt(currentTarget) {
  return [
    'Ты — модуль перевода для двустороннего переводчика «русский ↔ язык собеседника».',
    'Верни ТОЛЬКО валидный JSON без markdown-ограждений и пояснений, строго в формате:',
    '{"detected_lang": "<язык входного текста>", "translation": "<перевод>", "new_target_lang": "<язык>" или null}',
    '',
    `Текущий известный язык собеседника: ${currentTarget || 'не задан'}.`,
    '',
    'Правила:',
    '1. Если во входном тексте есть явный запрос вида «Переведи на <язык>: <фраза>» — переведи только <фраза> на указанный язык и верни этот язык в new_target_lang.',
    '2. Если входной текст не на русском — переведи его на русский и верни исходный язык текста в new_target_lang.',
    '3. Если входной текст на русском и известен текущий язык собеседника — переведи текст на этот язык; new_target_lang верни как null.',
    '4. Определяй язык всего сообщения по преобладающему смыслу и алфавиту, игнорируя отдельные иноязычные вставки вроде имён собственных.',
  ].join('\n');
}

function parseModelResponse(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const withoutFences = trimmed
    .replace(/^```(?:json)?\s*\r?\n?/i, '')
    .replace(/\r?\n?```$/, '')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(withoutFences);
  } catch {
    return null;
  }

  if (typeof parsed.translation !== 'string' || !parsed.translation.trim()) return null;
  if (typeof parsed.detected_lang !== 'string' || !parsed.detected_lang.trim()) return null;
  if (parsed.new_target_lang !== null && typeof parsed.new_target_lang !== 'string') return null;

  return parsed;
}

async function callOpenAI(currentTarget, text, options = {}) {
  const model = process.env.TRANSLATOR_MODEL || 'gpt-4o-mini';
  const apiKey = process.env.OPENAI_API_KEY;

  const messages = [
    { role: 'system', content: buildSystemPrompt(currentTarget) },
    { role: 'user', content: text },
  ];
  if (options.strict) {
    messages.push({
      role: 'user',
      content: 'Верни перевод строго на целевом языке, не копируй русский исходник.',
    });
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, temperature: 0 }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed with status ${response.status}`);
  }

  const data = await response.json();
  const raw = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  return parseModelResponse(raw || '');
}

module.exports = { callOpenAI, parseModelResponse, buildSystemPrompt };
