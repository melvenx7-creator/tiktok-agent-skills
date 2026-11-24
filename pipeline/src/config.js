// Central configuration. Nothing here stores or prints secret values.

// Google Fonts file used in Shotstack's own rich-caption example. Latin Extended,
// so Portuguese accents render. Override with CAPTION_FONT_URL / CAPTION_FONT_FAMILY.
const DEFAULT_FONT_URL =
  'https://fonts.gstatic.com/s/spacegrotesk/v22/V8mDoQDjQSkFtoMM3T6r8E7mDbZyCts0DqQ.ttf';
const DEFAULT_FONT_FAMILY = 'V8mDoQDjQSkFtoMM3T6r8E7mDbZyCts0DqQ';

export const TTS_SHUTDOWN_DATE = '2027-01-06';
const SHUTTING_DOWN_TTS = ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'];

export function loadConfig(env = process.env) {
  return {
    openai: {
      apiKey: env.OPENAI_API_KEY,
      // Defaults follow OpenAI's docs at the time of writing. Override via env.
      textModel: env.OPENAI_TEXT_MODEL || 'gpt-6.2-astra',
      imageModel: env.OPENAI_IMAGE_MODEL || 'gpt-image-2.5-flare',
      imageSize: env.OPENAI_IMAGE_SIZE || '1024x1536',
      imageQuality: env.OPENAI_IMAGE_QUALITY || 'medium',
      ttsModel: env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
      ttsVoice: env.OPENAI_TTS_VOICE || 'marin',
      retryBaseMs: Number(env.RETRY_BASE_MS) || 1000
    },
    captions: {
      fontUrl: env.CAPTION_FONT_URL || DEFAULT_FONT_URL,
      fontFamily: env.CAPTION_FONT_FAMILY || DEFAULT_FONT_FAMILY
    }
  };
}

export function requireKey(value, name) {
  if (!value || value === 'replace_me') {
    throw new Error(`Missing ${name}. Copy .env.example to .env and add your key (or set it as a secret).`);
  }
  return value;
}

/** A warning string when the configured TTS model is on OpenAI's shutdown list. */
export function ttsShutdownWarning(model, now = new Date()) {
  if (!SHUTTING_DOWN_TTS.includes(model)) return null;
  const passed = now >= new Date(`${TTS_SHUTDOWN_DATE}T00:00:00Z`);
  return passed
    ? `OpenAI TTS model "${model}" was scheduled to shut down on ${TTS_SHUTDOWN_DATE} and may no longer work. Set OPENAI_TTS_MODEL to a supported model or provider.`
    : `OpenAI's docs list TTS model "${model}" as shutting down on ${TTS_SHUTDOWN_DATE}. Narration will stop working after that date unless you switch models/providers.`;
}
