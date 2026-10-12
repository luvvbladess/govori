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
    click() { return this.handlers.click?.(); }
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
  for (const script of Array.isArray(file) ? file : [file]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js', script), 'utf8'), context);
  }
  return { window, element, events, intervals, context, values };
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

function groupRoom() {
  return { id: 'group', role: 'guest', memberId: 'spanish', sourceLanguage: 'Испанский', targetLanguage: 'Русский', participants: [
    { id: 'host', language: 'Русский' }, { id: 'english', language: 'Английский' }, { id: 'spanish', language: 'Испанский' },
  ] };
}

test('group viewer waits for their language and polls it instead of displaying another translation', async () => {
  const room = groupRoom(); const cards = []; const polls = [];
  const message = { id: 1, memberId: 'host', senderName: 'Host', sourceText: 'Привет', sourceLanguage: 'Русский',
    targetLanguage: 'Английский', translationText: 'Hello', status: 'translated', createdAt: new Date().toISOString(),
    translations: { Английский: { text: 'Hello', status: 'translated' }, Испанский: { text: null, status: 'pending' } } };
  let ready = false;
  const h = harness('shared.js', { location: { hash: '#room=group', origin: 'https://test.local', pathname: '/' }, window: {
    renderTranslation: (card) => { cards.push(card); return h.element('card'); },
    Api: { sharedRoom: async (id, query) => {
      if (query) polls.push(query);
      return { room, messages: [ready ? { ...message, translations: { ...message.translations, Испанский: { text: 'Hola', status: 'translated' } } } : message] };
    } },
  } });
  await h.events.authenticated({}); await flush();
  assert.equal(cards.length, 0, 'English must not appear as a Spanish translation');
  ready = true; await h.intervals[0]();
  assert.deepEqual(Array.from(polls.at(-1).pending), [1]);
  assert.equal(cards.at(-1).translation, 'Hola');
});

test('group leave waits for server confirmation and removes the room locally only on success', async () => {
  const room = groupRoom(); let release; const calls = [];
  const h = harness('shared.js', { location: { hash: '#room=group', origin: 'https://test.local', pathname: '/' }, window: { Api: {
    sharedRoom: async () => ({ room, messages: [] }),
    sharedLeave: async (id) => { calls.push(id); await new Promise((resolve) => { release = resolve; }); },
  } } });
  await h.events.authenticated({}); await flush();
  const leaving = h.window.SharedConversation.leave();
  assert.deepEqual(calls, ['group']);
  assert.equal(h.window.SharedConversation.active.id, room.id);
  release(); await leaving;
  assert.equal(h.window.SharedConversation.active, null);
  assert.equal(h.values.get('shared-room'), undefined);
});

test('failed group leave retains membership and can be retried without an unhandled rejection', async () => {
  const room = groupRoom(); let fail = true; let errors = 0; let calls = 0;
  const h = harness('shared.js', { location: { hash: '#room=group', origin: 'https://test.local', pathname: '/' }, window: {
    showVoiceStatus: (message, isError) => { if (isError) errors++; },
    Api: { sharedRoom: async () => ({ room, messages: [] }), sharedLeave: async () => { calls++; if (fail) throw new TypeError('offline'); } },
  } });
  await h.events.authenticated({}); await flush();
  await h.element('shared-leave').click();
  assert.equal(h.window.SharedConversation.active.id, room.id);
  assert.equal(errors, 1); assert.equal(h.element('shared-leave').disabled, false);
  fail = false; await h.element('shared-leave').click();
  assert.equal(h.window.SharedConversation.active, null); assert.equal(calls, 2);
});

test('opening a personal conversation does not leave group membership', async () => {
  const room = groupRoom(); let leaves = 0;
  const h = harness(['translator.js', 'shared.js'], { location: { hash: '#room=group', origin: 'https://test.local', pathname: '/' }, window: { Api: {
    sharedRoom: async () => ({ room, messages: [] }), sharedLeave: async () => { leaves++; },
  } } });
  await h.events.authenticated({}); await flush();
  await h.element('new-conversation-btn').click();
  assert.equal(h.window.SharedConversation.active, null);
  assert.equal(leaves, 0);
  assert.equal(h.window.getSourceLanguage(), 'Русский'); assert.equal(h.window.getTargetLanguage(), 'Английский');
});

test('live speaking follows voice activity, renews while talking and clears on silence and disconnect', async () => {
  const updates = []; const room = groupRoom(); let channel; let connection;
  class Channel {
    constructor() { this.handlers = {}; channel = this; }
    addEventListener(name, handler) { this.handlers[name] = handler; }
    close() {}
    event(type) { this.handlers.message({ data: JSON.stringify({ type }) }); }
  }
  class Connection {
    constructor() { this.handlers = {}; connection = this; }
    createDataChannel() { return new Channel(); }
    addTrack() {}
    addEventListener(name, handler) { this.handlers[name] = handler; }
    async createOffer() { return { sdp: 'offer' }; }
    async setLocalDescription() {}
    async setRemoteDescription() {}
    close() {}
  }
  const h = harness(['shared.js', 'voice.js'], {
    location: { hash: '#room=group', origin: 'https://test.local', pathname: '/' }, RTCPeerConnection: Connection,
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } },
    window: { RTCPeerConnection: Connection, accessState: { authenticated: true }, Api: {
      sharedRoom: async () => ({ room, messages: [] }), liveSession: async () => ({ sdp: 'answer' }),
      sharedSpeaking: async (id, speaking) => { updates.push([id, speaking]); },
    } },
  });
  await flush(); await h.element('live-mode-btn').click(); h.element('mic-btn').click(); await flush();
  assert.equal(updates.length, 0, 'an open but silent microphone is not speaking');
  channel.event('input_audio_buffer.speech_started'); await flush();
  assert.deepEqual(updates.at(-1), ['group', true]);
  assert.equal(h.element('shared-speaking').hidden, false);
  await h.intervals.at(-1)(); await flush();
  assert.deepEqual(updates.slice(-2), [['group', true], ['group', true]]);
  channel.event('input_audio_buffer.speech_stopped'); await flush();
  assert.deepEqual(updates.at(-1), ['group', false]);
  assert.equal(h.element('shared-speaking').hidden, true);
  channel.event('input_audio_buffer.speech_started'); await flush();
  connection.connectionState = 'disconnected'; connection.handlers.connectionstatechange(); await flush();
  assert.deepEqual(updates.at(-1), ['group', false]);
  assert.equal(h.element('shared-speaking').hidden, true);
});

test('group speaking UI identifies remote speakers and clears expired status on the next poll', async () => {
  const room = groupRoom(); let talking = true;
  const h = harness('shared.js', { location: { hash: '#room=group', origin: 'https://test.local', pathname: '/' }, window: {
    Api: { sharedRoom: async () => ({ room: { ...room, participants: room.participants.map(member => ({ ...member, name: member.id === 'host' ? 'Alice' : member.id, speaking: member.id === 'host' && talking })) }, messages: [] }) },
  } });
  await h.events.authenticated({}); await flush();
  assert.equal(h.element('shared-speaking').hidden, false);
  assert.match(h.element('shared-speaking').textContent, /Alice/);
  talking = false; await h.intervals[0]();
  assert.equal(h.element('shared-speaking').hidden, true);
});

test('slow speaking heartbeat is coalesced and stale starts do not extend speech after stopping', async () => {
  const room = groupRoom(); const updates = []; let release;
  const h = harness('shared.js', { location: { hash: '#room=group', origin: 'https://test.local', pathname: '/' }, window: { Api: {
    sharedRoom: async () => ({ room, messages: [] }),
    sharedSpeaking: async (id, speaking) => { updates.push(speaking); if (updates.length === 1) await new Promise(resolve => { release = resolve; }); },
  } } });
  await h.events.authenticated({}); await flush();
  h.window.SharedConversation.setSpeaking(true); await flush();
  for (let i = 0; i < 8; i++) h.intervals.at(-1)();
  const stopping = h.window.SharedConversation.setSpeaking(false);
  release(); await stopping; await flush();
  assert.deepEqual(updates, [true, false]);
});

test('sending a newer group message does not skip an earlier unread incoming message', async () => {
  const room = groupRoom(); const cards = []; const polls = []; let messages = [];
  const incoming = { id: 1, memberId: 'host', senderName: 'Host', sourceText: 'Привет', sourceLanguage: 'Русский',
    targetLanguage: 'Английский', translationText: 'Hello', status: 'translated', createdAt: new Date().toISOString(),
    translations: { Испанский: { text: 'Hola', status: 'translated' } } };
  const outgoing = { ...incoming, id: 2, memberId: 'spanish', sourceLanguage: 'Испанский', sourceText: 'Hola', targetLanguage: 'Русский', translationText: 'Привет' };
  const h = harness('shared.js', { location: { hash: '#room=group', origin: 'https://test.local', pathname: '/' }, window: {
    renderTranslation: (card) => { cards.push(card); return h.element(`card-${cards.length}`); },
    Api: {
      sharedRoom: async (id, query) => { if (query) polls.push(query); return { room, messages: messages.filter(message => message.id > (query?.after || 0)) }; },
      sharedSend: async () => { messages = [incoming, outgoing]; return { message: outgoing }; },
    },
  } });
  await h.events.authenticated({}); await flush();
  await h.window.SharedConversation.send('Hola'); await flush();
  assert.equal(polls.at(-1).after, 0, 'only received history advances the polling cursor');
  assert.equal(cards.length, 2);
  assert.ok(cards.some(card => card.original === 'Привет'));
});

test('speech voice selection loads available voices, validates saved value and persists changes', async () => {
  const storage = new Map([['speech-voice', 'invalid']]); let stopped = 0;
  const h = harness('speech-settings.js', {
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    window: { accessState: { authenticated: true }, stopSpeech: () => { stopped++; }, Api: { voices: async () => ({ voices: [{ id: 'marin', name: 'Marin' }, { id: 'cedar', name: 'Cedar' }], defaultVoice: 'marin' }) } },
  });
  await flush();
  assert.equal(h.window.getSpeechVoice(), 'marin');
  await h.element('speech-settings-open').click(); assert.equal(h.element('speech-settings-dialog').open, true);
  h.element('speech-voice').value = 'cedar'; await h.element('speech-voice').handlers.change();
  assert.equal(h.window.getSpeechVoice(), 'cedar'); assert.equal(storage.get('speech-voice'), 'cedar'); assert.equal(stopped, 1);
});

test('changing speech voice regenerates an existing card instead of replaying old audio', async () => {
  const voices = []; let selected = 'marin';
  class Audio {
    constructor() { this.listeners = {}; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    removeEventListener(name) { delete this.listeners[name]; }
    load() { this.listeners.canplay?.(); }
    async play() {}
    pause() {}
  }
  const h = harness('translator.js', { Audio, window: { getSpeechVoice: () => selected, Api: { speech: async (text, language, voice) => { voices.push(voice); return new Blob([voice]); } } } });
  const card = h.window.renderTranslation({ shared: true, original: 'Привет', translation: 'Hello', voiceText: 'Hello', sourceLanguage: 'Русский', targetLanguage: 'Английский' });
  function find(node) { if (node.className === 'play-btn') return node; for (const child of node.children) { const found = find(child); if (found) return found; } }
  const button = find(card); await button.click(); h.window.stopSpeech();
  selected = 'cedar'; await button.click(); h.window.stopSpeech();
  selected = 'marin'; await button.click();
  assert.deepEqual(voices, ['marin', 'cedar']);
});

test('switching voice while speech is loading prevents stale voice playback', async () => {
  let release; let selected = 'marin'; let plays = 0;
  class Audio {
    constructor() { this.listeners = {}; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    removeEventListener(name) { delete this.listeners[name]; }
    load() { this.listeners.canplay?.(); }
    async play() { plays++; }
    pause() {}
  }
  const h = harness('translator.js', { Audio, window: { getSpeechVoice: () => selected, Api: { speech: async () => new Promise(resolve => { release = resolve; }) } } });
  const card = h.window.renderTranslation({ shared: true, original: 'Привет', translation: 'Hello', voiceText: 'Hello', sourceLanguage: 'Русский', targetLanguage: 'Английский' });
  function find(node) { if (node.className === 'play-btn') return node; for (const child of node.children) { const found = find(child); if (found) return found; } }
  const loading = find(card).click(); await flush(); selected = 'cedar'; h.window.stopSpeech(); release(new Blob(['marin'])); await loading;
  assert.equal(plays, 0);
});

test('a canceled speech request cannot unlock or erase newer playback', async () => {
  let release; let selected = 'marin'; let plays = 0;
  class Audio {
    constructor() { this.listeners = {}; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    removeEventListener(name) { delete this.listeners[name]; }
    load() { this.listeners.canplay?.(); }
    async play() { plays++; }
    pause() {}
  }
  const h = harness('translator.js', { Audio, window: { getSpeechVoice: () => selected, Api: { speech: async (text) => text === 'old' ? new Promise(resolve => { release = resolve; }) : new Blob([text]) } } });
  const card = text => h.window.renderTranslation({ shared: true, original: text, translation: text, voiceText: text, sourceLanguage: 'Русский', targetLanguage: 'Английский' });
  function find(node) { if (node.className === 'play-btn') return node; for (const child of node.children) { const found = find(child); if (found) return found; } }
  const first = find(card('old')); const loading = first.click(); await flush();
  selected = 'cedar'; h.window.stopSpeech();
  const second = find(card('new')); await second.click();
  release(new Blob(['old'])); await loading;
  await find(card('third')).click();
  assert.equal(plays, 1, 'new playback retains ownership after canceled request settles');
  assert.equal(first.dataset.loading, 'false');
});
