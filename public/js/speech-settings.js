(() => {
  const $ = id => document.getElementById(id);
  const selector = $('speech-voice');
  const dialog = $('speech-settings-dialog');
  const error = $('speech-settings-error');
  let voices = [];
  let selected;
  let loading;
  let loaded = false;
  window.getSpeechVoice = () => selected;

  async function loadVoices() {
    if (loaded) return;
    if (loading) return loading;
    selector.disabled = true; error.hidden = true;
    loading = (async () => {
      try {
        const data = await window.Api.voices();
        voices = data.voices;
        const saved = localStorage.getItem('speech-voice');
        selected = voices.some(voice => voice.id === saved) ? saved : data.defaultVoice;
        selector.replaceChildren(...voices.map(voice => {
          const option = document.createElement('option'); option.value = voice.id; option.textContent = voice.name; return option;
        }));
        selector.value = selected; localStorage.setItem('speech-voice', selected);
        loaded = true; selector.disabled = false;
      } catch {
        error.textContent = window.t('speech.loadError'); error.hidden = false;
      } finally { loading = null; }
    })();
    return loading;
  }
  selector.addEventListener('change', () => {
    const value = selector.value;
    if (!voices.some(voice => voice.id === value)) { selector.value = selected; return; }
    window.stopSpeech?.(); selected = value; localStorage.setItem('speech-voice', selected);
  });
  $('speech-settings-open').addEventListener('click', async () => { dialog.showModal(); await loadVoices(); });
  $('speech-settings-close').addEventListener('click', () => dialog.close());
  window.addEventListener('authenticated', loadVoices);
  window.addEventListener('localechange', () => { if (!error.hidden) error.textContent = window.t('speech.loadError'); });
  if (window.accessState) loadVoices();
})();
