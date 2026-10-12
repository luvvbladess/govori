(() => {
  const $ = (id) => document.getElementById(id);
  const setup = $('shared-setup'); const status = $('shared-status'); const feed = $('feed');
  let active = null; let timer; let pollBusy = false; let invitation = null; let starting = false; let historyLoaded = false;
  const rendered = new Map();
  const retries = new Map();
  let personalPair;
  function busy() { return window.voiceInProgress?.() || window.translationBusy?.(); }
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
    if (message.status === 'translated' && !viewerFailed) {
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
    rendered.set(message.id, { card, status: message.status, signature });
    if (!animate || existing) card.classList.add('is-restored');
    const nextId = [...rendered.keys()].filter((id) => id > message.id).sort((a, b) => a - b)[0];
    if (nextId) feed.insertBefore(card, rendered.get(nextId).card);
    if (nearBottom) feed.scrollTop = feed.scrollHeight; else feed.scrollTop = previousScroll;
  }
  async function refresh() {
    if (!active || pollBusy) return;
    pollBusy = true; const roomId = active.id;
    try {
      const after = historyLoaded ? [...rendered.keys()].reduce((max, id) => Math.max(max, id), 0) : 0;
      const pending = [...rendered.entries()].filter(([, entry]) => entry.status === 'pending').map(([id]) => id);
      const data = await window.Api.sharedRoom(roomId, { after, pending });
      if (active?.id !== roomId) return;
      active = data.room; updateControls(); showStatus(); data.messages.forEach((message) => renderMessage(message, historyLoaded)); historyLoaded = true;
    } catch (error) { if (active?.id === roomId) showStatus(false); }
    finally { pollBusy = false; }
  }
  function activate(room) {
    if (!active) personalPair = { source: window.getSourceLanguage?.(), target: window.getTargetLanguage?.() };
    active = room; historyLoaded = false; rendered.clear(); feed.replaceChildren(); setup.hidden = true;
    const welcome = document.createElement('p'); welcome.id = 'welcome-state'; welcome.className = 'welcome-state'; welcome.textContent = window.t('shared.empty'); welcome.dataset.i18n = 'shared.empty'; feed.append(welcome);
    window.setSharedPair(room.sourceLanguage, room.targetLanguage); updateControls(); showStatus();
    history.replaceState(null, '', `#room=${room.id}`);
    localStorage.setItem('shared-room', room.id);
    window.clearInterval(timer); timer = window.setInterval(refresh, 1500); refresh();
    say(room.role === 'host' && room.participants.length === 1 ? 'shared.created' : 'voice.ready');
  }
  function leave() {
    if (!active) return;
    window.stopSpeech?.();
    window.clearInterval(timer); active = null; rendered.clear(); updateControls();
    history.replaceState(null, '', location.pathname); localStorage.removeItem('shared-room');
    feed.replaceChildren(); say('voice.ready');
    if (personalPair?.source && personalPair?.target) window.setSharedPair(personalPair.source, personalPair.target);
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
    leave(); invitation = null; showSetup(false);
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
  $('shared-leave').addEventListener('click', () => { if (busy()) { say('shared.finishRecording'); return; } leave(); $('new-conversation-btn').click(); });
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
      const name = member.id === active.memberId ? window.t('shared.you') : !['1','2'].includes(member.name) ? member.name : window.t('shared.them');
      const online = Date.now() - Date.parse(member.lastSeen) < 15000;
      item.textContent = `${name} · ${window.displayLanguage?.(member.language) || member.language} · ${window.t(online ? 'shared.onlineCount' : 'shared.offline').replace('{count}', 1)}`;
      return item;
    }));
  }
  $('shared-room-menu').addEventListener('click', () => { $('shared-room-dialog-title').textContent = active?.title || window.t('shared.controls'); $('shared-room-dialog').showModal(); });
  $('shared-room-close').addEventListener('click', () => $('shared-room-dialog').close());
  $('shared-room-dialog').addEventListener('close', () => { $('shared-link-panel').hidden = true; });
  $('shared-status').addEventListener('click', () => { renderPeople(); $('shared-people-dialog').showModal(); });
  $('shared-people-close').addEventListener('click', () => $('shared-people-dialog').close());
  $('new-shared-btn').addEventListener('click', () => { if (busy()) { say('shared.finishRecording'); return; } $('history-dialog').close(); $('shared-create').click(); });
  window.SharedConversation = { get active() { return active; }, send, leave, appendHistory };
  async function restore() {
    const params = new URLSearchParams(location.hash.slice(1));
    if (params.has('invite')) { if (busy()) { say('shared.finishRecording'); return; } leave(); invitation = params.get('invite'); await showSetup(true); return; }
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
