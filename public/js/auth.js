// public/js/auth.js
(() => {
  const form = document.getElementById('auth-form');
  const emailInput = document.getElementById('auth-email');
  const passwordInput = document.getElementById('auth-password');
  const submitButton = document.getElementById('auth-submit');
  const toggleButton = document.getElementById('auth-toggle-mode');
  const errorEl = document.getElementById('auth-error');
  const authScreen = document.getElementById('auth-screen');
  const translatorScreen = document.getElementById('translator-screen');

  let mode = 'login';

  function setMode(next) {
    mode = next;
    submitButton.textContent = mode === 'login' ? 'Войти' : 'Зарегистрироваться';
    toggleButton.textContent = mode === 'login' ? 'Нет аккаунта? Зарегистрироваться' : 'Уже есть аккаунт? Войти';
  }

  toggleButton.addEventListener('click', () => setMode(mode === 'login' ? 'register' : 'login'));

  function showTranslator() {
    authScreen.hidden = true;
    translatorScreen.hidden = false;
    window.dispatchEvent(new CustomEvent('authenticated'));
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    try {
      if (mode === 'login') {
        await window.Api.login(email, password);
      } else {
        await window.Api.register(email, password);
      }
      showTranslator();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  });

  window.Api.me()
    .then(showTranslator)
    .catch(() => {});

  setMode('login');
})();
