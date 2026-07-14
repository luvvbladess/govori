# Translator Web App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-first web app that is a bidirectional AI translator (Russian ↔ interlocutor's language), with real user accounts and always-on text + voice input/output, per `translator-mode-web-spec.md` and `docs/superpowers/specs/2026-07-14-translator-web-design.md`.

**Architecture:** Node.js + Express server (session-based auth, SQLite storage) exposes `/api/auth/*` and `/api/translator/*`; a vanilla HTML/CSS/JS mobile-first frontend talks to it and uses the browser's Web Speech API for STT/TTS. One OpenAI call per translation, with a single retry on alphabet-mismatch, exactly per the spec's model contract.

**Tech Stack:** Node.js (>=18, for global `fetch`), Express, `better-sqlite3`, `express-session` + `connect-sqlite3`, `bcrypt`, `express-rate-limit`, `dotenv`. No frontend framework, no build step. Tests via Node's built-in `node:test` + `assert/strict`.

## Global Constraints

- `targetLanguage` is per-account (`users.target_language`), never trusted from the client — server always reads it from the authenticated user's row (per spec, section "Контракт backend API").
- One target model call per translation attempt; at most one retry on alphabet mismatch, then `TRANSLATION_FAILED` (spec, "Защита от неверного направления").
- Never return raw provider errors or API keys to the client (spec, "Обработка ответа модели" / "Рекомендации по реализации").
- Message length capped at 6000 characters (design doc).
- Fixed list of 16 languages with BCP-47 codes (design doc, table in "Data model & API" section) — used for the language picker and for STT/TTS `lang`.
- Alphabet-mismatch validation (spec table) is enforced only for Китайский / Русский / Английский; other languages pass through unchecked (design doc).
- `voiceText` always equals the clean `translation`, no "Оригинал"/"Перевод" labels in it (spec).
- No history feature, no password reset in this version (design doc, "Вне рамок этой версии").

---

## Task 1: Project scaffolding + health check

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `src/app.js`
- Create: `server.js`
- Test: `test/app.test.js`

**Interfaces:**
- Produces: `createApp({ db, openaiClient })` → Express app with `GET /health` returning `{ ok: true }`. Later tasks mount more routers inside this same factory function.

- [ ] **Step 1: Init package.json**

Run: `npm init -y`

- [ ] **Step 2: Install dependencies**

Run: `npm install express express-session connect-sqlite3 better-sqlite3 bcrypt express-rate-limit dotenv`

- [ ] **Step 3: Set package.json scripts**

Edit `package.json`, replace the `"scripts"` block with:

```json
"scripts": {
  "start": "node server.js",
  "test": "node --test"
},
```

- [ ] **Step 4: Write .gitignore**

```
node_modules/
data/
.env
```

- [ ] **Step 5: Write .env.example**

```
PORT=3000
SESSION_SECRET=change-me-to-a-long-random-string
OPENAI_API_KEY=sk-...
TRANSLATOR_MODEL=gpt-4o-mini
```

- [ ] **Step 6: Write the failing test**

```js
// test/app.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

test('GET /health returns ok', async () => {
  const app = createApp({ db: null, openaiClient: null });
  const server = await startServer(app);
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { ok: true });
  } finally {
    server.close();
  }
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/app'`

- [ ] **Step 8: Write minimal implementation**

```js
// src/app.js
const express = require('express');

function createApp({ db, openaiClient }) {
  const app = express();
  app.use(express.json());

  app.get('/health', (req, res) => {
    res.json({ ok: true });
  });

  return app;
}

module.exports = { createApp };
```

```js
// server.js
require('dotenv').config();
const { createDb } = require('./src/db');
const { createApp } = require('./src/app');

const db = createDb();
const app = createApp({ db, openaiClient: require('./src/openaiClient') });
const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});
```

Note: `server.js` references `./src/db` and `./src/openaiClient`, which don't exist yet — that's fine, `server.js` isn't imported by the test in this task (only `src/app.js` is). It will work once Tasks 2–4 add those files.

- [ ] **Step 9: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json .gitignore .env.example src/app.js server.js test/app.test.js
git commit -m "Scaffold Express app with health check"
```

---

## Task 2: Fixed language list + alphabet helpers

**Files:**
- Create: `src/languages.js`
- Test: `test/languages.test.js`

**Interfaces:**
- Produces:
  - `LANGUAGES: Array<{ name: string, code: string }>` — the 16 fixed languages.
  - `isKnownLanguage(name: string): boolean`
  - `codeForLanguage(name: string): string | null`
  - `matchesLanguageAlphabet(language: string, text: string): boolean` — output-validation guard (Китайский/Русский/Английский enforced, others pass through `true`).
  - `looksLikeUnqualifiedRussian(text: string): boolean` — gate helper: pure Cyrillic with no foreign script at all.
  - `isExplicitRequest(text: string): boolean` — matches `Переведи на <язык>: ...`.

- [ ] **Step 1: Write the failing tests**

```js
// test/languages.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LANGUAGES,
  isKnownLanguage,
  codeForLanguage,
  matchesLanguageAlphabet,
  looksLikeUnqualifiedRussian,
  isExplicitRequest,
} = require('../src/languages');

test('LANGUAGES has 16 fixed entries with codes', () => {
  assert.equal(LANGUAGES.length, 16);
  assert.ok(LANGUAGES.every((l) => typeof l.name === 'string' && typeof l.code === 'string'));
});

test('isKnownLanguage / codeForLanguage', () => {
  assert.equal(isKnownLanguage('Китайский'), true);
  assert.equal(isKnownLanguage('Клингонский'), false);
  assert.equal(codeForLanguage('Китайский'), 'zh-CN');
  assert.equal(codeForLanguage('Клингонский'), null);
});

test('matchesLanguageAlphabet enforces Chinese/Russian/English, passes others', () => {
  assert.equal(matchesLanguageAlphabet('Китайский', '我们将参观工厂'), true);
  assert.equal(matchesLanguageAlphabet('Китайский', 'Мы посетим фабрику'), false);
  assert.equal(matchesLanguageAlphabet('Русский', 'Здравствуйте, как вы?'), true);
  assert.equal(matchesLanguageAlphabet('Русский', '你好'), false);
  assert.equal(matchesLanguageAlphabet('Английский', 'How are you?'), true);
  assert.equal(matchesLanguageAlphabet('Английский', 'Как дела?'), false);
  assert.equal(matchesLanguageAlphabet('Тайский', 'สวัสดี'), true);
});

test('looksLikeUnqualifiedRussian is true only for pure Cyrillic text', () => {
  assert.equal(looksLikeUnqualifiedRussian('Мы посетим фабрику'), true);
  assert.equal(looksLikeUnqualifiedRussian('请联系Яндекс'), false);
  assert.equal(looksLikeUnqualifiedRussian('你好，你好吗？'), false);
});

test('isExplicitRequest matches "Переведи на X:" prefix', () => {
  assert.equal(isExplicitRequest('Переведи на английский: как дела?'), true);
  assert.equal(isExplicitRequest('Переведи «你好» на китайский'), false);
  assert.equal(isExplicitRequest('Мы посетим фабрику'), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/languages'`

- [ ] **Step 3: Write implementation**

```js
// src/languages.js
const LANGUAGES = [
  { name: 'Русский', code: 'ru-RU' },
  { name: 'Английский', code: 'en-US' },
  { name: 'Китайский', code: 'zh-CN' },
  { name: 'Испанский', code: 'es-ES' },
  { name: 'Немецкий', code: 'de-DE' },
  { name: 'Французский', code: 'fr-FR' },
  { name: 'Японский', code: 'ja-JP' },
  { name: 'Корейский', code: 'ko-KR' },
  { name: 'Арабский', code: 'ar-SA' },
  { name: 'Турецкий', code: 'tr-TR' },
  { name: 'Итальянский', code: 'it-IT' },
  { name: 'Португальский', code: 'pt-PT' },
  { name: 'Вьетнамский', code: 'vi-VN' },
  { name: 'Тайский', code: 'th-TH' },
  { name: 'Хинди', code: 'hi-IN' },
  { name: 'Польский', code: 'pl-PL' },
];

const CYRILLIC_RE = /[Ѐ-ӿ]/;
const CJK_RE = /[一-鿿]/;
const LATIN_RE = /[A-Za-z]/;
// Latin + CJK + Japanese kana + Hangul + Arabic + Thai + Devanagari
const FOREIGN_SCRIPT_RE = /[A-Za-z一-鿿぀-ヿ가-힣؀-ۿ฀-๿ऀ-ॿ]/;
const EXPLICIT_REQUEST_RE = /^\s*переведи\s+на\s+[^:]+:/i;

function isKnownLanguage(name) {
  return LANGUAGES.some((l) => l.name === name);
}

function codeForLanguage(name) {
  const found = LANGUAGES.find((l) => l.name === name);
  return found ? found.code : null;
}

function matchesLanguageAlphabet(language, text) {
  if (language === 'Китайский') return CJK_RE.test(text) && !CYRILLIC_RE.test(text);
  if (language === 'Русский') return CYRILLIC_RE.test(text);
  if (language === 'Английский') return LATIN_RE.test(text) && !CYRILLIC_RE.test(text);
  return true;
}

function looksLikeUnqualifiedRussian(text) {
  return CYRILLIC_RE.test(text) && !FOREIGN_SCRIPT_RE.test(text);
}

function isExplicitRequest(text) {
  return EXPLICIT_REQUEST_RE.test(text);
}

module.exports = {
  LANGUAGES,
  isKnownLanguage,
  codeForLanguage,
  matchesLanguageAlphabet,
  looksLikeUnqualifiedRussian,
  isExplicitRequest,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/languages.js test/languages.test.js
git commit -m "Add fixed language list and alphabet/gate helpers"
```

---

## Task 3: SQLite database module

**Files:**
- Create: `src/db.js`
- Test: `test/db.test.js`

**Interfaces:**
- Produces: `createDb(dbPath?: string): BetterSqlite3.Database` — opens (creating if needed) a SQLite file with the `users` table, WAL mode. Default path is `data/app.db` relative to project root.

- [ ] **Step 1: Write the failing test**

```js
// test/db.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { createDb } = require('../src/db');

test('createDb creates users table with expected columns', () => {
  const tmpPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'translator-db-')), 'test.db');
  const db = createDb(tmpPath);
  try {
    const columns = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
    assert.deepEqual(
      columns.sort(),
      ['created_at', 'email', 'id', 'password_hash', 'target_language'].sort()
    );

    const info = db.prepare(
      'INSERT INTO users (email, password_hash, target_language, created_at) VALUES (?, ?, ?, ?)'
    ).run('a@example.com', 'hash', null, new Date().toISOString());
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    assert.equal(row.email, 'a@example.com');
    assert.equal(row.target_language, null);
  } finally {
    db.close();
  }
});

test('createDb enforces unique email', () => {
  const tmpPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'translator-db-')), 'test.db');
  const db = createDb(tmpPath);
  try {
    db.prepare(
      'INSERT INTO users (email, password_hash, target_language, created_at) VALUES (?, ?, ?, ?)'
    ).run('dup@example.com', 'hash', null, new Date().toISOString());
    assert.throws(() => {
      db.prepare(
        'INSERT INTO users (email, password_hash, target_language, created_at) VALUES (?, ?, ?, ?)'
      ).run('dup@example.com', 'hash2', null, new Date().toISOString());
    });
  } finally {
    db.close();
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/db'`

- [ ] **Step 3: Write implementation**

```js
// src/db.js
const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'data', 'app.db');

function createDb(dbPath = DEFAULT_DB_PATH) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      target_language TEXT,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

module.exports = { createDb, DEFAULT_DB_PATH };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/db.js test/db.test.js
git commit -m "Add SQLite db module with users table"
```

---

## Task 4: OpenAI client (call + response parsing)

**Files:**
- Create: `src/openaiClient.js`
- Test: `test/openaiClient.test.js`

**Interfaces:**
- Produces:
  - `parseModelResponse(raw: string): { detected_lang: string, translation: string, new_target_lang: string|null } | null` — strips markdown fences (any case, LF/CRLF), parses JSON, validates required fields; returns `null` on any failure.
  - `callOpenAI(currentTarget: string|null, text: string, options?: { strict?: boolean }): Promise<ParsedModelResponse|null>` — builds the system prompt per the spec's model contract, calls the OpenAI Chat Completions API using `fetch`, returns `parseModelResponse` of the result. Reads `OPENAI_API_KEY` and `TRANSLATOR_MODEL` (default `gpt-4o-mini`) from `process.env`.
- Consumes: nothing from earlier tasks.

- [ ] **Step 1: Write the failing tests**

```js
// test/openaiClient.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseModelResponse, callOpenAI } = require('../src/openaiClient');

test('parseModelResponse parses plain JSON', () => {
  const raw = '{"detected_lang": "Китайский", "translation": "Здравствуйте", "new_target_lang": "Китайский"}';
  assert.deepEqual(parseModelResponse(raw), {
    detected_lang: 'Китайский',
    translation: 'Здравствуйте',
    new_target_lang: 'Китайский',
  });
});

test('parseModelResponse strips ```json fences with CRLF', () => {
  const raw = '```json\r\n{"detected_lang": "Русский", "translation": "我们将参观工厂", "new_target_lang": null}\r\n```';
  const parsed = parseModelResponse(raw);
  assert.equal(parsed.detected_lang, 'Русский');
  assert.equal(parsed.new_target_lang, null);
});

test('parseModelResponse strips ``` fences without "json" label, case-insensitive', () => {
  const raw = '```JSON\n{"detected_lang": "Английский", "translation": "Hi", "new_target_lang": "Английский"}\n```';
  const parsed = parseModelResponse(raw);
  assert.equal(parsed.translation, 'Hi');
});

test('parseModelResponse returns null on invalid JSON', () => {
  assert.equal(parseModelResponse('not json at all'), null);
});

test('parseModelResponse returns null when translation is missing/empty', () => {
  assert.equal(parseModelResponse('{"detected_lang":"Русский","translation":"","new_target_lang":null}'), null);
  assert.equal(parseModelResponse('{"detected_lang":"Русский","new_target_lang":null}'), null);
});

test('callOpenAI sends expected request and returns parsed response', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.TRANSLATOR_MODEL = 'test-model';

  let capturedUrl, capturedOptions;
  globalThis.fetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"detected_lang":"Китайский","translation":"Здравствуйте","new_target_lang":"Китайский"}' } }],
      }),
    };
  };

  try {
    const result = await callOpenAI(null, '你好，你好吗？');
    assert.equal(capturedUrl, 'https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(capturedOptions.body);
    assert.equal(body.model, 'test-model');
    assert.equal(capturedOptions.headers.Authorization, 'Bearer test-key');
    assert.equal(result.translation, 'Здравствуйте');
  } finally {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  }
});

test('callOpenAI adds a stricter instruction when options.strict is true', async () => {
  const originalFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'test-key';
  let capturedBody;
  globalThis.fetch = async (url, options) => {
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"detected_lang":"Русский","translation":"我们将参观工厂","new_target_lang":null}' } }],
      }),
    };
  };

  try {
    await callOpenAI('Китайский', 'Мы посетим фабрику', { strict: true });
    const lastMessage = capturedBody.messages[capturedBody.messages.length - 1];
    assert.match(lastMessage.content, /строго на целевом языке/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('callOpenAI returns null when the model reply cannot be parsed', async () => {
  const originalFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'test-key';
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: 'garbage' } }] }),
  });

  try {
    const result = await callOpenAI(null, 'hi');
    assert.equal(result, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/openaiClient'`

- [ ] **Step 3: Write implementation**

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/openaiClient.js test/openaiClient.test.js
git commit -m "Add OpenAI client with model-response parsing"
```

---

## Task 5: Translator core logic (gate + retry + mapping) — the 9 required spec tests

**Files:**
- Create: `src/translator.js`
- Test: `test/translator.test.js`

**Interfaces:**
- Consumes: `matchesLanguageAlphabet`, `looksLikeUnqualifiedRussian`, `isExplicitRequest` from `src/languages.js` (Task 2). An injected `openaiClient`-shaped object exposing `callOpenAI(currentTarget, text, options)` (Task 4's real module, or a fake in tests).
- Produces: `createTranslator(openaiClient)` → `{ translateText(user, text) }`, where `user` is `{ target_language: string|null }`-shaped, and `translateText` resolves to:
  - `{ ok: false, code: 'TARGET_LANGUAGE_REQUIRED', message }`
  - `{ ok: false, code: 'TRANSLATION_FAILED', message }`
  - `{ ok: true, sourceLanguage, targetLanguage, original, translation, voiceText, session: { targetLanguage } }`

This module implements all 9 "Обязательные тесты" scenarios from `translator-mode-web-spec.md`.

- [ ] **Step 1: Write the failing tests**

```js
// test/translator.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTranslator } = require('../src/translator');

function fakeClient(responses) {
  let call = 0;
  return {
    calls: [],
    callOpenAI: async (currentTarget, text, options) => {
      const entry = { currentTarget, text, options };
      return responses[Math.min(call++, responses.length - 1)];
    },
  };
}

test('1. First Russian text without a pair returns TARGET_LANGUAGE_REQUIRED without calling the model', async () => {
  let called = false;
  const client = { callOpenAI: async () => { called = true; } };
  const translator = createTranslator(client);
  const result = await translator.translateText({ target_language: null }, 'Мы посетим фабрику');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'TARGET_LANGUAGE_REQUIRED');
  assert.equal(called, false);
});

test('2. Chinese text translates to Russian and sets Chinese as the new target', async () => {
  const client = fakeClient([
    { detected_lang: 'Китайский', translation: 'Здравствуйте, как вы?', new_target_lang: 'Китайский' },
  ]);
  const translator = createTranslator(client);
  const result = await translator.translateText({ target_language: null }, '你好，你好吗？');
  assert.equal(result.ok, true);
  assert.equal(result.sourceLanguage, 'Китайский');
  assert.equal(result.targetLanguage, 'Русский');
  assert.equal(result.translation, 'Здравствуйте, как вы?');
  assert.equal(result.voiceText, 'Здравствуйте, как вы?');
  assert.equal(result.session.targetLanguage, 'Китайский');
});

test('3. Russian text with a known pair translates to Chinese', async () => {
  const client = fakeClient([
    { detected_lang: 'Русский', translation: '我们将参观工厂', new_target_lang: null },
  ]);
  const translator = createTranslator(client);
  const result = await translator.translateText({ target_language: 'Китайский' }, 'Мы посетим фабрику');
  assert.equal(result.ok, true);
  assert.equal(result.sourceLanguage, 'Русский');
  assert.equal(result.targetLanguage, 'Китайский');
  assert.equal(result.translation, '我们将参观工厂');
  assert.equal(result.session.targetLanguage, 'Китайский');
});

test('4. An English phrase switches the pair from Chinese to English', async () => {
  const client = fakeClient([
    { detected_lang: 'Английский', translation: 'Привет', new_target_lang: 'Английский' },
  ]);
  const translator = createTranslator(client);
  const result = await translator.translateText({ target_language: 'Китайский' }, 'Hello there');
  assert.equal(result.ok, true);
  assert.equal(result.sourceLanguage, 'Английский');
  assert.equal(result.targetLanguage, 'Русский');
  assert.equal(result.session.targetLanguage, 'Английский');
});

test('5. Explicit command switches the language', async () => {
  const client = fakeClient([
    { detected_lang: 'Русский', translation: 'How are you?', new_target_lang: 'Английский' },
  ]);
  const translator = createTranslator(client);
  const result = await translator.translateText({ target_language: null }, 'Переведи на английский: как дела?');
  assert.equal(result.ok, true);
  assert.equal(result.sourceLanguage, 'Русский');
  assert.equal(result.targetLanguage, 'Английский');
  assert.equal(result.translation, 'How are you?');
  assert.equal(result.session.targetLanguage, 'Английский');
});

test('6. JSON in a code block with CRLF is parsed correctly', async () => {
  const client = {
    callOpenAI: async () => ({
      detected_lang: 'Китайский',
      translation: 'Привет',
      new_target_lang: 'Китайский',
    }),
  };
  const translator = createTranslator(client);
  const result = await translator.translateText({ target_language: null }, '你好');
  assert.equal(result.ok, true);
  assert.equal(result.translation, 'Привет');
});

test('7-8. Russian source wrongly echoed as the Chinese translation retries once, then fails', async () => {
  const client = fakeClient([
    { detected_lang: 'Русский', translation: 'Мы посетим фабрику', new_target_lang: null },
    { detected_lang: 'Русский', translation: 'Мы посетим фабрику', new_target_lang: null },
  ]);
  const translator = createTranslator(client);
  const result = await translator.translateText({ target_language: 'Китайский' }, 'Мы посетим фабрику');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'TRANSLATION_FAILED');
});

test('7b. A single bad attempt is corrected by the retry and succeeds', async () => {
  const client = fakeClient([
    { detected_lang: 'Русский', translation: 'Мы посетим фабрику', new_target_lang: null },
    { detected_lang: 'Русский', translation: '我们将参观工厂', new_target_lang: null },
  ]);
  const translator = createTranslator(client);
  const result = await translator.translateText({ target_language: 'Китайский' }, 'Мы посетим фабрику');
  assert.equal(result.ok, true);
  assert.equal(result.translation, '我们将参观工厂');
});

test('9a. Chinese phrase with a Russian brand name keeps Chinese-source direction', async () => {
  const client = fakeClient([
    { detected_lang: 'Китайский', translation: 'Свяжитесь с Яндекс', new_target_lang: 'Китайский' },
  ]);
  const translator = createTranslator(client);
  const result = await translator.translateText({ target_language: null }, '请联系Яндекс');
  assert.equal(result.ok, true);
  assert.equal(result.sourceLanguage, 'Китайский');
  assert.equal(result.targetLanguage, 'Русский');
});

test('9b. Russian request quoting Chinese text keeps Russian-to-Chinese direction', async () => {
  const client = fakeClient([
    { detected_lang: 'Русский', translation: '你好', new_target_lang: 'Китайский' },
  ]);
  const translator = createTranslator(client);
  const result = await translator.translateText({ target_language: null }, 'Переведи «你好» на китайский');
  assert.equal(result.ok, true);
  assert.equal(result.sourceLanguage, 'Русский');
  assert.equal(result.targetLanguage, 'Китайский');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/translator'`

- [ ] **Step 3: Write implementation**

```js
// src/translator.js
const { matchesLanguageAlphabet, looksLikeUnqualifiedRussian, isExplicitRequest } = require('./languages');

function mapModelResponse(currentTarget, parsed) {
  const { detected_lang, new_target_lang } = parsed;
  if (new_target_lang) {
    if (detected_lang === 'Русский') {
      return { sourceLanguage: 'Русский', targetLanguage: new_target_lang, newTargetLanguage: new_target_lang };
    }
    return { sourceLanguage: detected_lang, targetLanguage: 'Русский', newTargetLanguage: new_target_lang };
  }
  return { sourceLanguage: 'Русский', targetLanguage: currentTarget, newTargetLanguage: currentTarget };
}

function createTranslator(openaiClient) {
  async function attemptOnce(currentTarget, text, strict) {
    const parsed = await openaiClient.callOpenAI(currentTarget, text, { strict });
    if (!parsed) return null;
    const mapped = mapModelResponse(currentTarget, parsed);
    if (!matchesLanguageAlphabet(mapped.targetLanguage, parsed.translation)) return null;
    return { ...mapped, original: text, translation: parsed.translation };
  }

  async function translateText(user, text) {
    const currentTarget = user.target_language || null;

    if (!currentTarget && !isExplicitRequest(text) && looksLikeUnqualifiedRussian(text)) {
      return {
        ok: false,
        code: 'TARGET_LANGUAGE_REQUIRED',
        message: 'Сначала отправьте фразу собеседника на его языке или укажите язык явно.',
      };
    }

    let result;
    try {
      result = await attemptOnce(currentTarget, text, false);
      if (!result) {
        result = await attemptOnce(currentTarget, text, true);
      }
    } catch {
      result = null;
    }

    if (!result) {
      return {
        ok: false,
        code: 'TRANSLATION_FAILED',
        message: 'Не удалось перевести сообщение. Попробуйте ещё раз.',
      };
    }

    return {
      ok: true,
      sourceLanguage: result.sourceLanguage,
      targetLanguage: result.targetLanguage,
      original: result.original,
      translation: result.translation,
      voiceText: result.translation,
      session: { targetLanguage: result.newTargetLanguage },
    };
  }

  return { translateText };
}

module.exports = { createTranslator, mapModelResponse };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/translator.js test/translator.test.js
git commit -m "Add translator core logic covering all 9 required spec scenarios"
```

---

## Task 6: Auth module (register/login/logout/me)

**Files:**
- Create: `src/auth.js`
- Test: `test/auth.test.js`

**Interfaces:**
- Consumes: `createDb` from `src/db.js` (Task 3).
- Produces:
  - `createAuthRouter(db): express.Router` mounted at `/api/auth`, with `POST /register`, `POST /login`, `POST /logout`, `GET /me`.
  - `requireAuth(db): (req, res, next) => void` — Express middleware; sets `req.user` (the full user row) when `req.session.userId` corresponds to an existing user, else responds `401 { ok: false, code: 'NOT_AUTHENTICATED' }`.

This task needs a minimal app with session middleware to test through HTTP; build a small local test app rather than the full `src/app.js` (which gets session config wiring in Task 7).

- [ ] **Step 1: Write the failing tests**

```js
// test/auth.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const session = require('express-session');
const { createDb } = require('../src/db');
const { createAuthRouter, requireAuth } = require('../src/auth');

function buildTestApp() {
  const db = createDb(':memory:');
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: false }));
  app.use('/api/auth', createAuthRouter(db));
  app.get('/api/protected', requireAuth(db), (req, res) => res.json({ ok: true, email: req.user.email }));
  return { app, db };
}

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function fetchWithCookies(baseUrl, path, options = {}, cookieJar = { cookie: '' }) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), cookie: cookieJar.cookie },
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookieJar.cookie = setCookie.split(';')[0];
  return res;
}

test('register creates a user and starts a session', async () => {
  const { app } = buildTestApp();
  const server = await startServer(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const jar = { cookie: '' };
  try {
    const res = await fetchWithCookies(baseUrl, '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password: 'password123' }),
    }, jar);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.email, 'a@example.com');
    assert.equal(body.targetLanguage, null);

    const protectedRes = await fetchWithCookies(baseUrl, '/api/protected', {}, jar);
    assert.equal(protectedRes.status, 200);
  } finally {
    server.close();
  }
});

test('register rejects a duplicate email', async () => {
  const { app } = buildTestApp();
  const server = await startServer(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await fetchWithCookies(baseUrl, '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'dup@example.com', password: 'password123' }),
    });
    const res = await fetchWithCookies(baseUrl, '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'dup@example.com', password: 'password123' }),
    });
    assert.equal(res.status, 409);
  } finally {
    server.close();
  }
});

test('login with correct credentials starts a session; wrong password is rejected', async () => {
  const { app } = buildTestApp();
  const server = await startServer(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'b@example.com', password: 'password123' }),
    });

    const badLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'b@example.com', password: 'wrongpass' }),
    });
    assert.equal(badLogin.status, 401);

    const jar = { cookie: '' };
    const goodLogin = await fetchWithCookies(baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'b@example.com', password: 'password123' }),
    }, jar);
    assert.equal(goodLogin.status, 200);

    const me = await fetchWithCookies(baseUrl, '/api/auth/me', {}, jar);
    assert.equal(me.status, 200);
    const meBody = await me.json();
    assert.equal(meBody.email, 'b@example.com');
  } finally {
    server.close();
  }
});

test('protected route without a session returns 401', async () => {
  const { app } = buildTestApp();
  const server = await startServer(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${baseUrl}/api/protected`);
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

test('logout clears the session', async () => {
  const { app } = buildTestApp();
  const server = await startServer(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const jar = { cookie: '' };
  try {
    await fetchWithCookies(baseUrl, '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'c@example.com', password: 'password123' }),
    }, jar);
    await fetchWithCookies(baseUrl, '/api/auth/logout', { method: 'POST' }, jar);
    const res = await fetchWithCookies(baseUrl, '/api/protected', {}, jar);
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/auth'`

- [ ] **Step 3: Write implementation**

```js
// src/auth.js
const express = require('express');
const bcrypt = require('bcrypt');

function createAuthRouter(db) {
  const router = express.Router();

  router.post('/register', async (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_INPUT',
        message: 'Укажите email и пароль (минимум 8 символов).',
      });
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return res.status(409).json({ ok: false, code: 'EMAIL_TAKEN', message: 'Такой email уже зарегистрирован.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const info = db
      .prepare('INSERT INTO users (email, password_hash, target_language, created_at) VALUES (?, ?, NULL, ?)')
      .run(email, passwordHash, new Date().toISOString());

    req.session.userId = info.lastInsertRowid;
    res.json({ ok: true, email, targetLanguage: null });
  });

  router.post('/login', async (req, res) => {
    const { email, password } = req.body || {};
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !(await bcrypt.compare(password || '', user.password_hash))) {
      return res.status(401).json({ ok: false, code: 'INVALID_CREDENTIALS', message: 'Неверный email или пароль.' });
    }
    req.session.userId = user.id;
    res.json({ ok: true, email: user.email, targetLanguage: user.target_language });
  });

  router.post('/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  router.get('/me', (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ ok: false, code: 'NOT_AUTHENTICATED' });
    }
    const user = db.prepare('SELECT email, target_language FROM users WHERE id = ?').get(req.session.userId);
    if (!user) {
      return res.status(401).json({ ok: false, code: 'NOT_AUTHENTICATED' });
    }
    res.json({ ok: true, email: user.email, targetLanguage: user.target_language });
  });

  return router;
}

function requireAuth(db) {
  return (req, res, next) => {
    if (!req.session.userId) {
      return res.status(401).json({ ok: false, code: 'NOT_AUTHENTICATED' });
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (!user) {
      return res.status(401).json({ ok: false, code: 'NOT_AUTHENTICATED' });
    }
    req.user = user;
    next();
  };
}

module.exports = { createAuthRouter, requireAuth };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/auth.js test/auth.test.js
git commit -m "Add auth router (register/login/logout/me) and requireAuth middleware"
```

---

## Task 7: Translator routes + full app wiring

**Files:**
- Create: `src/translatorRoutes.js`
- Modify: `src/app.js` (replace the Task 1 minimal version with the full wiring)
- Test: `test/translatorRoutes.test.js`

**Interfaces:**
- Consumes: `createTranslator` (Task 5), `isKnownLanguage` (Task 2), `createAuthRouter`/`requireAuth` (Task 6), `createDb` (Task 3).
- Produces: `createTranslatorRouter(db, translator): express.Router` mounted at `/api/translator` (behind `requireAuth`), with `POST /translate` and `POST /set-language`. Updated `createApp({ db, openaiClient })` now wires session middleware (SQLite-backed store), mounts both routers, and serves `public/` statically.

- [ ] **Step 1: Write the failing test**

```js
// test/translatorRoutes.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createDb } = require('../src/db');

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function fetchWithCookies(baseUrl, path, options = {}, cookieJar = { cookie: '' }) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), cookie: cookieJar.cookie },
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookieJar.cookie = setCookie.split(';')[0];
  return res;
}

function fakeOpenaiClient(responses) {
  let call = 0;
  return {
    callOpenAI: async () => responses[Math.min(call++, responses.length - 1)],
  };
}

test('translate requires authentication', async () => {
  const db = createDb(':memory:');
  const app = createApp({ db, openaiClient: fakeOpenaiClient([]) });
  const server = await startServer(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${baseUrl}/api/translator/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'привет' }),
    });
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

test('translate persists the new target language on the user row', async () => {
  const db = createDb(':memory:');
  const app = createApp({
    db,
    openaiClient: fakeOpenaiClient([
      { detected_lang: 'Китайский', translation: 'Здравствуйте', new_target_lang: 'Китайский' },
    ]),
  });
  const server = await startServer(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const jar = { cookie: '' };
  try {
    await fetchWithCookies(baseUrl, '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'x@example.com', password: 'password123' }),
    }, jar);

    const res = await fetchWithCookies(baseUrl, '/api/translator/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '你好' }),
    }, jar);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.session.targetLanguage, 'Китайский');

    const row = db.prepare('SELECT target_language FROM users WHERE email = ?').get('x@example.com');
    assert.equal(row.target_language, 'Китайский');
  } finally {
    server.close();
  }
});

test('translate without a known pair returns 409 TARGET_LANGUAGE_REQUIRED', async () => {
  const db = createDb(':memory:');
  const app = createApp({ db, openaiClient: fakeOpenaiClient([]) });
  const server = await startServer(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const jar = { cookie: '' };
  try {
    await fetchWithCookies(baseUrl, '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'y@example.com', password: 'password123' }),
    }, jar);

    const res = await fetchWithCookies(baseUrl, '/api/translator/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Мы посетим фабрику' }),
    }, jar);
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, 'TARGET_LANGUAGE_REQUIRED');
  } finally {
    server.close();
  }
});

test('set-language validates against the fixed list and persists', async () => {
  const db = createDb(':memory:');
  const app = createApp({ db, openaiClient: fakeOpenaiClient([]) });
  const server = await startServer(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const jar = { cookie: '' };
  try {
    await fetchWithCookies(baseUrl, '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'z@example.com', password: 'password123' }),
    }, jar);

    const badRes = await fetchWithCookies(baseUrl, '/api/translator/set-language', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: 'Клингонский' }),
    }, jar);
    assert.equal(badRes.status, 400);

    const goodRes = await fetchWithCookies(baseUrl, '/api/translator/set-language', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: 'Немецкий' }),
    }, jar);
    assert.equal(goodRes.status, 200);

    const row = db.prepare('SELECT target_language FROM users WHERE email = ?').get('z@example.com');
    assert.equal(row.target_language, 'Немецкий');
  } finally {
    server.close();
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/translatorRoutes'`

- [ ] **Step 3: Write translatorRoutes.js**

```js
// src/translatorRoutes.js
const express = require('express');
const rateLimit = require('express-rate-limit');
const { isKnownLanguage } = require('./languages');

const MAX_TEXT_LENGTH = 6000;

function createTranslatorRouter(db, translator) {
  const router = express.Router();
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    keyGenerator: (req) => String(req.user.id),
    standardHeaders: true,
    legacyHeaders: false,
  });

  router.post('/translate', limiter, async (req, res) => {
    const { text } = req.body || {};
    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ ok: false, code: 'INVALID_INPUT', message: 'Пустой текст.' });
    }
    if (text.length > MAX_TEXT_LENGTH) {
      return res.status(400).json({
        ok: false,
        code: 'TEXT_TOO_LONG',
        message: `Слишком длинное сообщение (максимум ${MAX_TEXT_LENGTH} символов).`,
      });
    }

    const result = await translator.translateText(req.user, text);
    if (!result.ok) {
      const status = result.code === 'TARGET_LANGUAGE_REQUIRED' ? 409 : 502;
      return res.status(status).json(result);
    }

    if (result.session.targetLanguage !== req.user.target_language) {
      db.prepare('UPDATE users SET target_language = ? WHERE id = ?').run(result.session.targetLanguage, req.user.id);
    }
    res.json(result);
  });

  router.post('/set-language', (req, res) => {
    const { language } = req.body || {};
    if (!isKnownLanguage(language)) {
      return res.status(400).json({ ok: false, code: 'UNKNOWN_LANGUAGE', message: 'Язык не из поддерживаемого списка.' });
    }
    db.prepare('UPDATE users SET target_language = ? WHERE id = ?').run(language, req.user.id);
    res.json({ ok: true, targetLanguage: language });
  });

  return router;
}

module.exports = { createTranslatorRouter };
```

- [ ] **Step 4: Replace src/app.js with full wiring**

```js
// src/app.js
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const SQLiteStoreFactory = require('connect-sqlite3');
const { createAuthRouter, requireAuth } = require('./auth');
const { createTranslatorRouter } = require('./translatorRoutes');
const { createTranslator } = require('./translator');

function createApp({ db, openaiClient }) {
  const app = express();
  const SQLiteStore = SQLiteStoreFactory(session);

  app.use(express.json());
  app.use(
    session({
      store: new SQLiteStore({ db: 'sessions.sqlite', dir: path.join(__dirname, '..', 'data') }),
      secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 },
    })
  );

  app.get('/health', (req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/auth', createAuthRouter(db));

  const translator = createTranslator(openaiClient);
  app.use('/api/translator', requireAuth(db), createTranslatorRouter(db, translator));

  app.use(express.static(path.join(__dirname, '..', 'public')));

  return app;
}

module.exports = { createApp };
```

Note: tests in this task use `createDb(':memory:')`. The `connect-sqlite3` session store still writes to `data/sessions.sqlite` on disk (in-memory session storage isn't worth adding a branch for in tests — it's harmless, the directory already exists from Task 3's `fs.mkdirSync`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all suites, including Tasks 1–6's tests still passing)

- [ ] **Step 6: Commit**

```bash
git add src/translatorRoutes.js src/app.js test/translatorRoutes.test.js
git commit -m "Wire translator routes, sessions, and static serving into the app"
```

---

## Task 8: Frontend — auth screen

**Files:**
- Create: `public/index.html`
- Create: `public/css/app.css`
- Create: `public/js/api.js`
- Create: `public/js/auth.js`

**Interfaces:**
- Produces: `window.Api` object (from `api.js`) with `Api.register(email, password)`, `Api.login(email, password)`, `Api.logout()`, `Api.me()`, `Api.setLanguage(language)`, `Api.translate(text)` — thin `fetch` wrappers around the Task 6/7 endpoints, all `credentials: 'same-origin'` (default, cookies flow automatically same-origin).
- Produces: `auth.js` wires the login/register form in `index.html` to `Api`, and on success shows the `#translator-screen` section (built in Task 9) while hiding `#auth-screen`.

This task's deliverable is manually verified in a browser (no automated frontend tests — see Global Constraints/design doc: no test framework was requested for the UI, and DOM behavior is cheaper to eyeball than to wire up jsdom for a one-screen form).

- [ ] **Step 1: Write public/index.html (auth screen + empty translator screen shell)**

```html
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Переводчик</title>
  <link rel="stylesheet" href="/css/app.css">
</head>
<body>
  <section id="auth-screen">
    <h1>Переводчик</h1>
    <form id="auth-form">
      <input type="email" id="auth-email" placeholder="Email" required autocomplete="email">
      <input type="password" id="auth-password" placeholder="Пароль" required autocomplete="current-password" minlength="8">
      <button type="submit" id="auth-submit">Войти</button>
      <button type="button" id="auth-toggle-mode">Нет аккаунта? Зарегистрироваться</button>
      <p id="auth-error" class="error" hidden></p>
    </form>
  </section>

  <section id="translator-screen" hidden>
    <!-- built out in Task 9 -->
  </section>

  <script src="/js/api.js"></script>
  <script src="/js/auth.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write public/css/app.css (mobile-first base styles)**

```css
* { box-sizing: border-box; }

html, body {
  margin: 0;
  height: 100%;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  background: #f5f5f7;
  color: #1c1c1e;
}

#auth-screen {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 24px;
  gap: 12px;
}

#auth-form {
  width: 100%;
  max-width: 360px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

#auth-form input,
#auth-form button {
  padding: 14px;
  font-size: 16px;
  border-radius: 10px;
  border: 1px solid #d1d1d6;
}

#auth-form button[type="submit"] {
  background: #0a84ff;
  color: white;
  border: none;
  font-weight: 600;
}

#auth-toggle-mode {
  background: none;
  border: none;
  color: #0a84ff;
}

.error {
  color: #ff3b30;
  font-size: 14px;
}
```

- [ ] **Step 3: Write public/js/api.js**

```js
// public/js/api.js
window.Api = (() => {
  async function request(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.message || 'Request failed');
      err.code = body.code;
      err.status = res.status;
      throw err;
    }
    return body;
  }

  return {
    register: (email, password) =>
      request('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) }),
    login: (email, password) =>
      request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
    logout: () => request('/api/auth/logout', { method: 'POST' }),
    me: () => request('/api/auth/me'),
    setLanguage: (language) =>
      request('/api/translator/set-language', { method: 'POST', body: JSON.stringify({ language }) }),
    translate: (text) =>
      request('/api/translator/translate', { method: 'POST', body: JSON.stringify({ text }) }),
  };
})();
```

- [ ] **Step 4: Write public/js/auth.js**

```js
// public/js/auth.js
(() => {
  const form = document.getElementById('auth-form');
  const emailInput = document.getElementById('auth-email');
  const passwordInput = document.getElementById('auth-password');
  const submitButton = document.getElementById('auth-submit');
  const toggleButton = document.getElementById('auth-toggle-mode');
  const errorEl = document.getElementById('auth-error');
  const authScreen = document.getElementById('auth-screen');
  const translatorScreen = document.getElementById('translator-screen');

  let mode = 'login';

  function setMode(next) {
    mode = next;
    submitButton.textContent = mode === 'login' ? 'Войти' : 'Зарегистрироваться';
    toggleButton.textContent = mode === 'login' ? 'Нет аккаунта? Зарегистрироваться' : 'Уже есть аккаунт? Войти';
  }

  toggleButton.addEventListener('click', () => setMode(mode === 'login' ? 'register' : 'login'));

  function showTranslator() {
    authScreen.hidden = true;
    translatorScreen.hidden = false;
    window.dispatchEvent(new CustomEvent('authenticated'));
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    try {
      if (mode === 'login') {
        await window.Api.login(email, password);
      } else {
        await window.Api.register(email, password);
      }
      showTranslator();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  });

  window.Api.me()
    .then(showTranslator)
    .catch(() => {});

  setMode('login');
})();
```

- [ ] **Step 5: Manual verification**

Run: `npm start`, open `http://localhost:3000` in a browser.
Expected: Auth form renders; registering a new email switches to the (currently empty) translator screen; reloading the page while logged in skips straight to the translator screen (via `Api.me()`); wrong password on login shows the error message inline.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/css/app.css public/js/api.js public/js/auth.js
git commit -m "Add mobile auth screen (login/register) wired to the API"
```

---

## Task 9: Frontend — translator screen (text flow)

**Files:**
- Modify: `public/index.html` (fill in `#translator-screen`)
- Modify: `public/css/app.css` (append translator-screen styles)
- Create: `public/js/translator.js`

**Interfaces:**
- Consumes: `window.Api` (Task 8), the fixed language list duplicated client-side as `LANGUAGES` (mirrors `src/languages.js`'s `LANGUAGES`, since the browser can't `require()` the server module — keeping both lists identical is a one-time copy, not worth a build step to share).
- Produces: renders the pair indicator, the Original/Translation card feed, the text input + send button, and the "Сменить язык" picker. This task is text-only; Task 10 adds voice on top of the same DOM.

- [ ] **Step 1: Fill in the translator screen markup in public/index.html**

Replace the `<section id="translator-screen" hidden>...</section>` placeholder with:

```html
  <section id="translator-screen" hidden>
    <header id="pair-bar">
      <span id="pair-indicator">Язык собеседника не задан</span>
      <button id="change-language-btn">Сменить язык</button>
    </header>

    <main id="feed"></main>

    <dialog id="language-dialog">
      <h2>Выберите язык собеседника</h2>
      <ul id="language-list"></ul>
      <button id="language-dialog-close">Закрыть</button>
    </dialog>

    <footer id="input-bar">
      <button id="mic-btn" type="button" aria-label="Голосовой ввод">🎤</button>
      <input id="text-input" type="text" placeholder="Введите сообщение" autocomplete="off">
      <button id="send-btn" type="button" aria-label="Отправить">➤</button>
    </footer>
  </section>
```

- [ ] **Step 2: Append translator-screen styles to public/css/app.css**

```css
#translator-screen {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
}

#pair-bar {
  position: sticky;
  top: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: white;
  border-bottom: 1px solid #d1d1d6;
  font-weight: 600;
}

#change-language-btn {
  border: none;
  background: #eef2ff;
  color: #0a84ff;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 14px;
}

#feed {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card {
  background: white;
  border-radius: 12px;
  padding: 12px 14px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}

.card .label {
  font-size: 12px;
  color: #8e8e93;
  margin-bottom: 4px;
}

.card .text {
  font-size: 16px;
}

.card .play-btn {
  margin-top: 6px;
  border: none;
  background: none;
  font-size: 18px;
  padding: 0;
}

#input-bar {
  position: sticky;
  bottom: 0;
  display: flex;
  gap: 8px;
  padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
  background: white;
  border-top: 1px solid #d1d1d6;
}

#text-input {
  flex: 1;
  padding: 12px;
  font-size: 16px;
  border-radius: 20px;
  border: 1px solid #d1d1d6;
}

#mic-btn, #send-btn {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: none;
  background: #eef2ff;
  font-size: 18px;
}

#mic-btn.recording {
  background: #ff3b30;
  color: white;
}

#language-dialog ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

#language-dialog li button {
  width: 100%;
  text-align: left;
  padding: 12px;
  border: none;
  background: none;
  font-size: 16px;
  border-bottom: 1px solid #eee;
}
```

- [ ] **Step 3: Write public/js/translator.js**

```js
// public/js/translator.js
(() => {
  const LANGUAGES = [
    { name: 'Русский', code: 'ru-RU' },
    { name: 'Английский', code: 'en-US' },
    { name: 'Китайский', code: 'zh-CN' },
    { name: 'Испанский', code: 'es-ES' },
    { name: 'Немецкий', code: 'de-DE' },
    { name: 'Французский', code: 'fr-FR' },
    { name: 'Японский', code: 'ja-JP' },
    { name: 'Корейский', code: 'ko-KR' },
    { name: 'Арабский', code: 'ar-SA' },
    { name: 'Турецкий', code: 'tr-TR' },
    { name: 'Итальянский', code: 'it-IT' },
    { name: 'Португальский', code: 'pt-PT' },
    { name: 'Вьетнамский', code: 'vi-VN' },
    { name: 'Тайский', code: 'th-TH' },
    { name: 'Хинди', code: 'hi-IN' },
    { name: 'Польский', code: 'pl-PL' },
  ];
  window.TRANSLATOR_LANGUAGES = LANGUAGES;

  function codeForLanguage(name) {
    const found = LANGUAGES.find((l) => l.name === name);
    return found ? found.code : 'ru-RU';
  }
  window.codeForLanguage = codeForLanguage;

  const pairIndicator = document.getElementById('pair-indicator');
  const feed = document.getElementById('feed');
  const textInput = document.getElementById('text-input');
  const sendBtn = document.getElementById('send-btn');
  const changeLanguageBtn = document.getElementById('change-language-btn');
  const languageDialog = document.getElementById('language-dialog');
  const languageList = document.getElementById('language-list');
  const languageDialogClose = document.getElementById('language-dialog-close');

  let currentTargetLanguage = null;

  function updatePairIndicator() {
    pairIndicator.textContent = currentTargetLanguage
      ? `Русский ↔ ${currentTargetLanguage}`
      : 'Язык собеседника не задан';
  }

  function addCard(label, language, text) {
    const card = document.createElement('div');
    card.className = 'card';
    const labelEl = document.createElement('div');
    labelEl.className = 'label';
    labelEl.textContent = `${label} (${language})`;
    const textEl = document.createElement('div');
    textEl.className = 'text';
    textEl.textContent = text;
    card.appendChild(labelEl);
    card.appendChild(textEl);
    feed.appendChild(card);
    return card;
  }

  function addTranslationCard(sourceLanguage, targetLanguage, original, translation, voiceText) {
    addCard('Оригинал', sourceLanguage, original);
    const translationCard = addCard('Перевод', targetLanguage, translation);
    const playBtn = document.createElement('button');
    playBtn.className = 'play-btn';
    playBtn.textContent = '🔊';
    playBtn.addEventListener('click', () => window.speakText(voiceText, targetLanguage));
    translationCard.appendChild(playBtn);
    feed.scrollTop = feed.scrollHeight;
  }

  function addErrorCard(message) {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.color = '#ff3b30';
    card.textContent = message;
    feed.appendChild(card);
    feed.scrollTop = feed.scrollHeight;
  }

  async function sendText(text) {
    if (!text.trim()) return;
    try {
      const result = await window.Api.translate(text);
      currentTargetLanguage = result.session.targetLanguage;
      updatePairIndicator();
      addTranslationCard(result.sourceLanguage, result.targetLanguage, result.original, result.translation, result.voiceText);
    } catch (err) {
      addErrorCard(err.message);
    }
  }

  sendBtn.addEventListener('click', () => {
    const text = textInput.value;
    textInput.value = '';
    sendText(text);
  });

  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendBtn.click();
    }
  });

  changeLanguageBtn.addEventListener('click', () => {
    languageList.innerHTML = '';
    for (const lang of LANGUAGES) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.textContent = lang.name;
      btn.addEventListener('click', async () => {
        try {
          await window.Api.setLanguage(lang.name);
          currentTargetLanguage = lang.name;
          updatePairIndicator();
          languageDialog.close();
        } catch (err) {
          addErrorCard(err.message);
        }
      });
      li.appendChild(btn);
      languageList.appendChild(li);
    }
    languageDialog.showModal();
  });

  languageDialogClose.addEventListener('click', () => languageDialog.close());

  window.addEventListener('authenticated', async () => {
    try {
      const me = await window.Api.me();
      currentTargetLanguage = me.targetLanguage;
      updatePairIndicator();
    } catch {
      // stays on the auth screen if this somehow fires without a session
    }
  });
})();
```

- [ ] **Step 4: Register the new script in public/index.html**

Add before `</body>`, after `auth.js`:

```html
  <script src="/js/translator.js"></script>
```

- [ ] **Step 5: Manual verification**

Run: `npm start` (with a real `OPENAI_API_KEY` in `.env`, or temporarily point `TRANSLATOR_MODEL`/mock — see README in Task 11 for how to smoke-test without burning API calls). Register a user, type `你好，你好吗？`, send it.
Expected: pair indicator updates to `Русский ↔ Китайский`; a card pair (Оригинал/Перевод) appears; typing a Russian phrase next translates to Chinese; "Сменить язык" opens the 16-language list and picking one updates the indicator immediately.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/css/app.css public/js/translator.js
git commit -m "Add mobile translator screen: pair indicator, card feed, language picker"
```

---

## Task 10: Frontend — voice (STT input + TTS playback)

**Files:**
- Create: `public/js/voice.js`
- Modify: `public/js/translator.js:1-3` (nothing structural — `voice.js` only needs `window.codeForLanguage`, already exposed in Task 9)
- Modify: `public/index.html` (register the new script)

**Interfaces:**
- Consumes: `window.codeForLanguage` (Task 9), `#mic-btn`/`#text-input` DOM elements (Task 9).
- Produces: `window.speakText(text, languageName)` — used by the 🔊 buttons added in Task 9's `addTranslationCard`. Wires the mic button to browser `SpeechRecognition`.

- [ ] **Step 1: Write public/js/voice.js**

```js
// public/js/voice.js
(() => {
  const micBtn = document.getElementById('mic-btn');
  const textInput = document.getElementById('text-input');

  const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;

  function speakText(text, languageName) {
    if (!('speechSynthesis' in window)) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = window.codeForLanguage(languageName);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }
  window.speakText = speakText;

  if (!SpeechRecognitionImpl) {
    micBtn.hidden = true;
    return;
  }

  let sttLang = 'ru-RU';
  let recognizing = false;
  let recognition = null;

  function currentTargetCode() {
    const pairText = document.getElementById('pair-indicator').textContent;
    const match = pairText.match(/↔ (.+)$/);
    return match ? window.codeForLanguage(match[1]) : 'ru-RU';
  }

  micBtn.addEventListener('click', () => {
    if (recognizing) {
      recognition.stop();
      return;
    }

    sttLang = sttLang === 'ru-RU' ? currentTargetCode() : 'ru-RU';
    recognition = new SpeechRecognitionImpl();
    recognition.lang = sttLang;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      recognizing = true;
      micBtn.classList.add('recording');
    };
    recognition.onend = () => {
      recognizing = false;
      micBtn.classList.remove('recording');
    };
    recognition.onerror = () => {
      recognizing = false;
      micBtn.classList.remove('recording');
    };
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      textInput.value = transcript;
      textInput.focus();
    };

    recognition.start();
  });
})();
```

Note: `sttLang` toggles between Russian and the current target language's code on each mic tap (per the design doc's "small toggle... to flip recognition language"), rather than a separate visible toggle control — tapping the mic again mid-conversation naturally alternates which side is being dictated. If real usage shows this guess is wrong often, add a visible toggle then.

- [ ] **Step 2: Register the script in public/index.html**

Add before `</body>`, after `translator.js`:

```html
  <script src="/js/voice.js"></script>
```

- [ ] **Step 3: Manual verification**

Run: `npm start`, open on a phone (or Chrome DevTools device emulation with microphone permission granted) over `https://localhost` or the real deployed HTTPS URL (mic access requires a secure context).
Expected: tapping 🎤 prompts for mic permission, turns the button red while listening, fills the text input with the recognized phrase on stop (does not auto-send); tapping 🔊 on a translation card speaks it using the correct language's voice.

- [ ] **Step 4: Commit**

```bash
git add public/js/voice.js public/index.html
git commit -m "Add voice input (STT) and playback (TTS) via the Web Speech API"
```

---

## Task 11: README + deployment notes

**Files:**
- Create: `README.md`

**Interfaces:** None — documentation only.

- [ ] **Step 1: Write README.md**

```markdown
# Переводчик — веб-версия

Двусторонний ИИ-переводчик «русский ↔ язык собеседника» с аккаунтами и голосом.
Полный дизайн: `docs/superpowers/specs/2026-07-14-translator-web-design.md`.
Контракт перевода: `translator-mode-web-spec.md`.

## Запуск локально

1. `npm install`
2. Скопировать `.env.example` в `.env`, заполнить `OPENAI_API_KEY` и `SESSION_SECRET`.
3. `npm start`
4. Открыть `http://localhost:3000`.

Голосовой ввод (`SpeechRecognition`) требует HTTPS или `localhost` — в проде это
даёт Cloudflare, локально `localhost` уже считается secure context.

## Тесты

`npm test` — юнит- и интеграционные тесты (`node:test`), включая все 9 сценариев
из раздела «Обязательные тесты» спеки. Реальный OpenAI API не вызывается —
`openaiClient.callOpenAI` подменяется фейком в тестах.

## Деплой на Ubuntu VPS + Cloudflare

1. Установить Node.js >= 18 и build-essential (нужен для сборки `better-sqlite3`/`bcrypt`
   из исходников): `sudo apt install -y build-essential python3`.
2. Склонировать репозиторий на сервер, `npm install --omit=dev`, заполнить `.env`
   (реальный `SESSION_SECRET`, `OPENAI_API_KEY`).
3. Запустить процесс постоянно, например через systemd или pm2 (`pm2 start server.js --name translator`).
4. В Cloudflare: A-запись на IP сервера, SSL/TLS режим Full (или Full strict, если
   на origin тоже настроен сертификат) — этого достаточно, чтобы браузер видел
   `https://` и разрешал доступ к микрофону.
5. `data/app.db` и `data/sessions.sqlite` — единственное постоянное состояние,
   бэкапить эту директорию.

## Переменные окружения

См. `.env.example`: `PORT`, `SESSION_SECRET`, `OPENAI_API_KEY`, `TRANSLATOR_MODEL`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Add README with run, test, and Ubuntu/Cloudflare deploy instructions"
```

---

## Self-Review Notes

- **Spec coverage:** all 9 required test scenarios → Task 5. Backend API contract (success/error shapes, `voiceText`, session field) → Tasks 5/7. Alphabet-mismatch retry-then-fail → Task 5. Model response parsing (fences, CRLF) → Task 4. `TARGET_LANGUAGE_REQUIRED` gate without a wasted model call → Task 5, Step 1's test #1 asserts `called === false`. Rate limiting, length cap, no-raw-errors-to-client → Task 7. Mobile UI (pair indicator, card feed, sticky input bar, language picker) → Tasks 8–9. Voice always-on (STT + TTS) → Task 10. Accounts (not anonymous sessions) → Tasks 3/6.
- **Placeholder scan:** no TBD/TODO; every step has runnable code.
- **Type/name consistency checked:** `createTranslator(openaiClient).translateText(user, text)` signature is identical across Tasks 5 and 7; `createTranslatorRouter(db, translator)` matches its Task 7 call site in `app.js`; `codeForLanguage` name matches between `src/languages.js` (Task 2) and the duplicated client-side copy (Task 9/10).
- **Scope:** single cohesive app, no sub-project split needed.
