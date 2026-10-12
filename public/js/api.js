window.Api = (() => {
  async function request(path, options = {}) {
    const res = await fetch(path, { ...options, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { const err = new Error(window.errorMessage({ code: body.code, status: res.status })); err.code = body.code; err.status = res.status; err.data = body; throw err; }
    return body;
  }
  async function audio(path, body, headers) {
    const res = await fetch(path, { method: 'POST', credentials: 'include', headers, body });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const err = new Error(window.errorMessage({ code: data.code, status: res.status }));
      err.code = data.code;
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return res;
  }
  return {
    register: (email, password, company) => request('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password, company }) }),
    login: (email, password) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
    me: () => request('/api/auth/me'),
    trial: () => request('/api/auth/trial'),
    voices: () => request('/api/translator/voices'),
    pushConfig: () => request('/api/push/config'),
    pushSubscribe: (body) => request('/api/push/subscriptions', { method: 'POST', body: JSON.stringify(body) }),
    pushUnsubscribe: (endpoint) => request('/api/push/subscriptions', { method: 'DELETE', body: JSON.stringify({ endpoint }) }),
    setLanguage: (language) => request('/api/translator/set-language', { method: 'POST', body: JSON.stringify({ language }) }),
    setLanguages: (sourceLanguage, targetLanguage) => request('/api/translator/set-languages', { method: 'POST', body: JSON.stringify({ sourceLanguage, targetLanguage }) }),
    translate: (text, conversationId) => request('/api/translator/translate', { method: 'POST', body: JSON.stringify({ text, conversationId }) }),
    conversations: () => request('/api/translator/conversations'),
    sharedCreate: (sourceLanguage, targetLanguage, name, title) => request('/api/shared', { method: 'POST', body: JSON.stringify({ sourceLanguage, targetLanguage, name, title }) }),
    sharedJoin: (token, name, language) => request('/api/shared/join', { method: 'POST', body: JSON.stringify({ token, name, language }) }),
    sharedInvite: (token) => request(`/api/shared/invite/${encodeURIComponent(token)}`),
    sharedRetryTranslation: (id, messageId) => request(`/api/shared/${id}/messages/${messageId}/translation`, { method: 'POST', body: '{}' }),
    sharedRooms: () => request('/api/shared'),
    sharedLeave: (id) => request(`/api/shared/${encodeURIComponent(id)}/leave`, { method: 'POST', body: '{}' }),
    sharedSpeaking: (id, speaking) => request(`/api/shared/${encodeURIComponent(id)}/speaking`, { method: 'POST', body: JSON.stringify({ speaking }), keepalive: true, signal: AbortSignal.timeout(4000) }),
    sharedRoom: (id, { after = 0, pending = [] } = {}) => request(`/api/shared/${id}?after=${after}&pending=${pending.join(',')}`),
    sharedSend: (id, text, requestId) => request(`/api/shared/${id}/messages`, { method: 'POST', body: JSON.stringify({ text, requestId }) }),
    conversationMessages: (id) => request(`/api/translator/conversations/${id}/messages`),
    deleteConversation: (id) => request(`/api/translator/conversations/${id}`, { method: 'DELETE' }),
    speech: async (text, language, voice) => (await audio('/api/translator/speech', JSON.stringify({ text, language, voice }), { 'Content-Type': 'application/json' })).blob(),
    transcribe: async (blob, language, roomId = window.SharedConversation?.active?.id || null) => (await audio(roomId ? `/api/shared/${encodeURIComponent(roomId)}/transcribe` : `/api/translator/transcribe?language=${encodeURIComponent(language || '')}`, blob, { 'Content-Type': blob.type || 'audio/webm' })).json(),
    liveSession: (sdp, roomId = window.SharedConversation?.active?.id || null) => request(roomId ? `/api/shared/${encodeURIComponent(roomId)}/live/session` : '/api/translator/live/session', { method: 'POST', body: JSON.stringify({ sdp }) }),
  };
})();
