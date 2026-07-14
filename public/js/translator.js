// public/js/translator.js
(() => {
  const LANGUAGES = [
    { name: 'Русский', code: 'ru-RU' },
    { name: 'Английский', code: 'en-US' },
    { name: 'Китайский', code: 'zh-CN' },
    { name: 'Испанский', code: 'es-ES' },
    { name: 'Немецкий', code: 'de-DE' },
    { name: 'Французский', code: 'fr-FR' },
    { name: 'Японский', code: 'ja-JP' },
    { name: 'Корейский', code: 'ko-KR' },
    { name: 'Арабский', code: 'ar-SA' },
    { name: 'Турецкий', code: 'tr-TR' },
    { name: 'Итальянский', code: 'it-IT' },
    { name: 'Португальский', code: 'pt-PT' },
    { name: 'Вьетнамский', code: 'vi-VN' },
    { name: 'Тайский', code: 'th-TH' },
    { name: 'Хинди', code: 'hi-IN' },
    { name: 'Польский', code: 'pl-PL' },
  ];
  window.TRANSLATOR_LANGUAGES = LANGUAGES;

  function codeForLanguage(name) {
    const found = LANGUAGES.find((l) => l.name === name);
    return found ? found.code : 'ru-RU';
  }
  window.codeForLanguage = codeForLanguage;

  const pairIndicator = document.getElementById('pair-indicator');
  const feed = document.getElementById('feed');
  const textInput = document.getElementById('text-input');
  const sendBtn = document.getElementById('send-btn');
  const changeLanguageBtn = document.getElementById('change-language-btn');
  const languageDialog = document.getElementById('language-dialog');
  const languageList = document.getElementById('language-list');
  const languageDialogClose = document.getElementById('language-dialog-close');

  let currentTargetLanguage = null;

  function updatePairIndicator() {
    pairIndicator.textContent = currentTargetLanguage
      ? `Русский ↔ ${currentTargetLanguage}`
      : 'Язык собеседника не задан';
  }

  function addCard(label, language, text) {
    const card = document.createElement('div');
    card.className = 'card';
    const labelEl = document.createElement('div');
    labelEl.className = 'label';
    labelEl.textContent = `${label} (${language})`;
    const textEl = document.createElement('div');
    textEl.className = 'text';
    textEl.textContent = text;
    card.appendChild(labelEl);
    card.appendChild(textEl);
    feed.appendChild(card);
    return card;
  }

  function addTranslationCard(sourceLanguage, targetLanguage, original, translation, voiceText) {
    addCard('Оригинал', sourceLanguage, original);
    const translationCard = addCard('Перевод', targetLanguage, translation);
    const playBtn = document.createElement('button');
    playBtn.className = 'play-btn';
    playBtn.textContent = '🔊';
    playBtn.addEventListener('click', () => window.speakText(voiceText, targetLanguage));
    translationCard.appendChild(playBtn);
    feed.scrollTop = feed.scrollHeight;
  }

  function addErrorCard(message) {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.color = '#ff3b30';
    card.textContent = message;
    feed.appendChild(card);
    feed.scrollTop = feed.scrollHeight;
  }

  async function sendText(text) {
    if (!text.trim()) return;
    try {
      const result = await window.Api.translate(text);
      currentTargetLanguage = result.session.targetLanguage;
      updatePairIndicator();
      addTranslationCard(result.sourceLanguage, result.targetLanguage, result.original, result.translation, result.voiceText);
    } catch (err) {
      addErrorCard(err.message);
    }
  }

  sendBtn.addEventListener('click', () => {
    const text = textInput.value;
    textInput.value = '';
    sendText(text);
  });

  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendBtn.click();
    }
  });

  changeLanguageBtn.addEventListener('click', () => {
    languageList.innerHTML = '';
    for (const lang of LANGUAGES) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.textContent = lang.name;
      btn.addEventListener('click', async () => {
        try {
          await window.Api.setLanguage(lang.name);
          currentTargetLanguage = lang.name;
          updatePairIndicator();
          languageDialog.close();
        } catch (err) {
          addErrorCard(err.message);
        }
      });
      li.appendChild(btn);
      languageList.appendChild(li);
    }
    languageDialog.showModal();
  });

  languageDialogClose.addEventListener('click', () => languageDialog.close());

  window.addEventListener('authenticated', async () => {
    try {
      const me = await window.Api.me();
      currentTargetLanguage = me.targetLanguage;
      updatePairIndicator();
    } catch {
      // stays on the auth screen if this somehow fires without a session
    }
  });
})();
