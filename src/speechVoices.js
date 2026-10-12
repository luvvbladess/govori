const VOICE_IDS = Object.freeze([
  'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx',
  'nova', 'sage', 'shimmer', 'verse', 'marin', 'cedar',
]);
const SPEECH_VOICES = Object.freeze(VOICE_IDS.map(id => Object.freeze({
  id, name: id[0].toUpperCase() + id.slice(1),
})));

function isSpeechVoice(voice) {
  return typeof voice === 'string' && VOICE_IDS.includes(voice);
}

function getDefaultVoice() {
  return isSpeechVoice(process.env.TTS_VOICE) ? process.env.TTS_VOICE : 'marin';
}

function getSpeechModel() {
  return process.env.TTS_MODEL || 'gpt-4o-mini-tts';
}

module.exports = { SPEECH_VOICES, isSpeechVoice, getDefaultVoice, getSpeechModel };
