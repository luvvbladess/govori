// Local browser regression check; the provider and microphone are simulated.
// Run with Playwright available: node ops/check_shared_ui.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const { chromium } = require('playwright');
const { createDb } = require('../src/db');
const { createAuthRouter, requireAccess } = require('../src/auth');
const { createSharedRouter } = require('../src/sharedRoutes');
const { createTranslatorRouter } = require('../src/translatorRoutes');
const { createTranslator } = require('../src/translator');

async function main() {
  const db = createDb(':memory:');
  // Keep fake audio cache entries separate from local users and earlier runs.
  db.prepare("INSERT INTO sqlite_sequence (name,seq) VALUES ('users',?)").run(Date.now());
  const translations = { Русский: 'Привет', Английский: 'Hello', Испанский: 'Hola' };
  let personalRequests = 0;
  const speechRequests = [];
  let transcriptionRequests = 0;
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'local-browser-test-only', resave: false, saveUninitialized: false }));
  app.use('/api/auth', createAuthRouter(db));
  app.use('/api/translator/translate', (req, res, next) => { personalRequests++; next(); });
  const translator = createTranslator({
    callOpenAI: async (target) => ({ detected_lang: target, translation: translations[target], new_target_lang: null }),
    createRealtimeTranscriptionCall: async () => 'simulated-answer',
    transcribeAudio: async () => { transcriptionRequests++; return 'unsent phrase'; },
    createSpeech: async (text, language, voice) => { speechRequests.push(voice); return Buffer.from(`test-audio-${voice}`); },
  });
  app.use('/api/translator', requireAccess(db), createTranslatorRouter(db, translator));
  app.use('/api/shared', requireAccess(db), createSharedRouter(db, translator));
  app.use(express.static(path.join(__dirname, '../public')));
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
    const base = `http://127.0.0.1:${server.address().port}`;
    const contexts = await Promise.all(Array.from({ length: 4 }, () => browser.newContext({ locale: 'ru-RU', viewport: { width: 390, height: 844 } })));
    const pages = await Promise.all(contexts.map(context => context.newPage()));
    const errors = [];
    pages.forEach(page => page.on('pageerror', error => errors.push(error.message)));
    await pages[0].addInitScript(() => {
      class Channel {
        constructor() { this.events = {}; window.qaLiveChannel = this; }
        addEventListener(type, callback) { this.events[type] = callback; }
        close() {}
        emit(type) { this.events.message({ data: JSON.stringify({ type }) }); }
      }
      class Peer {
        constructor() { this.events = {}; window.qaLivePeer = this; }
        createDataChannel() { return new Channel(); }
        addTrack() {}
        addEventListener(type, callback) { this.events[type] = callback; }
        async createOffer() { return { sdp: 'simulated-offer' }; }
        async setLocalDescription() {}
        async setRemoteDescription() {}
        close() {}
      }
      window.RTCPeerConnection = Peer;
      class Recorder {
        static isTypeSupported() { return true; }
        constructor() { this.mimeType = 'audio/webm'; }
        start() { this.state = 'recording'; }
        stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['test-recording']) }); this.onstop?.(); }
      }
      class Playback {
        constructor() { this.events = {}; }
        addEventListener(type, callback) { this.events[type] = callback; }
        removeEventListener(type) { delete this.events[type]; }
        load() { this.events.canplay?.(); }
        async play() {}
        pause() {}
      }
      window.MediaRecorder = Recorder; window.Audio = Playback;
      window.qaStoppedTracks = 0;
      navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop() { window.qaStoppedTracks++; } }] });
    });
    await pages[0].goto(base);
    await pages[0].waitForFunction(() => window.accessState);
    await pages[0].evaluate(() => window.showAuth('register'));
    await pages[0].locator('#auth-email').fill('browser-qa@example.com');
    await pages[0].locator('#auth-company').fill('Test');
    await pages[0].locator('#auth-password').fill('local-test-password');
    await pages[0].locator('#auth-submit').click();
    await pages[0].waitForFunction(() => window.accessState?.authenticated);
    await pages[0].locator('#history-btn').click();
    await pages[0].locator('#new-shared-btn').click();
    await pages[0].locator('#shared-name').fill('Host');
    await pages[0].locator('#shared-room-title').fill('Local regression');
    await pages[0].locator('#shared-start').click();
    await pages[0].waitForFunction(() => window.SharedConversation?.active);
    const room = await pages[0].evaluate(() => window.SharedConversation.active);
    for (let i = 1; i < pages.length; i++) {
      await pages[i].goto(`${base}/#invite=${room.inviteToken}`);
      await pages[i].locator('#shared-setup').waitFor({ state: 'visible' });
      await pages[i].locator('#shared-name').fill(['', 'Alex', 'Maria', 'Luis'][i]);
      await pages[i].locator('#shared-language').selectOption(i === 1 ? 'Английский' : 'Испанский');
      await pages[i].locator('#shared-start').click();
      await pages[i].waitForFunction(() => window.SharedConversation?.active);
    }
    await pages[0].waitForFunction(() => window.SharedConversation.active.participants.length === 4);
    for (let i = 0; i < 3; i++) {
      await pages[i].locator('#text-input').fill('OK');
      await pages[i].locator('#send-btn').click();
      await pages[i].waitForFunction(() => !window.translationBusy());
    }
    for (let i = 0; i < pages.length; i++) {
      await pages[i].waitForFunction(() => document.querySelectorAll('#feed .turn-card').length === 3);
      assert.equal(await pages[i].locator('#feed .error-card').count(), 0);
      const expected = i === 0 ? 'Привет' : i === 1 ? 'Hello' : 'Hola';
      assert.ok((await pages[i].locator('#feed').textContent()).includes(expected));
    }
    await pages[0].locator('#speech-settings-open').click();
    await pages[0].locator('#speech-voice').selectOption('cedar');
    await pages[0].locator('#speech-settings-close').click();
    await pages[0].locator('#feed .play-btn').first().click();
    await pages[0].waitForFunction(() => document.querySelector('#feed .play-btn').dataset.loading === 'true' && document.querySelector('#feed .play-btn').getAttribute('aria-label') === 'Остановить озвучку');
    assert.equal(speechRequests.at(-1), 'cedar');
    await pages[0].locator('#speech-settings-open').click();
    await pages[0].locator('#speech-voice').selectOption('marin');
    await pages[0].locator('#speech-settings-close').click();
    await pages[0].locator('#feed .play-btn').first().click();
    await pages[0].waitForFunction(() => document.querySelector('#feed .play-btn').getAttribute('aria-label') === 'Остановить озвучку');
    assert.equal(speechRequests.at(-1), 'marin');
    await pages[0].evaluate(() => window.stopSpeech());
    assert.equal(await pages[0].evaluate(() => localStorage.getItem('speech-voice')), 'marin');
    await pages[0].locator('#live-mode-btn').click();
    await pages[0].locator('#mic-btn').click();
    await pages[0].waitForFunction(() => window.qaLiveChannel && document.querySelector('#mic-btn').getAttribute('aria-pressed') === 'true');
    assert.equal(await pages[1].locator('#shared-speaking').isVisible(), false);
    await pages[0].evaluate(() => window.qaLiveChannel.emit('input_audio_buffer.speech_started'));
    await pages[1].waitForFunction(() => document.querySelector('#shared-speaking').textContent.includes('Сейчас говорит: Host'));
    if (process.env.QA_SCREENSHOT) await pages[1].screenshot({ path: process.env.QA_SCREENSHOT, fullPage: true });
    await pages[1].locator('#shared-room-menu').click();
    await pages[1].locator('#shared-status').click();
    assert.ok((await pages[1].locator('#shared-people-list').textContent()).includes('Host · Русский · говорит'));
    await pages[1].locator('#shared-people-close').click();
    await pages[1].locator('#shared-room-close').click();
    // Heartbeats must keep the status alive beyond its six-second expiry.
    await pages[1].waitForTimeout(6500);
    assert.equal(await pages[1].locator('#shared-speaking').isVisible(), true);
    await pages[0].evaluate(() => window.qaLiveChannel.emit('input_audio_buffer.speech_stopped'));
    await pages[1].waitForFunction(() => document.querySelector('#shared-speaking').hidden);
    await pages[0].evaluate(() => window.qaLiveChannel.emit('input_audio_buffer.speech_started'));
    await pages[1].waitForFunction(() => !document.querySelector('#shared-speaking').hidden);
    await pages[0].evaluate(() => { window.qaLivePeer.connectionState = 'disconnected'; window.qaLivePeer.events.connectionstatechange(); });
    await pages[1].waitForFunction(() => document.querySelector('#shared-speaking').hidden);
    await pages[0].locator('#live-mode-btn').click();
    await pages[0].locator('#mic-btn').click();
    await pages[0].locator('#voice-cancel').waitFor({ state: 'visible' });
    await pages[0].locator('#voice-cancel').click();
    await pages[0].waitForFunction(() => !window.voiceInProgress());
    assert.equal(await pages[0].locator('#voice-cancel').isVisible(), false);
    assert.equal(transcriptionRequests, 0);
    assert.equal(await pages[0].locator('#feed .turn-card').count(), 3);
    await pages[0].locator('#live-mode-btn').click();
    await pages[0].locator('#mic-btn').click();
    await pages[0].waitForFunction(() => document.querySelector('#mic-btn').getAttribute('aria-pressed') === 'true');
    await pages[0].evaluate(() => window.qaLiveChannel.emit('input_audio_buffer.speech_started'));
    await pages[1].waitForFunction(() => !document.querySelector('#shared-speaking').hidden);
    await pages[0].locator('#voice-cancel').click();
    await pages[1].waitForFunction(() => document.querySelector('#shared-speaking').hidden);
    await pages[0].evaluate(() => window.qaLiveChannel.events.message({ data: JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'canceled phrase' }) }));
    assert.equal(await pages[0].locator('#feed .turn-card').count(), 3);
    // Simulate closing the device without a stop update: server TTL must clear it.
    await pages[0].evaluate(() => window.Api.sharedSpeaking(window.SharedConversation.active.id, true));
    await pages[1].waitForFunction(() => !document.querySelector('#shared-speaking').hidden);
    await pages[1].waitForFunction(() => document.querySelector('#shared-speaking').hidden, null, { timeout: 10000 });
    await pages[2].locator('#shared-room-menu').click();
    await pages[2].locator('#shared-leave').click();
    await pages[2].waitForFunction(() => !window.SharedConversation.active);
    assert.equal(await pages[2].evaluate(async () => (await window.Api.sharedRooms()).rooms.length), 0);
    await pages[0].waitForFunction(() => window.SharedConversation.active.participants.length === 3);
    const departed = await contexts[2].request.get(`${base}/api/shared/${room.id}`);
    assert.equal(departed.status(), 404);
    await pages[2].reload();
    await pages[2].waitForFunction(() => window.accessState);
    assert.equal(await pages[2].evaluate(() => window.SharedConversation.active), null);
    await pages[2].goto(`${base}/#invite=${room.inviteToken}`);
    await pages[2].locator('#shared-setup').waitFor({ state: 'visible' });
    await pages[2].locator('#shared-name').fill('Maria');
    await pages[2].locator('#shared-language').selectOption('Испанский');
    await pages[2].locator('#shared-start').click();
    await pages[2].waitForFunction(() => document.querySelectorAll('#feed .turn-card').length === 3);
    // Leaving on a second device must stop the first device's microphone and
    // must never send late group speech into a personal conversation.
    await pages[0].locator('#mic-btn').click();
    await pages[0].waitForFunction(() => document.querySelector('#mic-btn').getAttribute('aria-pressed') === 'true');
    await pages[0].evaluate(() => window.qaLiveChannel.emit('input_audio_buffer.speech_started'));
    const secondDevice = await browser.newContext();
    assert.equal((await secondDevice.request.post(`${base}/api/auth/login`, { data: { email: 'browser-qa@example.com', password: 'local-test-password' } })).status(), 200);
    assert.equal((await secondDevice.request.post(`${base}/api/shared/${room.id}/leave`, { data: {} })).status(), 200);
    await pages[0].waitForFunction(() => !window.SharedConversation.active && !window.voiceInProgress());
    assert.ok(await pages[0].evaluate(() => window.qaStoppedTracks > 0));
    await pages[0].evaluate(() => window.qaLiveChannel.events.message({ data: JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'late group phrase', item_id: 'late' }) }));
    await pages[0].waitForFunction(() => !window.translationBusy());
    assert.equal(personalRequests, 0);
    await secondDevice.close();
    assert.deepEqual(errors, []);
    for (const page of pages) assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    console.log('PASS: 4 participants / 3 languages, current speaker banner, ordinary/live Cancel, per-voice playback and cache, VAD/heartbeat/expiry, leave/rejoin + cross-device cancellation, mobile layout, no browser errors');
  } catch (error) {
    console.error('Local browser QA failed:', error.message);
    if (browser) {
      for (const context of browser.contexts()) for (const page of context.pages()) {
        console.error(await page.evaluate(() => ({ cards: document.querySelectorAll('#feed .turn-card').length, feed: document.querySelector('#feed').textContent, active: window.SharedConversation?.active?.id })));
      }
    }
    throw error;
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
