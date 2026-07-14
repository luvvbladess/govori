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
   Установить `NODE_ENV=production` (в `.env` или окружении сервиса) — иначе Express
   может включать stack trace в ответ об ошибке.
4. В Cloudflare: A-запись на IP сервера, SSL/TLS режим Full (или Full strict, если
   на origin тоже настроен сертификат) — этого достаточно, чтобы браузер видел
   `https://` и разрешал доступ к микрофону.
5. `data/app.db` и `data/sessions.sqlite` — единственное постоянное состояние,
   бэкапить эту директорию.

## Переменные окружения

См. `.env.example`: `PORT`, `SESSION_SECRET`, `OPENAI_API_KEY`, `TRANSLATOR_MODEL`.
