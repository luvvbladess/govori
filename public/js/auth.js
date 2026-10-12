// public/js/auth.js
(() => {
  const form = document.getElementById('auth-form');
  const emailInput = document.getElementById('auth-email');
  const passwordInput = document.getElementById('auth-password');
  const companyInput = document.getElementById('auth-company');
  const companyField = document.getElementById('company-field');
  const privacyNote = document.getElementById('auth-privacy');
  const passwordToggle = document.getElementById('auth-password-toggle');
  const submitButton = document.getElementById('auth-submit');
  const toggleButton = document.getElementById('auth-toggle-mode');
  const errorEl = document.getElementById('auth-error');
  const authScreen = document.getElementById('auth-screen');
  const translatorScreen = document.getElementById('translator-screen');
  const backToApp = document.getElementById('auth-back-to-app');
  const historyButton = document.getElementById('history-btn');
  const trialRemaining = document.getElementById('trial-remaining');
  const guestMenu = document.getElementById('guest-menu-dialog');
  const guestMenuStatus = document.getElementById('guest-menu-status');
  const trialLimit = document.getElementById('trial-limit-dialog');
  const translatorPreferencesSlot = document.getElementById('translator-preferences-slot');

  let mode = 'login';
  let activeAuthError = null;

  function renderAuthError() {
    if (!activeAuthError) { errorEl.hidden = true; return; }
    if (activeAuthError.key) errorEl.textContent = window.t(activeAuthError.key);
    else if (activeAuthError.error) errorEl.textContent = window.errorMessage(activeAuthError.error);
    else errorEl.textContent = activeAuthError.message;
    errorEl.hidden = false;
  }

  function setAuthError(value) {
    activeAuthError = typeof value === 'string' ? { key: value } : { error: value };
    renderAuthError();
  }

  function setMode(next, preserveError = false) {
    mode = next;
    submitButton.textContent = window.t(mode === 'login' ? 'auth.signIn' : 'auth.create');
    toggleButton.textContent = window.t(mode === 'login' ? 'auth.switchToRegister' : 'auth.switchToLogin');
    passwordInput.setAttribute('autocomplete', mode === 'login' ? 'current-password' : 'new-password');
    companyField.hidden = mode === 'login';
    privacyNote.hidden = mode === 'login';
    companyInput.disabled = mode === 'login';
    if (!preserveError) activeAuthError = null;
    renderAuthError();
  }

  toggleButton.addEventListener('click', () => setMode(mode === 'login' ? 'register' : 'login'));

  passwordToggle.addEventListener('click', () => {
    const isHidden = passwordInput.type === 'password';
    passwordInput.type = isHidden ? 'text' : 'password';
    passwordToggle.textContent = isHidden ? '🙈' : '👁';
    passwordToggle.setAttribute('aria-label', window.t(isHidden ? 'auth.hidePassword' : 'auth.showPassword'));
  });

  function showTranslator(access = { authenticated: true }) {
    window.accessState = access;
    document.body.classList.add('is-authenticated');
    document.body.classList.toggle('is-guest', !access.authenticated);
    translatorPreferencesSlot.append(document.querySelector('.app-preferences'));
    authScreen.hidden = true;
    translatorScreen.hidden = false;
    historyButton.setAttribute('aria-label', window.t(access.authenticated ? 'history.open' : 'trial.menuOpen'));
    window.dispatchEvent(new CustomEvent('authenticated', { detail: access }));
    if (!access.authenticated && access.translationsRemaining === 0 && !/^#(?:invite|room)=/.test(location.hash) && !localStorage.getItem('shared-room') && !window.SharedConversation?.active) window.setTimeout(() => showTrialLimit(), 250);
  }

  function showAuth(next = 'login', message = '') {
    if (guestMenu.open) guestMenu.close();
    if (trialLimit.open) trialLimit.close();
    document.body.classList.remove('is-authenticated');
    document.body.classList.remove('is-guest');
    document.body.append(document.querySelector('.app-preferences'));
    translatorScreen.hidden = true;
    authScreen.hidden = false;
    setMode(next);
    backToApp.hidden = !window.accessState || window.accessState.authenticated || window.accessState.translationsRemaining <= 0;
    if (message) setAuthError(message);
  }
  window.showAuth = showAuth;

  function showGuestMenu() {
    if (window.accessState?.authenticated) return;
    guestMenuStatus.textContent = window.t('trial.menuStatus').replace('{count}', window.accessState?.translationsRemaining ?? 0);
    if (!guestMenu.open) guestMenu.showModal();
  }
  function showTrialLimit() {
    if (window.accessState?.authenticated || window.SharedConversation?.active || trialLimit.open) return;
    if (guestMenu.open) guestMenu.close();
    trialLimit.showModal();
  }
  window.showGuestMenu = showGuestMenu;
  window.showTrialLimit = showTrialLimit;

  historyButton.addEventListener('click', (event) => {
    if (window.accessState?.authenticated || window.SharedConversation?.active) return;
    event.stopImmediatePropagation();
    showGuestMenu();
  }, true);
  trialRemaining.addEventListener('click', showGuestMenu);
  document.getElementById('guest-menu-close').addEventListener('click', () => guestMenu.close());
  document.getElementById('guest-menu-register').addEventListener('click', () => showAuth('register'));
  document.getElementById('guest-menu-login').addEventListener('click', () => showAuth('login'));
  document.getElementById('trial-limit-register').addEventListener('click', () => showAuth('register'));
  document.getElementById('trial-limit-login').addEventListener('click', () => showAuth('login'));
  trialLimit.addEventListener('cancel', (event) => event.preventDefault());
  backToApp.addEventListener('click', () => showTranslator(window.accessState));

  function setLoading(loading) {
    submitButton.disabled = loading;
    emailInput.disabled = loading;
    passwordInput.disabled = loading;
    companyInput.disabled = loading || mode === 'login';
    toggleButton.disabled = loading;
    if (loading) {
      submitButton.dataset.originalText = submitButton.textContent;
      submitButton.textContent = window.t(mode === 'login' ? 'auth.signingIn' : 'auth.creating');
    } else if (submitButton.dataset.originalText) {
      submitButton.textContent = submitButton.dataset.originalText;
    }
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    activeAuthError = null;
    errorEl.hidden = true;

    const email = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value;
    const company = companyInput.value.trim();

    if (!isValidEmail(email)) {
      setAuthError('auth.emailInvalid');
      return;
    }
    if (password.length < 8) {
      setAuthError('auth.passwordShort');
      return;
    }
    if (mode === 'register' && !company) {
      setAuthError('auth.companyRequired');
      companyInput.focus();
      return;
    }

    setLoading(true);
    try {
      const account = mode === 'login'
        ? await window.Api.login(email, password)
        : await window.Api.register(email, password, company);
      showTranslator({ ...account, authenticated: true });
    } catch (err) {
      setAuthError(err);
    } finally {
      setLoading(false);
    }
  });

  window.Api.me()
    .then((me) => showTranslator({ ...me, authenticated: true }))
    .catch(async () => {
      try {
        const trial = await window.Api.trial();
        showTranslator(trial);
      } catch (error) {
        showAuth('login', error);
      }
    });

  setMode('login');
  window.addEventListener('localechange', () => {
    setMode(mode, true);
    renderAuthError();
    if (window.accessState) historyButton.setAttribute('aria-label', window.t(window.accessState.authenticated ? 'history.open' : 'trial.menuOpen'));
    if (guestMenu.open) guestMenuStatus.textContent = window.t('trial.menuStatus').replace('{count}', window.accessState?.translationsRemaining ?? 0);
  });
})();
