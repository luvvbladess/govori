// public/js/api.js
window.Api = (() => {
  async function request(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.message || 'Request failed');
      err.code = body.code;
      err.status = res.status;
      throw err;
    }
    return body;
  }

  return {
    register: (email, password) =>
      request('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) }),
    login: (email, password) =>
      request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
    logout: () => request('/api/auth/logout', { method: 'POST' }),
    me: () => request('/api/auth/me'),
    setLanguage: (language) =>
      request('/api/translator/set-language', { method: 'POST', body: JSON.stringify({ language }) }),
    translate: (text) =>
      request('/api/translator/translate', { method: 'POST', body: JSON.stringify({ text }) }),
  };
})();
