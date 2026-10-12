const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// Exercise asynchronous UI behavior without requesting the user's microphone.
function harness(file, extras = {}) {
  class Element {
    constructor() { this.children = []; this.handlers = {}; this.dataset = {}; this.value = ''; this.hidden = false; this.disabled = false; this.className = ''; this.classList = { add() {}, toggle() {}, remove() {} }; this.scrollHeight = 100; this.scrollTop = 0; this.clientHeight = 200; }
    addEventListener(name, handler) { this.handlers[name] = handler; }
    setAttribute() {}
    append(...children) { this.children.push(...children); children.forEach((child) => { child.parent = this; }); }
    prepend(child) { this.children.unshift(child); child.parent = this; }
    replaceChild(next, old) { this.children[this.children.indexOf(old)] = next; next.parent = this; }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    replaceWith(next) { this.parent?.replaceChild(next, this); }
    insertBefore(child, next) { child.parent?.children.splice(child.parent.children.indexOf(child), 1); this.children.splice(this.children.indexOf(next), 0, child); child.parent = this; }
    querySelector() { return new Element(); }
    remove() {}
    close() { this.open = false; }
    showModal() { this.open = true; }
    focus() {}
    select() {}
  }
  const elements = new Map(); const events = {}; const intervals = []; const values = new Map();
  const element = (id) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const window = {
    t: (key) => key, errorMessage: () => 'error', addEventListener: (name, callback) => { events[name] = callback; },
    setTimeout: (callback, delay) => delay < 10000 ? setTimeout(callback, delay) : 0, clearTimeout,
    setInterval: (callback) => { intervals.push(callback); return 0; }, clearInterval() {},
    codeForLanguage: () => 'en-US', renderTranslation: () => new Element(), setSharedPair() {},
    ...extras.window,
  };
  const context = vm.createContext({
    window, document: { getElementById: element, createElement: () => new Element(), querySelectorAll: () => [] },
    localStorage: { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) },
    location: { hash: '', pathname: '/', origin: 'https://test.local' }, history: { replaceState() {} },
    navigator: {}, crypto: require('node:crypto').webcrypto, URLSearchParams, Blob, URL,
    ...extras,
    window,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js', file), 'utf8'), context);
  return { window, element, events, intervals, context };
}
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };

test('voice transcript waits for an in-flight text translation and preserves the typed draft', async () => {
  let release; const calls = [];
  const result = (text) => ({ sourceLanguage: 'Русский', targetLanguage: 'Английский', original: text, translation: 'Hello', voiceText: 'Hello' });
  const h = harness('translator.js', { window: { Api: {
    translate: async (text) => { calls.push(text); if (calls.length === 1) await new Promise((resolve) => { release = resolve; }); return result(text); },
    speech: async () => new Blob(['audio']),
  } } });
  const first = h.window.submitTranslation('typed message'); await flush();
  h.element('text-input').value = 'unfinished draft';
  const voice = h.window.submitTranslation('voice message');
  assert.equal(calls.length, 1); release(); await Promise.all([first, voice]);
  assert.deepEqual(calls, ['typed message', 'voice message']);
  assert.equal(h.element('text-input').value, 'unfinished draft');
});

test('failed speech generation can be retried and playing audio can be stopped', async () => {
  let calls = 0; let paused = 0;
  class Audio {
    constructor() { this.listeners = {}; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    removeEventListener(name) { delete this.listeners[name]; }
    load() { this.listeners.canplay?.(); }
    async play() {}
    pause() { paused++; }
  }
  const h = harness('translator.js', { Audio, window: { Api: { speech: async () => { if (++calls === 1) throw new Error('provider unavailable'); return new Blob(['audio']); } } } });
  const card = h.window.renderTranslation({ shared: true, original: 'Привет', translation: 'Hello', voiceText: 'Hello', sourceLanguage: 'Русский', targetLanguage: 'Английский' });
  function find(node) { if (node.className === 'play-btn') return node; for (const child of node.children) { const found = find(child); if (found) return found; } }
  const button = find(card); await button.handlers.click(); await button.handlers.click();
  assert.equal(calls, 2); assert.equal(button.disabled, false);
  await button.handlers.click(); assert.equal(paused, 1); assert.equal(button.dataset.loading, 'false');
});

test('microphone startup is serialized and a recording stays stoppable while text is translating', async () => {
  let release; let requests = 0; let stopped = 0; let translated;
  const stream = { getTracks: () => [{ stop: () => { stopped++; } }] };
  class Recorder {
    static isTypeSupported() { return true; }
    constructor() { this.mimeType = 'audio/webm'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable({ data: new Blob(['audio']) }); this.onstop(); }
  }
  const h = harness('voice.js', { MediaRecorder: Recorder, navigator: { mediaDevices: { getUserMedia: async () => { requests++; return new Promise((resolve) => { release = resolve; }); } } },
    window: { MediaRecorder: Recorder, Api: { transcribe: async () => ({ text: 'voice' }) }, submitTranslation: async (text) => { translated = text; } } });
  h.element('mic-btn').handlers.click(); h.element('mic-btn').handlers.click();
  assert.equal(requests, 1); assert.equal(h.window.voiceInProgress(), true);
  release(stream); await flush(); h.window.setVoiceBusy(true);
  assert.equal(h.element('mic-btn').disabled, false);
  h.element('mic-btn').handlers.click(); await flush();
  assert.equal(translated, 'voice'); assert.equal(stopped, 1); assert.equal(h.window.voiceInProgress(), false);
});

test('shared conversation retries a lost response with the same request ID', async () => {
  const requests = []; let fail = true;
  const room = { id: 'room', role: 'host', memberId: 'host', participants: [{ id: 'host' }, { id: 'guest', lastSeen: new Date().toISOString() }] };
  const h = harness('shared.js', { location: { hash: '#room=room', origin: 'https://test.local', pathname: '/' }, window: { Api: {
    sharedRoom: async () => ({ room, messages: [] }),
    sharedSend: async (id, text, requestId) => { requests.push(requestId); if (fail) throw new TypeError('network'); return { message: { id: 1, memberId: 'host', senderName: '1', sourceText: text, status: 'translated', translationText: 'Hello', createdAt: new Date().toISOString() } }; },
  } } });
  await h.events.authenticated(); await flush();
  await assert.rejects(h.window.SharedConversation.send('Привет')); fail = false;
  await h.window.SharedConversation.send('Привет'); assert.equal(requests[0], requests[1]);
});
