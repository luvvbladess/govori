(() => {
  const LANGUAGES = [
    ['Русский', 'ru-RU'], ['Английский', 'en-US'], ['Китайский', 'zh-CN'], ['Испанский', 'es-ES'], ['Немецкий', 'de-DE'], ['Французский', 'fr-FR'], ['Японский', 'ja-JP'], ['Корейский', 'ko-KR'], ['Арабский', 'ar-SA'], ['Турецкий', 'tr-TR'], ['Итальянский', 'it-IT'], ['Португальский', 'pt-PT'], ['Вьетнамский', 'vi-VN'], ['Тайский', 'th-TH'], ['Хинди', 'hi-IN'], ['Польский', 'pl-PL'],
  ].map(([name, code]) => ({ name, code }));
  const LANGUAGE_KEYS = { Русский: 'Russian', Английский: 'English', Китайский: 'Chinese', Испанский: 'Spanish', Немецкий: 'German', Французский: 'French', Японский: 'Japanese', Корейский: 'Korean', Арабский: 'Arabic', Турецкий: 'Turkish', Итальянский: 'Italian', Португальский: 'Portuguese', Вьетнамский: 'Vietnamese', Тайский: 'Thai', Хинди: 'Hindi', Польский: 'Polish' };
  window.TRANSLATOR_LANGUAGES = LANGUAGES;
  window.codeForLanguage = (name) => LANGUAGES.find((language) => language.name === name)?.code || 'ru-RU';

  const feed = document.getElementById('feed'); const textInput = document.getElementById('text-input'); const sendBtn = document.getElementById('send-btn'); const languageDialog = document.getElementById('language-dialog'); const languageList = document.getElementById('language-list'); const sourceEl = document.getElementById('source-language'); const targetEl = document.getElementById('target-language'); const dialogRole = document.getElementById('language-dialog-role'); const historyDialog = document.getElementById('history-dialog'); const conversationList = document.getElementById('conversation-list'); const trialRemaining = document.getElementById('trial-remaining');
  let sourceLanguage = 'Русский'; let targetLanguage = 'Английский'; let editingSide = 'source'; let isSending = false; let currentConversationId = null; const liveQueue = []; let processingLiveQueue = false; const localizedErrors = new WeakMap();
  window.getSourceLanguage = () => sourceLanguage;
  window.getTargetLanguage = () => targetLanguage;
  window.setSharedPair = (source, target) => { sourceLanguage = source; targetLanguage = target; currentConversationId = null; updatePair(); };
  window.translationBusy = () => isSending || liveQueue.length > 0 || processingLiveQueue;
  let playbackGeneration = 0;
  let playbackAttempt = null;
  const preparedSpeech = new WeakMap();
  window.stopSpeech = () => { playbackGeneration++; if (playbackAttempt) finishPlayback(playbackAttempt); };
  function displayLanguage(name) { const translated = window.t(`lang.${LANGUAGE_KEYS[name] || name}`); return translated.startsWith('lang.') ? name : translated; }
  window.displayLanguage = displayLanguage;
  function updatePair() { sourceEl.textContent = displayLanguage(sourceLanguage); targetEl.textContent = displayLanguage(targetLanguage); }
  function removeWelcome() { document.getElementById('welcome-state')?.remove(); }
  async function savePair(nextSource, nextTarget) { if (window.voiceInProgress?.() || isSending) { window.showVoiceStatus?.(window.t('shared.finishRecording')); return; } const saved = await window.Api.setLanguages(nextSource, nextTarget); sourceLanguage = saved.sourceLanguage; targetLanguage = saved.targetLanguage; currentConversationId = null; updatePair(); }
  function voiceKey(voice) { return voice || 'default'; }
  function prepareSpeech(result, voice = window.getSpeechVoice?.()) {
    let entries = preparedSpeech.get(result);
    if (!entries) { entries = new Map(); preparedSpeech.set(result, entries); }
    const key = voiceKey(voice);
    if (entries.has(key)) return entries.get(key).promise;
    const promise = window.Api.speech(result.voiceText, result.targetLanguage, voice).then(blob => {
      entries.set(key, { blob, promise: Promise.resolve(blob) }); return blob;
    }).catch(() => { entries.delete(key); return null; });
    entries.set(key, { promise }); return promise;
  }
  function assertPlaybackCurrent(generation) { if (generation !== playbackGeneration) throw Object.assign(new Error('Playback canceled'), { name: 'AbortError' }); }
  function setPlaybackLocked(locked) { document.querySelectorAll('.play-btn').forEach((playButton) => { playButton.disabled = locked; }); }
  function finishPlayback(attempt) {
    if (attempt.finished) return;
    attempt.finished = true; attempt.cancelLoad?.(); attempt.audio?.pause();
    if (attempt.url) URL.revokeObjectURL(attempt.url);
    if (playbackAttempt !== attempt) return;
    playbackAttempt = null;
    setPlaybackLocked(false);
    const button = attempt.button; button.disabled = false; button.dataset.loading = 'false';
    button.setAttribute('aria-label', window.t('play')); button.dataset.i18nAria = 'play';
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  }
  function waitForAudio(attempt) {
    return new Promise((resolve, reject) => {
      const audio = attempt.audio;
      const cleanup = () => { audio.removeEventListener('canplay', ready); audio.removeEventListener('error', failed); attempt.cancelLoad = null; };
      const ready = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(new Error('AUDIO_LOAD_FAILED')); };
      attempt.cancelLoad = () => { cleanup(); reject(Object.assign(new Error('Playback canceled'), { name: 'AbortError' })); };
      audio.addEventListener('canplay', ready, { once: true }); audio.addEventListener('error', failed, { once: true }); audio.load();
    });
  }
  async function playSpeech(button, result) {
    if (playbackAttempt) { if (playbackAttempt.button === button) window.stopSpeech(); return; }
    const attempt = { button, generation: playbackGeneration, finished: false };
    playbackAttempt = attempt;
    button.dataset.loading = 'true'; button.setAttribute('aria-label', window.t('loadingSpeech')); button.dataset.i18nAria = 'loadingSpeech'; button.textContent = '…'; setPlaybackLocked(true);
    const voice = window.getSpeechVoice?.();
    try {
      const blob = await prepareSpeech(result, voice); assertPlaybackCurrent(attempt.generation);
      if (!blob) throw Object.assign(new Error('SPEECH_PREPARE_FAILED'), { code: 'SPEECH_PREPARE_FAILED' });
      attempt.url = URL.createObjectURL(blob); attempt.audio = new Audio(); attempt.audio.preload = 'auto'; attempt.audio.src = attempt.url;
      await waitForAudio(attempt); assertPlaybackCurrent(attempt.generation);
      button.disabled = false; attempt.audio.addEventListener('ended', () => finishPlayback(attempt), { once: true }); attempt.audio.addEventListener('error', () => finishPlayback(attempt), { once: true });
      button.setAttribute('aria-label', window.t('stopSpeech')); button.dataset.i18nAria = 'stopSpeech'; button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 6h10v12H7z"/></svg>';
      await attempt.audio.play();
    }
    catch (error) {
      const current = playbackAttempt === attempt;
      finishPlayback(attempt);
      if (current && error.name !== 'AbortError') window.showVoiceStatus?.(window.errorMessage(error, error.code === 'SPEECH_PREPARE_FAILED' ? 'error.speechPrepare' : 'error.audioPlayback'), true);
    }
  }
  async function shareTranslation(button, result) {
    if (button.dataset.loading === 'true') return;
    const text = `${displayLanguage(result.sourceLanguage)}: ${result.original}\n${displayLanguage(result.targetLanguage)}: ${result.translation}`;
    button.dataset.loading = 'true'; button.disabled = true; window.showVoiceStatus?.(window.t('sharing'));
    try {
      const data = { title: window.t('brand'), text };
      if (navigator.share) {
        // iOS requires share() to run inside the original tap event. Waiting
        // for a speech request first makes it reject the request as untrusted.
        const speechBlob = preparedSpeech.get(result)?.get(voiceKey(window.getSpeechVoice?.()))?.blob;
        if (speechBlob) {
          const file = new File([speechBlob], 'translation.mp3', { type: 'audio/mpeg' });
          if (navigator.canShare?.({ files: [file] })) data.files = [file];
        }
        await navigator.share(data);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text); window.showVoiceStatus?.(window.t('shareCopied'));
      } else {
        window.prompt(window.t('share'), text);
      }
    } catch (error) {
      if (error.name !== 'AbortError' && navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); window.showVoiceStatus?.(window.t('shareCopied')); }
    } finally { button.dataset.loading = 'false'; button.disabled = false; }
  }
  function createTurnSection(label, language, text, className = '') {
    const section = document.createElement('section'); section.className = `turn-section ${className}`; const meta = document.createElement('div'); meta.className = 'turn-meta'; const labelEl = document.createElement('span'); labelEl.textContent = window.t(label); labelEl.dataset.i18n = label; const languageEl = document.createElement('span'); languageEl.textContent = displayLanguage(language); languageEl.dataset.language = language; const phrase = document.createElement('p'); phrase.className = 'turn-text'; phrase.textContent = text; meta.append(labelEl, languageEl); section.append(meta, phrase); return { section, phrase };
  }
  function addTranslationCard(result) {
    removeWelcome(); if (!result.shared && result.animate !== false) prepareSpeech(result); const card = document.createElement('article'); card.className = result.animate === false ? 'turn-card is-restored' : 'turn-card'; const source = createTurnSection('card.source', result.sourceLanguage, result.original, 'source'); const translation = createTurnSection('card.translation', result.targetLanguage, result.translation); const resultRow = document.createElement('div'); resultRow.className = 'turn-result'; const actions = document.createElement('div'); actions.className = 'turn-actions'; const shareButton = document.createElement('button'); shareButton.className = 'share-btn'; shareButton.type = 'button'; shareButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11M8 7l4-4 4 4M6 11v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8"/></svg>'; shareButton.setAttribute('aria-label', window.t('share')); shareButton.dataset.i18nAria = 'share'; shareButton.addEventListener('click', () => shareTranslation(shareButton, result)); const button = document.createElement('button'); button.className = 'play-btn'; button.type = 'button'; button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>'; button.setAttribute('aria-label', window.t('play')); button.dataset.i18nAria = 'play'; button.addEventListener('click', () => playSpeech(button, result)); actions.append(shareButton, button); resultRow.append(actions); translation.section.replaceChild(resultRow, translation.phrase); resultRow.prepend(translation.phrase); if (result.sameLanguage) { source.section.append(actions); card.append(source.section); } else card.append(source.section, translation.section); feed.append(card); feed.scrollTop = feed.scrollHeight; return card;
  }
  async function shareTranscript(button, text) { const data = { title: window.t('brand'), text }; try { if (navigator.share) await navigator.share(data); else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); window.showVoiceStatus?.(window.t('shareCopied')); } else window.prompt(window.t('share'), text); } catch (error) { if (error.name !== 'AbortError') window.showVoiceStatus?.(window.errorMessage(error, 'error.share'), true); } finally { button.disabled = false; } }
  function addTranscriptCard(text, language = sourceLanguage) { removeWelcome(); const card = document.createElement('article'); card.className = 'turn-card transcript-card'; const transcript = createTurnSection('card.transcriptOnly', language, text, 'source'); const actions = document.createElement('div'); actions.className = 'turn-actions'; const shareButton = document.createElement('button'); shareButton.className = 'share-btn'; shareButton.type = 'button'; shareButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11M8 7l4-4 4 4M6 11v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8"/></svg>'; shareButton.setAttribute('aria-label', window.t('share')); shareButton.dataset.i18nAria = 'share'; shareButton.addEventListener('click', () => { shareButton.disabled = true; shareTranscript(shareButton, text); }); actions.append(shareButton); transcript.section.append(actions); card.append(transcript.section); feed.append(card); feed.scrollTop = feed.scrollHeight; }
  function addErrorCard(error, fallbackKey = 'error.generic') { removeWelcome(); const card = document.createElement('p'); card.className = 'error-card'; card.textContent = window.errorMessage(error, fallbackKey); localizedErrors.set(card, { error, fallbackKey }); feed.append(card); feed.scrollTop = feed.scrollHeight; }
  function updateTrial(remaining) { if (window.SharedConversation?.active || window.accessState?.authenticated || typeof remaining !== 'number') { trialRemaining.hidden = true; return; } window.accessState.translationsRemaining = remaining; trialRemaining.hidden = false; trialRemaining.textContent = window.t('trial.remaining').replace('{count}', remaining); if (remaining === 0) window.setTimeout(() => window.showTrialLimit?.(), 250); }
  window.renderTranslation = addTranslationCard;
  const roomId = () => window.SharedConversation?.active?.id || null;
  function contextOptions(options = {}) { return { ...options, roomId: options.roomId === undefined ? roomId() : options.roomId }; }
  function contextValid(options) { return options.roomId === roomId() && (!options.isCurrent || options.isCurrent()); }
  function canceledTranslation() { return Object.assign(new Error('Voice conversation changed'), { name: 'AbortError' }); }
  async function sendText(text, inputOptions = {}) {
    const options = contextOptions(inputOptions);
    if (!contextValid(options)) throw canceledTranslation();
    const trimmed = text.trim(); if (!trimmed || isSending) return;
    isSending = true; sendBtn.disabled = true;
    if (!options.live) window.setVoiceBusy?.(true, window.t('voice.translating'));
    try {
      if (options.roomId) return await window.SharedConversation.send(trimmed);
      const result = await window.Api.translate(trimmed, currentConversationId);
      if (!contextValid(options)) throw canceledTranslation();
      currentConversationId = result.conversationId; updateTrial(result.translationsRemaining); addTranslationCard(result); return result;
    } catch (error) {
      if (!contextValid(options) || error.name === 'AbortError') throw error;
      if (options.roomId) { textInput.value = trimmed; addErrorCard(error); throw error; }
      const transcript = error.data?.transcript || trimmed;
      currentConversationId = error.data?.conversationId || currentConversationId; addTranscriptCard(transcript);
      if (error.code === 'TRIAL_LIMIT_REACHED') { window.showTrialLimit?.(); throw error; }
      addErrorCard(error); throw error;
    } finally { isSending = false; sendBtn.disabled = !textInput.value.trim(); if (!options.live) window.setVoiceBusy?.(false); }
  }
  async function processLiveQueue() {
    if (processingLiveQueue) return;
    processingLiveQueue = true;
    try {
      while (liveQueue.length) {
        while (isSending && liveQueue.length) await new Promise(resolve => window.setTimeout(resolve, 50));
        const item = liveQueue.shift(); if (!item) continue;
        try { item.resolve(await sendText(item.text, { ...item.options, live: true })); } catch (error) { item.reject(error); }
      }
    } finally { processingLiveQueue = false; }
  }
  window.cancelVoiceTranslations = () => { for (const item of liveQueue.splice(0)) item.reject(canceledTranslation()); };
  window.submitTranslation = async (text, inputOptions) => {
    const options = contextOptions(inputOptions);
    while (isSending) { if (!contextValid(options)) throw canceledTranslation(); await new Promise(resolve => window.setTimeout(resolve, 50)); }
    return sendText(text, options);
  };
  window.submitLiveTranslation = (text, options) => new Promise((resolve, reject) => { liveQueue.push({ text, options: contextOptions(options), resolve, reject }); processLiveQueue(); });
  sendBtn.addEventListener('click', () => { const text = textInput.value; textInput.value = ''; sendText(text).catch(() => {}); }); textInput.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); sendBtn.click(); } }); textInput.addEventListener('input', () => { sendBtn.disabled = !textInput.value.trim() || isSending; });
  function renderLanguageList() { dialogRole.textContent = window.t(editingSide === 'source' ? 'pair.source' : 'pair.target'); languageList.replaceChildren(...LANGUAGES.map((language) => { const li = document.createElement('li'); const button = document.createElement('button'); const isOtherSide = language.name === (editingSide === 'source' ? targetLanguage : sourceLanguage); button.type = 'button'; button.textContent = displayLanguage(language.name); button.disabled = isOtherSide; button.setAttribute('aria-selected', String(language.name === (editingSide === 'source' ? sourceLanguage : targetLanguage))); button.addEventListener('click', async () => { try { await savePair(editingSide === 'source' ? language.name : sourceLanguage, editingSide === 'target' ? language.name : targetLanguage); languageDialog.close(); } catch (error) { addErrorCard(error); } }); li.append(button); return li; })); }
  function openLanguageDialog(side) { if (window.voiceInProgress?.() || isSending) { window.showVoiceStatus?.(window.t('shared.finishRecording')); return; } editingSide = side; renderLanguageList(); languageDialog.showModal(); }
  document.getElementById('source-language-btn').addEventListener('click', () => openLanguageDialog('source')); document.getElementById('target-language-btn').addEventListener('click', () => openLanguageDialog('target')); document.getElementById('swap-languages-btn').addEventListener('click', async () => { try { await savePair(targetLanguage, sourceLanguage); } catch (error) { addErrorCard(error); } }); document.getElementById('language-dialog-close').addEventListener('click', () => languageDialog.close());
  async function openConversation(id) { if (window.voiceInProgress?.() || isSending || window.SharedConversation?.leaving) return; window.SharedConversation?.deactivate(); window.stopSpeech(); const data = await window.Api.conversationMessages(id); currentConversationId = data.conversation.id; sourceLanguage = data.conversation.sourceLanguage; targetLanguage = data.conversation.targetLanguage; updatePair(); feed.replaceChildren(); data.messages.forEach((message) => { if (message.translationText) addTranslationCard({ sourceLanguage: message.sourceLanguage, targetLanguage: message.targetLanguage, original: message.sourceText, translation: message.translationText, voiceText: message.translationText, animate: false }); else addTranscriptCard(message.sourceText, message.sourceLanguage); }); historyDialog.close(); }
  async function showHistory() { if (!window.accessState?.authenticated && !window.SharedConversation?.active) { window.showAuth?.('login'); return; } const data = window.accessState?.authenticated ? await window.Api.conversations() : { conversations: [] }; conversationList.replaceChildren(...data.conversations.map((conversation) => { const li = document.createElement('li'); li.className = 'conversation-item'; const button = document.createElement('button'); button.className = 'conversation-open'; button.type = 'button'; button.textContent = conversation.title; button.addEventListener('click', () => openConversation(conversation.id).catch((error) => addErrorCard(error))); const remove = document.createElement('button'); remove.className = 'conversation-delete'; remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', window.t('history.delete')); remove.addEventListener('click', async () => { const confirmation = window.t('history.deleteConfirm').replace('{title}', conversation.title); if (!window.confirm(confirmation)) return; try { await window.Api.deleteConversation(conversation.id); if (currentConversationId === conversation.id) { currentConversationId = null; document.getElementById('new-conversation-btn').click(); } await showHistory(); } catch (error) { addErrorCard(error); } }); li.append(button, remove); return li; })); await window.SharedConversation?.appendHistory(conversationList); if (!historyDialog.open) historyDialog.showModal(); }
  document.getElementById('history-btn').addEventListener('click', () => showHistory().catch((error) => addErrorCard(error))); document.getElementById('history-close').addEventListener('click', () => historyDialog.close()); document.getElementById('new-conversation-btn').addEventListener('click', () => { if (window.voiceInProgress?.() || isSending || window.SharedConversation?.leaving) return; window.SharedConversation?.deactivate(); window.stopSpeech(); currentConversationId = null; feed.replaceChildren(); const welcome = document.createElement('div'); welcome.className = 'welcome-state'; welcome.id = 'welcome-state'; const heading = document.createElement('h1'); heading.textContent = window.t('welcome.title'); heading.dataset.i18n = 'welcome.title'; const body = document.createElement('p'); body.textContent = window.t('welcome.body'); body.dataset.i18n = 'welcome.body'; welcome.append(heading, body); feed.append(welcome); historyDialog.close(); });
  window.addEventListener('authenticated', async (event) => { const access = event.detail || window.accessState; if (!window.SharedConversation?.active) { sourceLanguage = access?.sourceLanguage || sourceLanguage; targetLanguage = access?.targetLanguage || targetLanguage; } updatePair(); updateTrial(access?.translationsRemaining); }); window.addEventListener('localechange', () => { updatePair(); document.querySelectorAll('[data-language]').forEach((element) => { element.textContent = displayLanguage(element.dataset.language); }); updateTrial(window.accessState?.translationsRemaining); if (languageDialog.open) renderLanguageList(); document.querySelectorAll('.error-card').forEach((card) => { const entry = localizedErrors.get(card); if (entry) card.textContent = window.errorMessage(entry.error, entry.fallbackKey); }); }); updatePair();
})();
