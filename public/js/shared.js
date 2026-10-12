(() => {
  const $ = (id) => document.getElementById(id);
  const setup = $('shared-setup'); const status = $('shared-status'); const feed = $('feed');
  let active = null; let timer; let pollBusy = false; let invitation = null; let starting = false; let historyLoaded = false;
  const rendered = new Map();
  const retries = new Map();
  let personalPair;
  let leaveRequest = null;
  let generation = 0;
  let lastReceivedId = 0;
  let localSpeaking = false;
  let speakingTimer;
  let speakingQueue = Promise.resolve();
  let speakingRevision = 0;
  let pendingSpeaking = null;
  function busy() { return Boolean(leaveRequest) || window.voiceInProgress?.() || window.translationBusy?.(); }
  function say(key) { window.showVoiceStatus?.(window.t(key)); }
  function updateControls() {
    const toolbar = $('shared-toolbar');
    if (active) { if (toolbar.parentElement !== $('shared-room-actions')) $('shared-room-actions').append(toolbar); }
    else { if (toolbar.parentElement !== $('translator-screen')) $('translator-screen').insertBefore(toolbar, setup); $('shared-room-dialog').close(); }
    $('shared-room-menu').hidden = !active;
    $('shared-create').hidden = Boolean(active); status.hidden = !active;
    $('shared-invite').hidden = !active || active.role !== 'host'; $('shared-leave').hidden = !active;
    if (!active || active.role !== 'host') $('shared-link-panel').hidden = true;
    ['source-language-btn', 'target-language-btn', 'swap-languages-btn'].forEach((id) => { $(id).disabled = Boolean(active); });
    if (active) $('trial-remaining').hidden = true;
    const label = $('target-language-btn').querySelector('span'); label.dataset.i18n = active && active.participants.length > 2 ? 'shared.audience' : 'pair.target'; label.textContent = window.t(label.dataset.i18n);
  }
  function showStatus(connected = true) {
    renderSpeaking();
    if (!active) return;
    const others = active.participants.filter((member) => member.id !== active.memberId);

    status.textContent = !connected ? window.t('shared.reconnecting') : `${active.title ? active.title + ' · ' : ''}${window.t('shared.count').replace('{count}', active.participants.length)}`;
    status.title = active.title || window.t('shared.roomDefault');
    if (active.participants.length > 2) {
      const languages = [...new Set(others.map((member) => member.language))].filter(Boolean);
      $('target-language').textContent = languages.map((language) => window.displayLanguage?.(language) || language).join(', ');
    }
    if ($('shared-people-dialog').open) renderPeople();
  }
  function participantName(member) {
    const named = !['1', '2'].includes(member.name) && member.name;
    if (member.id === active.memberId) return named ? `${window.t('shared.you')} (${member.name})` : window.t('shared.you');
    return named || window.t('shared.participant').replace('{number}', active.participants.findIndex(person => person.id === member.id) + 1);
  }
  function renderSpeaking() {
    const speakers = active?.participants.filter((member) => member.speaking) || [];
    const label = $('shared-speaking');
    const text = speakers.length ? `${window.t(speakers.length === 1 ? 'shared.speakingNow' : 'shared.speakingMany')}: ${speakers.map(participantName).join(', ')}` : '';
    if (label.textContent !== text) label.textContent = text;
    label.hidden = speakers.length === 0;
  }
  function publishSpeaking(roomId, speaking) {
    const revision = speakingRevision;
    if (pendingSpeaking?.revision === revision) return pendingSpeaking.promise;
    // Coalesce heartbeats and skip superseded updates behind a slow request.
    speakingQueue = speakingQueue.then(() => {
      if (speakingRevision === revision) return window.Api.sharedSpeaking(roomId, speaking);
    }).catch((error) => {
      if (active?.id === roomId && error.status !== 404) showStatus(false);
    });
    const pending = { revision, promise: speakingQueue };
    pendingSpeaking = pending;
    speakingQueue.finally(() => { if (pendingSpeaking === pending) pendingSpeaking = null; });
    return pending.promise;
  }
  function setSpeaking(speaking) {
    if (!active || localSpeaking === speaking) return;
    speakingRevision++;
    localSpeaking = speaking;
    window.clearInterval(speakingTimer);
    const roomId = active.id;
    active = { ...active, participants: active.participants.map((member) => member.id === active.memberId ? { ...member, speaking } : member) };
    showStatus();
    if (speaking) speakingTimer = window.setInterval(() => publishSpeaking(roomId, true), 2000);
    return publishSpeaking(roomId, speaking);
  }
  function renderMessage(message, animate = true) {
    const existing = rendered.get(message.id);
    const signature = JSON.stringify([message.status, message.translations]);
    if (existing?.signature === signature) return;
    const nearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 100;
    const previousScroll = feed.scrollTop;
    let card;
    const own = message.memberId === active.memberId;
    const language = active.sourceLanguage;
    const translated = message.translations?.[language];
    const viewerFailed = !own && message.sourceLanguage !== language && translated?.status === 'failed';
    const viewerPending = !own && message.sourceLanguage !== language && !['translated', 'failed'].includes(translated?.status);
    if (message.status === 'translated' && !viewerFailed && !viewerPending) {
      const sameLanguage = !own && message.sourceLanguage === language;
      const targetLanguage = own ? message.targetLanguage : language;
      const translationText = sameLanguage ? message.sourceText : !own && translated?.status === 'translated' ? translated.text : message.translationText;
      card = window.renderTranslation({ shared: true, animate: animate && !existing, sourceLanguage: message.sourceLanguage, targetLanguage, sameLanguage,
        original: message.sourceText, translation: translationText,
        voiceText: translationText, });
    } else {
      $('welcome-state')?.remove(); card = document.createElement('article'); card.className = 'turn-card';
      const phrase = document.createElement('p'); phrase.className = 'turn-text'; phrase.textContent = message.sourceText;
      const state = document.createElement('p'); state.className = 'shared-message-state'; state.dataset.i18n = message.status === 'failed' || viewerFailed ? 'shared.failed' : 'shared.translating'; state.textContent = window.t(message.status === 'failed' || viewerFailed ? 'shared.failed' : 'shared.translating');
      card.append(phrase, state); feed.append(card);
      if (viewerFailed || own && message.status === 'failed') {
        const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = window.t('shared.retry'); retry.dataset.i18n = 'shared.retry';
        retry.addEventListener('click', async () => { retry.disabled = true; try { if (viewerFailed) { const data = await window.Api.sharedRetryTranslation(active.id, message.id); renderMessage(data.message, false); } else await send(message.sourceText, message.requestId); } catch (error) { window.showVoiceStatus?.(window.errorMessage(error), true); } finally { retry.disabled = false; } });
        card.append(retry);
      }
    }
    const sender = document.createElement('p'); sender.className = 'shared-sender';
    const identity = document.createElement('span'); identity.dataset.i18n = own ? 'shared.you' : 'shared.them'; identity.textContent = window.t(identity.dataset.i18n); sender.append(identity); const senderDetail = document.createElement('span'); senderDetail.textContent = `${!['1', '2'].includes(message.senderName) ? ` · ${message.senderName}` : ''} · ${new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`; sender.append(senderDetail);
    card.prepend(sender); card.classList.toggle('shared-own', own);
    if (existing) { existing.card.replaceWith(card); }
    rendered.set(message.id, { card, status: viewerPending && message.status === 'translated' ? 'pending' : message.status, signature });
    if (!animate || existing) card.classList.add('is-restored');
    const nextId = [...rendered.keys()].filter((id) => id > message.id).sort((a, b) => a - b)[0];
    if (nextId) feed.insertBefore(card, rendered.get(nextId).card);
    if (nearBottom) feed.scrollTop = feed.scrollHeight; else feed.scrollTop = previousScroll;
  }
  async function refresh() {
    if (!active || pollBusy) return;
    pollBusy = true; const roomId = active.id; const pollGeneration = generation;
    try {
      const after = lastReceivedId;
      const pending = [...rendered.entries()].filter(([, entry]) => entry.status === 'pending').map(([id]) => id).slice(0, 100);
      const data = await window.Api.sharedRoom(roomId, { after, pending });
      if (active?.id !== roomId || generation !== pollGeneration) return;
      active = localSpeaking ? { ...data.room, participants: data.room.participants.map((member) => member.id === data.room.memberId ? { ...member, speaking: true } : member) } : data.room;
      updateControls(); showStatus(); data.messages.forEach((message) => renderMessage(message, historyLoaded));
      lastReceivedId = data.messages.reduce((max, message) => Math.max(max, message.id), lastReceivedId);
      historyLoaded = true;
    } catch (error) {
      if (active?.id !== roomId || generation !== pollGeneration) return;
      if (error.status === 404) { deactivate(); say('error.roomNotFound'); }
      else showStatus(false);
    }
    finally { if (generation === pollGeneration) pollBusy = false; }
  }
  function activate(room) {
    if (!active) personalPair = { source: window.getSourceLanguage?.(), target: window.getTargetLanguage?.() };
    generation++; pollBusy = false; lastReceivedId = 0;
    active = room; historyLoaded = false; rendered.clear(); feed.replaceChildren(); setup.hidden = true;
    const welcome = document.createElement('p'); welcome.id = 'welcome-state'; welcome.className = 'welcome-state'; welcome.textContent = window.t('shared.empty'); welcome.dataset.i18n = 'shared.empty'; feed.append(welcome);
    window.setSharedPair(room.sourceLanguage, room.targetLanguage); updateControls(); showStatus();
    history.replaceState(null, '', `#room=${room.id}`);
    localStorage.setItem('shared-room', room.id);
    window.clearInterval(timer); timer = window.setInterval(refresh, 1500); refresh();
    say(room.role === 'host' && room.participants.length === 1 ? 'shared.created' : 'voice.ready');
  }
  function deactivate() {
    if (!active) return;
    if (localSpeaking) setSpeaking(false);
    window.cancelVoiceInput?.();
    window.clearInterval(speakingTimer);
    window.stopSpeech?.();
    generation++; pollBusy = false;
    window.clearInterval(timer); active = null; rendered.clear(); retries.clear(); updateControls();
    history.replaceState(null, '', location.pathname); localStorage.removeItem('shared-room');
    feed.replaceChildren(); renderSpeaking(); say('voice.ready');
    if (personalPair?.source && personalPair?.target) window.setSharedPair(personalPair.source, personalPair.target);
  }
  async function leave() {
    if (leaveRequest) return leaveRequest;
    if (!active) return;
    const roomId = active.id;
    $('shared-leave').disabled = true;
    leaveRequest = (async () => {
      try { await window.Api.sharedLeave(roomId); }
      catch (error) { if (error.status !== 404) throw error; }
      if (active?.id === roomId) deactivate();
    })();
    try { await leaveRequest; }
    finally { leaveRequest = null; $('shared-leave').disabled = false; }
  }
  async function send(text, requestId) {
    const roomId = active.id;
    const key = `${roomId}:${text}`;
    requestId ||= retries.get(key) || crypto.randomUUID();
    retries.set(key, requestId);
    try {
      const data = await window.Api.sharedSend(roomId, text, requestId);
      if (active?.id === roomId) { renderMessage(data.message); refresh(); }
      retries.delete(key);
      return data;
    } catch (error) {
      if (active?.id === roomId && error.data?.message?.id) renderMessage(error.data.message);
      throw error;
    }
  }
  async function showSetup(joining) {
    setup.hidden = false; $('shared-setup-error').hidden = true; $('shared-start').disabled = false;
    $('shared-setup-body').dataset.i18n = joining ? 'shared.joinBody' : 'shared.body';
    $('shared-setup-body').textContent = window.t($('shared-setup-body').dataset.i18n);
    $('shared-start').textContent = window.t(joining ? 'shared.join' : 'shared.start');
    $('shared-title-field').hidden = joining;
    const languages = window.TRANSLATOR_LANGUAGES || [];
    $('shared-language').replaceChildren(...languages.map((language) => { const option = document.createElement('option'); option.value = language.name; option.dataset.language = language.name; option.textContent = window.displayLanguage?.(language.name) || language.name; return option; }));
    $('shared-language').value = window.getSourceLanguage?.() || 'Русский';
    if (joining) {
      const token = invitation; $('shared-start').disabled = true;
      try { const info = await window.Api.sharedInvite(token); if (invitation !== token) return; $('shared-language').value = info.language; $('shared-setup-title').textContent = info.title || window.t('shared.title'); }
      catch (error) { $('shared-setup-error').textContent = window.errorMessage(error); $('shared-setup-error').hidden = false; }
      finally { if (invitation === token) $('shared-start').disabled = false; }
    } else { $('shared-setup-title').textContent = window.t('shared.title'); $('shared-room-title').value = ''; }
    $('shared-name').focus();
  }
  $('shared-create').addEventListener('click', () => {
    if (busy()) { say('shared.finishRecording'); return; }
    if (!window.accessState?.authenticated) { window.showAuth?.('register'); return; }
    deactivate(); invitation = null; showSetup(false);
  });
  $('shared-cancel').addEventListener('click', () => { setup.hidden = true; invitation = null; history.replaceState(null, '', location.pathname); });
  $('shared-start').addEventListener('click', async () => {
    if (starting || busy()) return;
    starting = true; $('shared-start').disabled = true;
    try {
      const name = $('shared-name').value;
      const language = $('shared-language').value;
      let target = window.getTargetLanguage();
      if (target === language) target = language === 'Русский' ? 'Английский' : 'Русский';
      const data = invitation ? await window.Api.sharedJoin(invitation, name, language) : await window.Api.sharedCreate(language, target, name, $('shared-room-title').value.trim() || `${window.t('shared.roomDefault')} · ${new Date().toLocaleString()}`);
      invitation = null; activate(data.room);
    } catch (error) {
      const el = $('shared-setup-error'); el.textContent = window.errorMessage(error); el.hidden = false;
    } finally { starting = false; $('shared-start').disabled = false; }
  });
  $('shared-invite').addEventListener('click', () => {
    $('shared-link').value = `${location.origin}/#invite=${active.inviteToken}`;
    $('shared-link-panel').hidden = !$('shared-link-panel').hidden;
    if (!$('shared-link-panel').hidden) { $('shared-link').focus(); $('shared-link').select(); }
  });
  $('shared-copy').addEventListener('click', async () => {
    const url = $('shared-link').value;
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url); $('shared-room-dialog').close(); say('shared.copied'); }
      else window.prompt(window.t('shared.invite'), url);
    } catch (error) { if (error.name !== 'AbortError') window.prompt(window.t('shared.invite'), url); }
  });
  $('shared-leave').addEventListener('click', async () => {
    if (busy()) { say('shared.finishRecording'); return; }
    try { await leave(); $('new-conversation-btn').click(); }
    catch (error) { window.showVoiceStatus?.(window.errorMessage(error), true); }
  });
  async function appendHistory(list) {
    const data = await window.Api.sharedRooms();
    data.rooms.slice().reverse().forEach((room) => {
      const li = document.createElement('li'); const button = document.createElement('button'); button.type = 'button'; button.className = 'conversation-open';
      const title = document.createElement('strong'); title.textContent = room.title || window.t('shared.roomDefault');
      const meta = document.createElement('span'); meta.className = 'shared-room-meta';
      meta.textContent = `${window.t('shared.count').replace('{count}', room.participants.length)} · ${room.participants.map((member) => !['1','2'].includes(member.name) ? member.name : window.displayLanguage?.(member.language) || member.language).join(', ')}`;
      button.append(title, meta);
      button.addEventListener('click', () => { if (busy()) { say('shared.finishRecording'); return; } activate(room); $('history-dialog').close(); });
      li.append(button); list.prepend(li);
    });
    if (!list.children.length) { const empty = document.createElement('li'); empty.className = 'history-empty'; empty.textContent = window.t('history.empty'); list.append(empty); }
  }
  function renderPeople() {
    if (!active) return;
    $('shared-people-title').textContent = active.title || window.t('shared.people');
    $('shared-people-list').replaceChildren(...active.participants.map((member) => {
      const item = document.createElement('li');
      const name = participantName(member);
      const online = Date.now() - Date.parse(member.lastSeen) < 15000;
      item.classList.toggle('is-speaking', Boolean(member.speaking));
      item.textContent = `${name} · ${window.displayLanguage?.(member.language) || member.language} · ${window.t(member.speaking ? 'shared.speaking' : online ? 'shared.onlineCount' : 'shared.offline').replace('{count}', 1)}`;
      return item;
    }));
  }
  $('shared-room-menu').addEventListener('click', () => { $('shared-room-dialog-title').textContent = active?.title || window.t('shared.controls'); $('shared-room-dialog').showModal(); });
  $('shared-room-close').addEventListener('click', () => $('shared-room-dialog').close());
  $('shared-room-dialog').addEventListener('close', () => { $('shared-link-panel').hidden = true; });
  $('shared-status').addEventListener('click', () => { renderPeople(); $('shared-people-dialog').showModal(); });
  $('shared-people-close').addEventListener('click', () => $('shared-people-dialog').close());
  $('new-shared-btn').addEventListener('click', () => { if (busy()) { say('shared.finishRecording'); return; } $('history-dialog').close(); $('shared-create').click(); });
  window.SharedConversation = { get active() { return active; }, get leaving() { return Boolean(leaveRequest); }, send, leave, deactivate, appendHistory, setSpeaking };
  async function restore() {
    const params = new URLSearchParams(location.hash.slice(1));
    if (params.has('invite')) { if (busy()) { say('shared.finishRecording'); return; } deactivate(); invitation = params.get('invite'); await showSetup(true); return; }
    if (active && (!params.get('room') || params.get('room') === active.id)) { updateControls(); return; }
    if (active && busy()) { say('shared.finishRecording'); return; }
    const roomId = params.get('room') || localStorage.getItem('shared-room');
    if (roomId) {
      try { const data = await window.Api.sharedRoom(roomId); activate(data.room); }
      catch { localStorage.removeItem('shared-room'); history.replaceState(null, '', location.pathname); say('error.roomNotFound'); }
    }
  }
  window.addEventListener('authenticated', (event) => {
    if (active && event.detail) personalPair = { source: event.detail.sourceLanguage, target: event.detail.targetLanguage };
    restore();
  });
  window.addEventListener('localechange', () => { updateControls(); showStatus(); if (!setup.hidden) $('shared-start').textContent = window.t(invitation ? 'shared.join' : 'shared.start'); });
  window.addEventListener('online', refresh); window.addEventListener('hashchange', restore);
  if (window.accessState) restore();
})();
