// public/js/voice.js
(() => {
  const micBtn = document.getElementById('mic-btn');
  const textInput = document.getElementById('text-input');

  const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;

  function speakText(text, languageName) {
    if (!('speechSynthesis' in window)) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = window.codeForLanguage(languageName);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }
  window.speakText = speakText;

  if (!SpeechRecognitionImpl) {
    micBtn.hidden = true;
    return;
  }

  let sttLang = 'ru-RU';
  let recognizing = false;
  let recognition = null;

  function currentTargetCode() {
    const pairText = document.getElementById('pair-indicator').textContent;
    const match = pairText.match(/↔ (.+)$/);
    return match ? window.codeForLanguage(match[1]) : 'ru-RU';
  }

  micBtn.addEventListener('click', () => {
    if (recognizing) {
      recognition.stop();
      return;
    }

    sttLang = sttLang === 'ru-RU' ? currentTargetCode() : 'ru-RU';
    recognition = new SpeechRecognitionImpl();
    recognition.lang = sttLang;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      recognizing = true;
      micBtn.classList.add('recording');
    };
    recognition.onend = () => {
      recognizing = false;
      micBtn.classList.remove('recording');
    };
    recognition.onerror = () => {
      recognizing = false;
      micBtn.classList.remove('recording');
    };
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      textInput.value = transcript;
      textInput.focus();
    };

    recognition.start();
  });
})();
