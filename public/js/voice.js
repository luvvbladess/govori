(() => {
  const micBtn = document.getElementById('mic-btn');
  const status = document.getElementById('voice-status');
  const hint = document.getElementById('voice-hint');
  const liveButton = document.getElementById('live-mode-btn');
  const liveTranscript = document.getElementById('live-transcript');
  const SEGMENT_MS = 30 * 1000;
  let recorder; let regularSession = null; let busy = false; let starting = false;
  let liveEnabled = localStorage.getItem('live-mode') === 'true';
  let liveSession = null; let liveStopping = false; let liveStopTimer = null; const liveParts = new Map();

  window.voiceInProgress = () => Boolean(regularSession || liveSession || busy || starting);
  function showVoiceStatus(message, isError = false) { status.textContent = message; status.classList.toggle('is-error', isError); }
  window.showVoiceStatus = showVoiceStatus;
  window.setVoiceBusy = (value, message = window.t('voice.ready')) => {
    busy = value;
    // A live session stays interruptible even while its previous phrase is translating.
    if (!liveSession && !regularSession) micBtn.disabled = value;
    if (!value && !recorder && !liveSession) showVoiceStatus(message);
  };
  function setLiveTranscript(text = '') { liveTranscript.textContent = text; liveTranscript.hidden = !text; }
  function setRecording(value, mode = 'regular') {
    micBtn.classList.toggle('recording', value);
    micBtn.setAttribute('aria-pressed', String(value));
    micBtn.setAttribute('aria-label', window.t(value ? 'voice.stop' : 'voice.start'));
    micBtn.querySelector('.mic-label').textContent = window.t(value ? 'voice.done' : 'voice.speak');
    hint.textContent = window.t(value && mode === 'live' ? 'live.hint' : value ? 'voice.hintRecording' : 'voice.hint');
    showVoiceStatus(window.t(value ? mode === 'live' ? 'live.listening' : 'voice.listening' : 'voice.processing'));
  }
  function renderLiveToggle() {
    liveButton.setAttribute('aria-pressed', String(liveEnabled));
    liveButton.setAttribute('aria-label', window.t(liveEnabled ? 'live.disable' : 'live.toggle'));
  }
  function setLiveEnabled(value) {
    if (liveSession || regularSession || starting || busy) return;
    liveEnabled = value; localStorage.setItem('live-mode', String(value)); renderLiveToggle();
    showVoiceStatus(window.t(value ? 'live.on' : 'live.off'));
    hint.textContent = window.t(value ? 'live.hint' : 'voice.hint');
  }

  function recorderOptions() {
    return MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? { mimeType: 'audio/webm;codecs=opus' } : undefined;
  }

  async function transcribeSegment(blob, language) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { return await window.Api.transcribe(blob, language); }
      catch (error) {
        lastError = error;
        if (['TRIAL_LIMIT_REACHED', 'VOICE_LANGUAGE_MISMATCH'].includes(error.code)) break;
        if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 450 * (attempt + 1)));
      }
    }
    throw lastError;
  }

  function queueSegment(session, blob, index) {
    session.queue = session.queue.then(async () => {
      try {
        const result = await transcribeSegment(blob, session.language);
        if (result.text) session.transcripts[index] = result.text;
      } catch (error) {
        session.errors[index] = error;
      }
      session.completed += 1;
      if (!session.stopping) showVoiceStatus(window.t('voice.listeningSaved').replace('{count}', session.completed));
    });
  }

  async function finalizeRegular(session) {
    if (session.finalizing) return;
    session.finalizing = true;
    window.clearTimeout(session.timer);
    session.stream.getTracks().forEach((track) => track.stop());
    regularSession = null; recorder = null; setRecording(false); busy = true; micBtn.disabled = true;
    showVoiceStatus(window.t('voice.finalizing'));
    try {
      await session.queue;
      const transcript = session.transcripts.filter(Boolean).join(' ').trim();
      if (!transcript) throw session.errors.find(Boolean) || new Error(window.t('voice.emptyLong'));
      if (session.errors.some(Boolean)) showVoiceStatus(window.t('voice.partialTranscript'));
      else showVoiceStatus(window.t('voice.translating'));
      await window.submitTranslation(transcript);
    } catch (error) {
      if (error.code === 'TRIAL_LIMIT_REACHED') window.showTrialLimit?.();
      showVoiceStatus(window.errorMessage(error, 'voice.emptyLong'), true);
    } finally {
      busy = false; micBtn.disabled = false;
    }
  }

  function startRegularSegment(session) {
    if (session.stopping) return;
    const index = session.nextIndex; session.nextIndex += 1;
    const segmentChunks = [];
    const current = new MediaRecorder(session.stream, recorderOptions());
    recorder = current; session.recorder = current;
    current.ondataavailable = (event) => { if (event.data.size) segmentChunks.push(event.data); };
    current.onstop = () => {
      window.clearTimeout(session.timer);
      const blob = new Blob(segmentChunks, { type: current.mimeType || 'audio/webm' });
      if (blob.size) queueSegment(session, blob, index);
      if (session.stopping) finalizeRegular(session);
      else startRegularSegment(session);
    };
    current.start();
    session.timer = window.setTimeout(() => { if (current.state === 'recording') current.stop(); }, SEGMENT_MS);
  }

  async function startRegular() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { showVoiceStatus(window.t('voice.unsupported'), true); return; }
    if (starting) return; starting = true; micBtn.disabled = true;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      regularSession = { stream, language: window.getSourceLanguage?.(), queue: Promise.resolve(), transcripts: [], errors: [], nextIndex: 0, completed: 0, stopping: false, finalizing: false, timer: null, recorder: null };
      startRegularSegment(regularSession); setRecording(true);
    } catch (error) { stream?.getTracks().forEach((track) => track.stop()); regularSession = null; recorder = null; showVoiceStatus(window.errorMessage(error, 'voice.denied'), true); }
    finally { starting = false; micBtn.disabled = false; }
  }

  function stopRegular() {
    const session = regularSession;
    if (!session || session.stopping) return;
    session.stopping = true; window.clearTimeout(session.timer);
    showVoiceStatus(window.t('voice.finalizing'));
    if (session.recorder?.state === 'recording') session.recorder.stop();
    else finalizeRegular(session);
  }

  async function submitLiveTranscript(text) {
    const transcript = text.trim();
    if (!transcript) return;
    setLiveTranscript(transcript); showVoiceStatus(window.t('voice.translating'));
    try { await window.submitLiveTranslation(transcript); }
    catch (error) { showVoiceStatus(window.errorMessage(error), true); }
    finally {
      if (liveSession && !liveStopping) { setLiveTranscript(''); showVoiceStatus(window.t('live.listening')); }
    }
  }
  function handleLiveEvent(event) {
    let data; try { data = JSON.parse(event.data); } catch { return; }
    const type = data.type || ''; const id = data.item_id || data.content_index || 'active';
    if (type.endsWith('.delta') && typeof data.delta === 'string') {
      liveParts.set(id, `${liveParts.get(id) || ''}${data.delta}`); setLiveTranscript(liveParts.get(id)); return;
    }
    if (type.endsWith('.completed') && typeof data.transcript === 'string') {
      const text = data.transcript; liveParts.delete(id); submitLiveTranscript(text); if (liveStopping) window.setTimeout(closeLiveSession, 120); return;
    }
    if (type === 'error') showVoiceStatus(window.errorMessage({ code: 'LIVE_UNAVAILABLE' }), true);
  }
  function closeLiveSession() {
    const session = liveSession; if (!session) return;
    liveSession = null; liveStopping = false; window.clearTimeout(liveStopTimer); liveStopTimer = null; liveParts.clear();
    session.stream.getTracks().forEach((track) => track.stop()); session.channel.close(); session.connection.close();
    setLiveTranscript(''); setRecording(false); micBtn.disabled = false;
    // setRecording(false) is shared with the legacy recorder and therefore
    // announces its processing state. A live session is already closed here.
    hint.textContent = window.t(liveEnabled ? 'live.hint' : 'voice.hint');
    showVoiceStatus(window.t('voice.ready'));
  }
  async function startLive() {
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) { showVoiceStatus(window.t('voice.unsupported'), true); return; }
    if (starting) return; starting = true; micBtn.disabled = true;
    showVoiceStatus(window.t('live.connecting'));
    let stream; let connection; let channel;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      connection = new RTCPeerConnection(); channel = connection.createDataChannel('oai-events');
      stream.getTracks().forEach((track) => connection.addTrack(track, stream));
      channel.addEventListener('message', handleLiveEvent);
      connection.addEventListener('connectionstatechange', () => {
        if (liveSession?.connection === connection && ['failed', 'disconnected'].includes(connection.connectionState)) {
          closeLiveSession(); showVoiceStatus(window.t('live.unavailable'), true);
        }
      });
      const offer = await connection.createOffer(); await connection.setLocalDescription(offer);
      const answer = await window.Api.liveSession(offer.sdp);
      await connection.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
      liveSession = { connection, channel, stream }; setRecording(true, 'live');
    } catch (error) {
      if (liveSession?.connection === connection) closeLiveSession();
      else { stream?.getTracks().forEach((track) => track.stop()); channel?.close(); connection?.close(); }
      showVoiceStatus(window.errorMessage(error, 'live.unavailable'), true);
    } finally { starting = false; micBtn.disabled = false; }
  }
  function stopLive() {
    // Stop accepting a new phrase but leave the connection open long enough
    // for server-side VAD to finalize the last spoken words.
    if (liveStopping) return;
    liveStopping = true; micBtn.disabled = true;
    showVoiceStatus(window.t('live.processing'));
    liveSession.stream.getTracks().forEach((track) => track.stop());
    liveStopTimer = window.setTimeout(() => { if (liveSession) closeLiveSession(); }, 4000);
  }

  liveButton.addEventListener('click', () => { if (!window.accessState?.authenticated && !window.SharedConversation?.active) { window.showAuth?.('register', 'trial.live'); return; } setLiveEnabled(!liveEnabled); });
  micBtn.addEventListener('click', () => {
    if (liveSession) { stopLive(); return; }
    if (regularSession) { stopRegular(); return; }
    if (busy || starting) return;
    if (liveEnabled) startLive(); else startRegular();
  });
  window.addEventListener('localechange', () => {
    renderLiveToggle();
    hint.textContent = window.t(liveSession ? 'live.hint' : recorder?.state === 'recording' ? 'voice.hintRecording' : liveEnabled ? 'live.hint' : 'voice.hint');
    if (liveSession) showVoiceStatus(window.t(liveStopping ? 'live.processing' : 'live.listening'));
  });
  window.addEventListener('authenticated', () => { if (!window.voiceInProgress()) showVoiceStatus(window.t('voice.ready')); });
  renderLiveToggle(); if (liveEnabled) hint.textContent = window.t('live.hint');
})();
