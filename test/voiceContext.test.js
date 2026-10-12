const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function harness(scripts, extras = {}) {
  class Element {
    constructor() { this.children = []; this.handlers = {}; this.dataset = {}; this.value = ''; this.classList = { add() {}, toggle() {}, remove() {} }; }
    addEventListener(name, handler) { this.handlers[name] = handler; }
    setAttribute() {}
    append(...children) { this.children.push(...children); }
    prepend(child) { this.children.unshift(child); }
    replaceChild(next, old) { this.children[this.children.indexOf(old)] = next; }
    querySelector() { return new Element(); }
    remove() {}
    click() { return this.handlers.click?.(); }
  }
  const elements = new Map(); const events = {}; const timers = [];
  const element = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const window = {
    t: key => key, errorMessage: () => 'error', addEventListener: (name, callback) => { events[name] = callback; },
    setTimeout: (callback, delay) => { if (delay < 100) return setTimeout(callback, delay); timers.push(callback); return 0; }, clearTimeout,
    getSourceLanguage: () => 'Русский', SharedConversation: { active: { id: 'room-a' }, setSpeaking() {} },
    ...extras.window,
  };
  const context = vm.createContext({
    window, document: { getElementById: element, createElement: () => new Element(), querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem() {} }, navigator: {}, Blob, URL,
    ...extras, window,
  });
  for (const script of scripts) vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js', script), 'utf8'), context);
  return { window, element, events, timers };
}
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

function microphone() {
  const state = { stopped: 0, recorders: [] };
  state.stream = { getTracks: () => [{ stop: () => { state.stopped++; } }] };
  state.Recorder = class {
    static isTypeSupported() { return true; }
    constructor() { this.mimeType = 'audio/webm'; state.recorders.push(this); }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['audio']) }); this.onstop?.(); }
  };
  return state;
}

test('revoking a group during regular transcription cannot submit to a personal conversation', async () => {
  const mic = microphone(); let release; const submitted = []; const routes = [];
  const h = harness(['voice.js'], { MediaRecorder: mic.Recorder,
    navigator: { mediaDevices: { getUserMedia: async () => mic.stream } },
    window: { MediaRecorder: mic.Recorder, Api: { transcribe: async (_blob, _language, roomId) => {
      routes.push(roomId); return new Promise(resolve => { release = resolve; });
    } }, submitTranslation: async (...args) => { submitted.push(args); } },
  });
  h.element('mic-btn').click(); await flush(); h.element('mic-btn').click(); await flush();
  h.window.SharedConversation.active = null;
  h.window.cancelVoiceInput?.(); release({ text: 'private group speech' }); await flush();
  assert.deepEqual(submitted, []);
  assert.deepEqual(routes, ['room-a']);
  assert.equal(h.window.voiceInProgress(), false);
  assert.ok(mic.stopped > 0);
});

test('canceling an active regular recorder stops tracks and never restarts a segment', async () => {
  const mic = microphone(); let transcribed = 0;
  const h = harness(['voice.js'], { MediaRecorder: mic.Recorder,
    navigator: { mediaDevices: { getUserMedia: async () => mic.stream } },
    window: { MediaRecorder: mic.Recorder, Api: { transcribe: async () => { transcribed++; return { text: 'speech' }; } } },
  });
  h.element('mic-btn').click(); await flush(); h.window.cancelVoiceInput?.(); await flush();
  assert.equal(mic.recorders.length, 1);
  assert.equal(mic.recorders[0].state, 'inactive');
  assert.equal(transcribed, 0);
  assert.equal(h.window.voiceInProgress(), false);
  assert.ok(mic.stopped > 0);
});

test('a pending microphone permission cannot restart recording after cancellation', async () => {
  const mic = microphone(); let release;
  const h = harness(['voice.js'], { MediaRecorder: mic.Recorder,
    navigator: { mediaDevices: { getUserMedia: async () => new Promise(resolve => { release = resolve; }) } },
    window: { MediaRecorder: mic.Recorder },
  });
  h.element('mic-btn').click(); h.window.cancelVoiceInput?.(); release(mic.stream); await flush();
  assert.equal(mic.recorders.length, 0);
  assert.ok(mic.stopped > 0);
  assert.equal(h.window.voiceInProgress(), false);
});

test('voice API routes stay attached to the originating room rather than the current screen', async () => {
  const routes = [];
  const h = harness(['api.js'], { fetch: async route => { routes.push(route); return { ok: true, json: async () => ({}) }; } });
  h.window.SharedConversation.active = null;
  await h.window.Api.transcribe(new Blob(['audio']), 'Русский', 'room-a');
  await h.window.Api.liveSession('offer', 'room-a');
  h.window.SharedConversation.active = { id: 'room-b' };
  await h.window.Api.transcribe(new Blob(['audio']), 'Русский', null);
  await h.window.Api.liveSession('offer', null);
  assert.deepEqual(routes, ['/api/shared/room-a/transcribe', '/api/shared/room-a/live/session', '/api/translator/transcribe?language=%D0%A0%D1%83%D1%81%D1%81%D0%BA%D0%B8%D0%B9', '/api/translator/live/session']);
});

test('queued live speech is discarded when its room changes during another send', async () => {
  let release; let personal = 0; const sent = [];
  const h = harness(['translator.js'], { window: { Api: { translate: async () => { personal++; } }, SharedConversation: {
    active: { id: 'room-a' }, send: async text => { sent.push(text); await new Promise(resolve => { release = resolve; }); },
  } } });
  const first = h.window.submitTranslation('first', { roomId: 'room-a' }); await flush();
  const queued = h.window.submitLiveTranslation('queued secret', { roomId: 'room-a' });
  const rejected = assert.rejects(queued, error => error.name === 'AbortError');
  h.window.SharedConversation.active = null; release(); await first; await rejected;
  assert.equal(personal, 0); assert.deepEqual(sent, ['first']);
});

test('live cancellation closes all resources and ignores stale channel events', async () => {
  const mic = microphone(); let channel; let connection; const submitted = [];
  class Connection {
    constructor() { connection = this; this.closed = false; }
    createDataChannel() { channel = { handlers: {}, closed: false, addEventListener(name, handler) { this.handlers[name] = handler; }, close() { this.closed = true; } }; return channel; }
    addTrack() {}
    addEventListener() {}
    async createOffer() { return { sdp: 'offer' }; }
    async setLocalDescription() {}
    async setRemoteDescription() {}
    close() { this.closed = true; }
  }
  const h = harness(['voice.js'], { RTCPeerConnection: Connection,
    navigator: { mediaDevices: { getUserMedia: async () => mic.stream } },
    window: { RTCPeerConnection: Connection, Api: { liveSession: async () => ({ sdp: 'answer' }) }, submitLiveTranslation: async (...args) => { submitted.push(args); } },
  });
  h.element('live-mode-btn').click(); h.element('mic-btn').click(); await flush();
  h.window.cancelVoiceInput?.(); h.window.SharedConversation.active = null;
  channel.handlers.message({ data: JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'group speech' }) }); await flush();
  assert.deepEqual(submitted, []); assert.equal(channel.closed, true); assert.equal(connection.closed, true);
  assert.ok(mic.stopped > 0); assert.equal(h.window.voiceInProgress(), false);
});

test('live startup cannot publish an answer or keep resources after cancellation during negotiation', async () => {
  const mic = microphone(); let release; let channel; let connection; const routes = [];
  class Connection {
    constructor() { connection = this; this.closed = false; this.remote = false; }
    createDataChannel() { channel = { closed: false, addEventListener() {}, close() { this.closed = true; } }; return channel; }
    addTrack() {}
    addEventListener() {}
    async createOffer() { return { sdp: 'offer' }; }
    async setLocalDescription() {}
    async setRemoteDescription() { this.remote = true; }
    close() { this.closed = true; }
  }
  const h = harness(['voice.js'], { RTCPeerConnection: Connection,
    navigator: { mediaDevices: { getUserMedia: async () => mic.stream } },
    window: { RTCPeerConnection: Connection, Api: { liveSession: async (_sdp, roomId) => {
      routes.push(roomId); return new Promise(resolve => { release = resolve; });
    } } },
  });
  h.element('live-mode-btn').click(); h.element('mic-btn').click(); await flush();
  h.window.cancelVoiceInput();
  assert.equal(connection.closed, true); assert.equal(channel.closed, true); assert.ok(mic.stopped > 0);
  h.window.SharedConversation.active = null; release({ sdp: 'answer' }); await flush();
  assert.equal(connection.remote, false); assert.deepEqual(routes, ['room-a']); assert.equal(h.window.voiceInProgress(), false);
});

test('canceling queued speech discards it even when the same room is reopened', async () => {
  let release; let current = true; const sent = [];
  const h = harness(['translator.js'], { window: { SharedConversation: { active: { id: 'room-a' },
    send: async text => { sent.push(text); await new Promise(resolve => { release = resolve; }); },
  } } });
  const first = h.window.submitTranslation('first'); await flush();
  const queued = h.window.submitLiveTranslation('old recording', { roomId: 'room-a', isCurrent: () => current });
  const rejected = assert.rejects(queued, error => error.name === 'AbortError');
  current = false; h.window.cancelVoiceTranslations(); await rejected; release(); await first; await flush();
  assert.deepEqual(sent, ['first']);
});

test('pagehide cancels regular recording without transcribing or submitting audio', async () => {
  const mic = microphone(); let calls = 0;
  const h = harness(['voice.js'], { MediaRecorder: mic.Recorder,
    navigator: { mediaDevices: { getUserMedia: async () => mic.stream } },
    window: { MediaRecorder: mic.Recorder, Api: { transcribe: async () => { calls++; } }, submitTranslation: async () => { calls++; } },
  });
  h.element('mic-btn').click(); await flush(); h.events.pagehide(); await flush();
  assert.equal(mic.recorders[0].state, 'inactive'); assert.equal(calls, 0); assert.ok(mic.stopped > 0);
});

test('visible cancel button discards a regular recording while it is finalizing', async () => {
  const mic = microphone(); let release; const submissions = []; const speaking = [];
  const h = harness(['voice.js'], { MediaRecorder: mic.Recorder,
    navigator: { mediaDevices: { getUserMedia: async () => mic.stream } },
    window: { MediaRecorder: mic.Recorder, SharedConversation: { active: { id: 'room-a' }, setSpeaking: value => speaking.push(value) },
      Api: { transcribe: async () => new Promise(resolve => { release = resolve; }) },
      submitTranslation: async text => submissions.push(text),
    },
  });
  assert.equal(h.element('voice-cancel').hidden, true);
  h.element('mic-btn').click(); await flush();
  assert.equal(h.element('voice-cancel').hidden, false);
  h.element('mic-btn').click(); await flush();
  assert.equal(h.element('voice-cancel').hidden, false);
  h.element('voice-cancel').click(); release({ text: 'discard this recording' }); await flush();
  assert.deepEqual(submissions, []); assert.equal(h.window.voiceInProgress(), false);
  assert.equal(h.element('voice-cancel').hidden, true); assert.equal(h.element('voice-status').textContent, 'voice.canceled');
  assert.equal(speaking.at(-1), false);
});

test('cancel button is available during microphone permission and disappears after cancellation', async () => {
  const mic = microphone(); let release;
  const h = harness(['voice.js'], { MediaRecorder: mic.Recorder,
    navigator: { mediaDevices: { getUserMedia: async () => new Promise(resolve => { release = resolve; }) } },
    window: { MediaRecorder: mic.Recorder },
  });
  h.element('mic-btn').click(); assert.equal(h.element('voice-cancel').hidden, false);
  h.element('voice-cancel').click(); assert.equal(h.element('voice-cancel').hidden, true);
  release(mic.stream); await flush(); assert.equal(mic.recorders.length, 0); assert.ok(mic.stopped > 0);
});

test('normal recording completion hides cancel and text-only translation never shows it', async () => {
  const mic = microphone(); const submissions = [];
  const h = harness(['voice.js'], { MediaRecorder: mic.Recorder,
    navigator: { mediaDevices: { getUserMedia: async () => mic.stream } },
    window: { MediaRecorder: mic.Recorder, Api: { transcribe: async () => ({ text: 'send this recording' }) },
      submitTranslation: async text => submissions.push(text),
    },
  });
  h.window.setVoiceBusy(true); assert.equal(h.element('voice-cancel').hidden, true); h.window.setVoiceBusy(false);
  h.element('mic-btn').click(); await flush(); h.element('mic-btn').click(); await flush();
  assert.deepEqual(submissions, ['send this recording']); assert.equal(h.element('voice-cancel').hidden, true);
});

test('cancel stays available for queued live phrases after the microphone closes', async () => {
  const mic = microphone(); let channel; let queuedContext; let release; let queueCanceled = false;
  class Connection {
    createDataChannel() { channel = { handlers: {}, addEventListener(name, callback) { this.handlers[name] = callback; }, close() {} }; return channel; }
    addTrack() {}
    addEventListener() {}
    async createOffer() { return { sdp: 'offer' }; }
    async setLocalDescription() {}
    async setRemoteDescription() {}
    close() {}
  }
  const h = harness(['voice.js'], { RTCPeerConnection: Connection,
    navigator: { mediaDevices: { getUserMedia: async () => mic.stream } },
    window: { RTCPeerConnection: Connection, Api: { liveSession: async () => ({ sdp: 'answer' }) },
      submitLiveTranslation: async (_text, options) => { queuedContext = options; await new Promise(resolve => { release = resolve; }); },
      cancelVoiceTranslations: () => { queueCanceled = true; },
    },
  });
  h.element('live-mode-btn').click(); h.element('mic-btn').click(); await flush();
  assert.equal(h.element('voice-cancel').hidden, false);
  channel.handlers.message({ data: JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'queued phrase' }) });
  channel.handlers.close(); await flush();
  assert.equal(h.element('voice-cancel').hidden, false);
  h.element('voice-cancel').click(); release(); await flush();
  assert.equal(queueCanceled, true); assert.equal(queuedContext.isCurrent(), false);
  assert.equal(h.element('voice-cancel').hidden, true); assert.equal(h.element('voice-status').textContent, 'voice.canceled');
});
