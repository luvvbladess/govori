(() => {
  const micBtn = document.getElementById('mic-btn');
  const status = document.getElementById('voice-status');
  const hint = document.getElementById('voice-hint');
  const liveButton = document.getElementById('live-mode-btn');
  const liveTranscript = document.getElementById('live-transcript');
  const cancelButton = document.getElementById('voice-cancel');
  const SEGMENT_MS = 30 * 1000;
  let recorder; let regularSession = null; let busy = false; let starting = false;
  let liveEnabled = localStorage.getItem('live-mode') === 'true';
  let liveSession = null; let liveStopping = false; let liveStopTimer = null; const liveParts = new Map();
  let generation = 0; let finalizingSession = null; let startupResources = null; let pendingLiveTranscripts = 0;
  function renderCancelButton() { cancelButton.hidden = !Boolean(starting || regularSession || finalizingSession || liveSession || pendingLiveTranscripts); }
  function captureContext() { return { generation, roomId: window.SharedConversation?.active?.id || null }; }
  function contextValid(context) { return context.generation === generation && context.roomId === (window.SharedConversation?.active?.id || null); }
  function submissionOptions(context) { return { roomId: context.roomId, isCurrent: () => contextValid(context) }; }
  function stopStream(stream) { stream?.getTracks().forEach(track => track.stop()); }
  window.cancelVoiceInput = () => {
    window.SharedConversation?.setSpeaking?.(false);
    generation += 1;
    const session = regularSession || finalizingSession;
    regularSession = null; finalizingSession = null; recorder = null;
    if (session) { window.clearTimeout(session.timer); stopStream(session.stream); if (session.recorder?.state === 'recording') session.recorder.stop(); }
    closeLiveSession();
    stopStream(startupResources?.stream); startupResources?.channel?.close(); startupResources?.connection?.close(); startupResources = null;
    window.cancelVoiceTranslations?.();
    starting = false; busy = false; pendingLiveTranscripts = 0; setLiveTranscript(''); setRecording(false); micBtn.disabled = false;
    showVoiceStatus(window.t('voice.ready'));
  };

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
    renderCancelButton();
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

  async function transcribeSegment(blob, language, context) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!contextValid(context)) return {};
      try { return await window.Api.transcribe(blob, language, context.roomId); }
      catch (error) {
        lastError = error;
        if (!contextValid(context) || ['TRIAL_LIMIT_REACHED', 'VOICE_LANGUAGE_MISMATCH'].includes(error.code)) break;
        if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 450 * (attempt + 1)));
      }
    }
    throw lastError;
  }

  function queueSegment(session, blob, index) {
    session.queue = session.queue.then(async () => {
      if (!contextValid(session.context)) return;
      try {
        const result = await transcribeSegment(blob, session.language, session.context);
        if (result.text) session.transcripts[index] = result.text;
      } catch (error) {
        session.errors[index] = error;
      }
      session.completed += 1;
      if (!session.stopping && contextValid(session.context)) showVoiceStatus(window.t('voice.listeningSaved').replace('{count}', session.completed));
    });
  }

  async function finalizeRegular(session) {
    if (session.finalizing || !contextValid(session.context)) return;
    session.finalizing = true;
    window.clearTimeout(session.timer);
    session.stream.getTracks().forEach((track) => track.stop());
    regularSession = null; finalizingSession = session; recorder = null; setRecording(false); busy = true; micBtn.disabled = true;
    showVoiceStatus(window.t('voice.finalizing'));
    try {
      await session.queue;
      if (!contextValid(session.context)) return;
      const transcript = session.transcripts.filter(Boolean).join(' ').trim();
      if (!transcript) throw session.errors.find(Boolean) || new Error(window.t('voice.emptyLong'));
      if (session.errors.some(Boolean)) showVoiceStatus(window.t('voice.partialTranscript'));
      else showVoiceStatus(window.t('voice.translating'));
      await window.submitTranslation(transcript, submissionOptions(session.context));
    } catch (error) {
      if (!contextValid(session.context) || error.name === 'AbortError') return;
      if (error.code === 'TRIAL_LIMIT_REACHED') window.showTrialLimit?.();
      showVoiceStatus(window.errorMessage(error, 'voice.emptyLong'), true);
    } finally {
      if (contextValid(session.context)) { finalizingSession = null; busy = false; micBtn.disabled = false; renderCancelButton(); }
    }
  }

  function startRegularSegment(session) {
    if (session.stopping || !contextValid(session.context)) return;
    const index = session.nextIndex; session.nextIndex += 1;
    const segmentChunks = [];
    const current = new MediaRecorder(session.stream, recorderOptions());
    recorder = current; session.recorder = current;
    current.ondataavailable = (event) => { if (event.data.size) segmentChunks.push(event.data); };
    current.onstop = () => {
      window.clearTimeout(session.timer);
      if (!contextValid(session.context)) return;
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
    renderCancelButton();
    const context = captureContext();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (!contextValid(context)) { stopStream(stream); return; }
      regularSession = { stream, context, language: window.getSourceLanguage?.(), queue: Promise.resolve(), transcripts: [], errors: [], nextIndex: 0, completed: 0, stopping: false, finalizing: false, timer: null, recorder: null };
      startRegularSegment(regularSession); setRecording(true);
    } catch (error) { stopStream(stream); if (contextValid(context)) { regularSession = null; recorder = null; showVoiceStatus(window.errorMessage(error, 'voice.denied'), true); } }
    finally { if (context.generation === generation) { starting = false; micBtn.disabled = false; renderCancelButton(); } }
  }

  function stopRegular() {
    const session = regularSession;
    if (!session || session.stopping) return;
    session.stopping = true; window.clearTimeout(session.timer);
    showVoiceStatus(window.t('voice.finalizing'));
    if (session.recorder?.state === 'recording') session.recorder.stop();
    else finalizeRegular(session);
  }

  async function submitLiveTranscript(text, context) {
    const transcript = text.trim();
    if (!transcript || !contextValid(context)) return;
    pendingLiveTranscripts += 1; renderCancelButton();
    setLiveTranscript(transcript); showVoiceStatus(window.t('voice.translating'));
    try { await window.submitLiveTranslation(transcript, submissionOptions(context)); }
    catch (error) { if (contextValid(context) && error.name !== 'AbortError') showVoiceStatus(window.errorMessage(error), true); }
    finally {
      if (context.generation === generation) { pendingLiveTranscripts -= 1; renderCancelButton(); }
      if (contextValid(context) && liveSession && !liveStopping) { setLiveTranscript(''); showVoiceStatus(window.t('live.listening')); }
    }
  }
  function handleLiveEvent(event, session) {
    if (liveSession !== session || !contextValid(session.context)) return;
    let data; try { data = JSON.parse(event.data); } catch { return; }
    const type = data.type || ''; const id = data.item_id || data.content_index || 'active';
    if (type === 'input_audio_buffer.speech_started') {
      if (liveSession && !liveStopping) window.SharedConversation?.setSpeaking(true);
      return;
    }
    if (type === 'input_audio_buffer.speech_stopped') {
      window.SharedConversation?.setSpeaking(false);
      return;
    }
    if (type.endsWith('.delta') && typeof data.delta === 'string') {
      liveParts.set(id, `${liveParts.get(id) || ''}${data.delta}`); setLiveTranscript(liveParts.get(id)); return;
    }
    if (type.endsWith('.completed') && typeof data.transcript === 'string') {
      const text = data.transcript; liveParts.delete(id); submitLiveTranscript(text, session.context); if (liveStopping) window.setTimeout(() => { if (liveSession === session) closeLiveSession(); }, 120); return;
    }
    if (type === 'error') { window.SharedConversation?.setSpeaking(false); showVoiceStatus(window.errorMessage({ code: 'LIVE_UNAVAILABLE' }), true); }
  }
  function closeLiveSession() {
    const session = liveSession; if (!session) return;
    window.SharedConversation?.setSpeaking(false);
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
    renderCancelButton();
    const context = captureContext();
    showVoiceStatus(window.t('live.connecting'));
    let stream; let connection; let channel;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (!contextValid(context)) { stopStream(stream); return; }
      connection = new RTCPeerConnection(); channel = connection.createDataChannel('oai-events');
      const session = { connection, channel, stream, context };
      startupResources = session;
      stream.getTracks().forEach((track) => connection.addTrack(track, stream));
      channel.addEventListener('message', event => handleLiveEvent(event, session));
      channel.addEventListener('close', () => { if (liveSession?.connection === connection) closeLiveSession(); });
      connection.addEventListener('connectionstatechange', () => {
        if (liveSession?.connection === connection && ['failed', 'disconnected'].includes(connection.connectionState)) {
          closeLiveSession(); showVoiceStatus(window.t('live.unavailable'), true);
        }
      });
      const offer = await connection.createOffer();
      if (!contextValid(context)) return;
      await connection.setLocalDescription(offer);
      if (!contextValid(context)) return;
      const answer = await window.Api.liveSession(offer.sdp, context.roomId);
      if (!contextValid(context)) return;
      await connection.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
      if (!contextValid(context)) return;
      startupResources = null; liveSession = session; setRecording(true, 'live');
    } catch (error) {
      if (liveSession?.connection === connection) closeLiveSession();
      else { stream?.getTracks().forEach((track) => track.stop()); channel?.close(); connection?.close(); }
      if (contextValid(context)) showVoiceStatus(window.errorMessage(error, 'live.unavailable'), true);
    } finally {
      if (!contextValid(context)) { stopStream(stream); channel?.close(); connection?.close(); }
      if (context.generation === generation) { startupResources = null; starting = false; micBtn.disabled = false; renderCancelButton(); }
    }
  }
  function stopLive() {
    // Stop accepting a new phrase but leave the connection open long enough
    // for server-side VAD to finalize the last spoken words.
    if (liveStopping) return;
    window.SharedConversation?.setSpeaking(false);
    liveStopping = true; micBtn.disabled = true;
    showVoiceStatus(window.t('live.processing'));
    liveSession.stream.getTracks().forEach((track) => track.stop());
    liveStopTimer = window.setTimeout(() => { if (liveSession) closeLiveSession(); }, 4000);
  }

  liveButton.addEventListener('click', () => { if (!window.accessState?.authenticated && !window.SharedConversation?.active) { window.showAuth?.('register', 'trial.live'); return; } setLiveEnabled(!liveEnabled); });
  cancelButton.addEventListener('click', () => { window.cancelVoiceInput(); showVoiceStatus(window.t('voice.canceled')); });
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
  window.addEventListener('pagehide', window.cancelVoiceInput);
  renderCancelButton(); renderLiveToggle(); if (liveEnabled) hint.textContent = window.t('live.hint');
})();
