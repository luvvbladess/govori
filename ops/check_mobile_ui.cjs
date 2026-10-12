// Local layout regression matrix. APIs, microphone and messages are fixtures.
// NODE_PATH=<Playwright packages> PLAYWRIGHT_CHANNEL=chrome node ops/check_mobile_ui.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { chromium, webkit } = require('playwright');

const sizes = [[280,480], [320,480], [320,568], [360,640], [390,844], [430,932], [480,800], [568,320], [667,375], [844,390], [768,1024], [1024,768], [280,320], [320,320], [390,360]];
const longText = 'ОченьДлиннаяФразаБезПробеловLongUnbrokenPhrase没有空格的长消息'.repeat(12);
const room = {
  id: 'mobile-qa', title: 'LongConversationName'.repeat(6), memberId: 'qa-host', role: 'host', inviteToken: 'a'.repeat(64),
  sourceLanguage: 'Русский', targetLanguage: 'Английский',
  participants: ['Русский', 'Английский', 'Китайский'].map((language, index) => ({
    id: index ? `qa-${index}` : 'qa-host', language, name: 'LongParticipantName'.repeat(4),
    role: index ? 'guest' : 'host', lastSeen: new Date().toISOString(), speaking: false,
  })),
};
const messages = [1, 2].map(id => ({
  id, memberId: 'qa-1', senderName: 'LongParticipantName'.repeat(4), status: 'translated',
  createdAt: new Date().toISOString(), sourceText: longText, sourceLanguage: 'Английский', targetLanguage: 'Русский',
  translationText: longText, translations: { Русский: { status: 'translated', text: longText } },
}));

function fixture() {
  const app = express(); app.use(express.json());
  if (process.env.QA_MOBILE_PREVIEW) app.get('/', (_req, res) => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    res.type('html').send(html.includes('/css/mobile.css') ? html : html.replace('</head>', '<link rel="stylesheet" href="/css/mobile.css"></head>'));
  });
  app.get('/api/auth/me', (_req, res) => res.json({ ok: true, email: 'mobile-qa@example.com', sourceLanguage: 'Русский', targetLanguage: 'Английский' }));
  app.get('/api/translator/voices', (_req, res) => res.json({ ok: true, defaultVoice: 'marin', voices: [{ id: 'marin', name: 'Marin' }, { id: 'cedar', name: 'Cedar' }] }));
  app.get('/api/translator/conversations', (_req, res) => res.json({ ok: true, conversations: Array.from({ length: 16 }, (_, id) => ({ id: id + 1, title: longText })) }));
  app.get('/api/shared', (_req, res) => res.json({ ok: true, rooms: [room] }));
  app.get('/api/shared/mobile-qa', (_req, res) => res.json({ ok: true, room, messages }));
  app.post('/api/shared/mobile-qa/speaking', (_req, res) => res.json({ ok: true }));
  app.get('/api/shared/invite/:token', (_req, res) => res.json({ ok: true, title: room.title, language: 'Английский' }));
  app.use('/api/push', (_req, res) => res.json({ ok: true, enabled: false, configured: false, publicKey: null }));
  app.use(express.static(path.join(__dirname, '../public')));
  return new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
}

async function checkLayout(page, label, failures) {
  const errors = await page.evaluate(() => {
    const problems = [];
    if (document.documentElement.scrollWidth > innerWidth + 1) problems.push(`document overflow ${document.documentElement.scrollWidth}/${innerWidth}`);
    for (const selector of ['#feed', '#input-bar', '.input-utility-row', '#shared-setup', 'dialog[open]', '#auth-screen:not([hidden])']) {
      for (const element of document.querySelectorAll(selector)) {
        if (!element.getClientRects().length) continue;
        const rect = element.getBoundingClientRect();
        if (rect.left < -1 || rect.right > innerWidth + 1) problems.push(`${selector} extends horizontally ${rect.left}/${rect.right}`);
        if (element.scrollWidth > element.clientWidth + 1) problems.push(`${selector} inner overflow ${element.scrollWidth}/${element.clientWidth}`);
      }
    }
    return problems;
  });
  failures.push(...errors.map(error => `${label}: ${error}`));
}

async function reachable(page, selector, label, failures) {
  const locator = page.locator(selector);
  if (!(await locator.isVisible())) { failures.push(`${label}: ${selector} hidden`); return; }
  // A deliberately scrollable short-landscape layout is allowed, provided
  // the actual element can be scrolled into view and hit by a touch.
  await locator.scrollIntoViewIfNeeded();
  const state = await locator.evaluate(element => {
    const rect = element.getBoundingClientRect(); const x = rect.left + rect.width / 2; const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { inside: rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= -1 && rect.bottom <= innerHeight + 1,
      hit: hit === element || element.contains(hit), width: rect.width, height: rect.height };
  });
  if (!state.inside || !state.hit || state.width < 40 || state.height < 40) failures.push(`${label}: ${selector} not touch-reachable ${JSON.stringify(state)}`);
}

async function dialog(page, open, id, close, label, failures) {
  await page.locator(open).scrollIntoViewIfNeeded(); await page.locator(open).click();
  await page.locator(id).waitFor({ state: 'visible' });
  await checkLayout(page, `${label}/${id}`, failures);
  if (id === '#speech-settings-dialog') {
    for (const selector of ['#speech-voice', '#notifications-toggle']) {
      if (await page.locator(selector).count()) await reachable(page, selector, `${label}/${id}`, failures);
    }
  }
  await page.locator(id).evaluate(element => { element.scrollTop = element.scrollHeight; });
  await reachable(page, close, `${label}/${id}`, failures);
  await page.locator(close).click();
}

async function preparePage(context, locale, theme, label, failures) {
  const page = await context.newPage();
  page.setDefaultTimeout(3000);
  page.on('pageerror', error => failures.push(`${label}: browser error ${error.message}`));
  await page.addInitScript(({ locale, theme }) => {
    localStorage.setItem('ui-locale', locale); localStorage.setItem('theme', theme); localStorage.setItem('chat-font-size', '24');
    class Recorder {
      static isTypeSupported() { return true; }
      constructor() { this.mimeType = 'audio/webm'; }
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['qa']) }); this.onstop?.(); }
    }
    window.MediaRecorder = Recorder;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
    } });
  }, { locale, theme });
  return page;
}

async function checkChat(page, label, failures) {
    await page.locator('#text-input').fill('typed phrase');
    await page.locator('#feed').evaluate(element => { element.scrollTop = 0; });
    await checkLayout(page, `${label}/chat`, failures);
    const controls = ['#mic-btn', '#send-btn', '#speech-settings-open', '#shared-room-menu', '#ui-language', '#chat-font-open', '#theme-toggle', '#live-mode-btn'];
    if (await page.locator('#notifications-open').count()) controls.push('#notifications-open');
    for (const selector of controls) await reachable(page, selector, label, failures);
    const feedHeight = await page.locator('#feed').evaluate(element => element.clientHeight);
    if (feedHeight < 80) failures.push(`${label}: feed only ${feedHeight}px tall`);
}

async function checkDialogs(page, label, failures) {
    await dialog(page, '#speech-settings-open', '#speech-settings-dialog', '#speech-settings-close', label, failures);
    await dialog(page, '#chat-font-open', '#chat-font-dialog', '#chat-font-close', label, failures);
    await dialog(page, '#history-btn', '#history-dialog', '#history-close', label, failures);
    await page.locator('#shared-room-menu').click();
    await checkLayout(page, `${label}/room`, failures);
    await page.locator('#shared-status').click(); await checkLayout(page, `${label}/people`, failures);
    await reachable(page, '#shared-people-close', label, failures); await page.locator('#shared-people-close').click();
    await page.locator('#shared-invite').click(); await checkLayout(page, `${label}/invite-link`, failures);
    await reachable(page, '#shared-copy', label, failures); await page.locator('#shared-room-close').click();
}

async function checkRecording(page, label, failures, screenshots, width, height, locale, theme) {
    await page.evaluate(text => {
      const getRoom = window.Api.sharedRoom;
      window.Api.sharedRoom = async (...args) => {
        const data = await getRoom(...args);
        return { ...data, room: { ...data.room, participants: data.room.participants.map(member => member.id === 'qa-1' ? { ...member, name: text, speaking: true } : member) } };
      };
      const banner = document.getElementById('shared-speaking'); banner.hidden = false; banner.textContent = `${window.t('shared.speakingNow')}: ${text}`;
      const transcript = document.getElementById('live-transcript'); transcript.hidden = false; transcript.textContent = text;
    }, longText);
    await page.locator('#mic-btn').click(); await page.locator('#voice-cancel').waitFor({ state: 'visible' });
    await checkLayout(page, `${label}/speaking-recording`, failures);
    const banner = await page.locator('#shared-speaking').evaluate(element => ({ hidden: element.hidden, height: element.clientHeight }));
    if (banner.hidden || banner.height < 40) failures.push(`${label}/recording: speaking banner unreadable ${JSON.stringify(banner)}`);
    for (const selector of ['#voice-cancel', '#mic-btn', '#send-btn']) await reachable(page, selector, `${label}/recording`, failures);
    const activeFeedHeight = await page.locator('#feed').evaluate(element => element.clientHeight);
    if (activeFeedHeight < 60) failures.push(`${label}/recording: feed only ${activeFeedHeight}px tall`);
    if (screenshots && width === 320 && height === 480 && locale === 'ru' && theme === 'dark') await page.screenshot({ path: path.join(screenshots, `mobile-stress-${width}x${height}-after.png`), fullPage: true });
    await page.locator('#voice-cancel').click();
    await page.evaluate(() => { document.getElementById('shared-speaking').hidden = true; window.SharedConversation.deactivate(); });
}

async function checkForms(page, label, failures) {
    await dialog(page, '#source-language-btn', '#language-dialog', '#language-dialog-close', label, failures);
    await page.locator('#shared-create').click(); await checkLayout(page, `${label}/setup`, failures);
    for (const selector of ['#shared-room-title', '#shared-name', '#shared-language', '#shared-start', '#shared-cancel']) await reachable(page, selector, `${label}/setup`, failures);
    await page.locator('#shared-cancel').click();
    for (const [id, close] of [['#guest-menu-dialog', '#guest-menu-close'], ['#trial-limit-dialog', '#trial-limit-login']]) {
      await page.locator(id).evaluate(element => element.showModal()); await checkLayout(page, `${label}/${id}`, failures);
      await reachable(page, close, label, failures); await page.locator(close).click();
    }
    await page.evaluate(() => { window.accessState = { authenticated: false, translationsRemaining: 3 }; window.showAuth('register'); }); await checkLayout(page, `${label}/register`, failures);
    for (const selector of ['#auth-email', '#auth-company', '#auth-password', '#auth-submit', '#auth-back-to-app']) await reachable(page, selector, `${label}/register`, failures);
    await page.locator('#auth-back-to-app').click();
}

async function checkCase(browser, base, width, height, locale, theme, failures, screenshots) {
  const label = `${width}x${height}/${locale}/${theme}`;
  const context = await browser.newContext({ viewport: { width, height }, locale: { ru: 'ru-RU', en: 'en-US', zh: 'zh-CN' }[locale], hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  const page = await preparePage(context, locale, theme, label, failures);
  const initialFailures = failures.length;
  try {
    await page.goto(`${base}/#room=mobile-qa`);
    await page.waitForFunction(() => window.SharedConversation?.active && document.querySelectorAll('#feed .turn-card').length === 2);
    await checkChat(page, label, failures);
    await checkDialogs(page, label, failures);
    await checkRecording(page, label, failures, screenshots, width, height, locale, theme);
    await checkForms(page, label, failures);
    if (failures.length > initialFailures && screenshots) await page.screenshot({ path: path.join(screenshots, `mobile-failure-${width}x${height}-${locale}-${theme}.png`), fullPage: true });
  } catch (error) {
    failures.push(`${label}: ${error.message.split('\n')[0]}`);
    if (screenshots) await page.screenshot({ path: path.join(screenshots, `mobile-failure-${width}x${height}-${locale}-${theme}.png`), fullPage: true });
  } finally { await context.close(); }
}

async function main() {
  const server = await fixture(); let browser;
  const failures = [];
  const screenshotDir = process.env.QA_MOBILE_SCREENSHOTS;
  if (screenshotDir) fs.mkdirSync(screenshotDir, { recursive: true });
  try {
    const engine = process.env.QA_BROWSER === 'webkit' ? webkit : chromium;
    browser = await engine.launch({ headless: true, ...(engine === chromium && process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
    const base = `http://127.0.0.1:${server.address().port}`;
    const selected = process.env.QA_MOBILE_VIEWPORTS
      ? process.env.QA_MOBILE_VIEWPORTS.split(',').map(size => { const match = /^(\d+)x(\d+)$/.exec(size); assert.ok(match, 'Use WIDTHxHEIGHT viewport entries'); return [Number(match[1]), Number(match[2])]; })
      : process.env.QA_MOBILE_QUICK ? [[320,480], [568,320], [390,844]] : sizes;
    for (const [width, height] of selected) {
      for (const locale of ['ru','en','zh']) for (const theme of ['light','dark']) {
        await checkCase(browser, base, width, height, locale, theme, failures, screenshotDir);
      }
      console.log(`Checked ${width}x${height}: ${failures.length} layout failures so far`);
    }
    console.log(JSON.stringify({ browser: process.env.QA_BROWSER || 'chromium', preview: Boolean(process.env.QA_MOBILE_PREVIEW), cases: selected.length * 6, failures }, null, 2));
    assert.equal(failures.length, 0, `${failures.length} mobile layout regressions`);
  } finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
