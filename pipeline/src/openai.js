import { redact, withRetry } from './util.js';
import { requireKey } from './config.js';
import { validateScript } from './script.js';

const API = 'https://api.openai.com/v1';

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const isRetryable = (error) => error.status === undefined || error.status === 429 || error.status >= 500;

async function post(cfg, path, body, { binary = false } = {}) {
  const key = requireKey(cfg.apiKey, 'OPENAI_API_KEY');
  return withRetry(
    async () => {
      const response = await fetch(`${API}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const raw = await response.text().catch(() => '');
        let detail = raw;
        try {
          detail = JSON.parse(raw)?.error?.message || raw;
        } catch {
          /* body was not JSON */
        }
        throw new ApiError(`OpenAI API ${response.status} on ${path}: ${redact(detail).slice(0, 500)}`, response.status);
      }
      return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
    },
    { baseMs: cfg.retryBaseMs, isRetryable }
  );
}

// ---------------------------------------------------------------- script

export const SCRIPT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    hook: { type: 'string' },
    description: { type: 'string' },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { narration: { type: 'string' }, visual: { type: 'string' } },
        required: ['narration', 'visual'],
        additionalProperties: false
      }
    },
    hashtags: { type: 'array', items: { type: 'string' } }
  },
  required: ['title', 'hook', 'description', 'scenes', 'hashtags'],
  additionalProperties: false
};

function extractText(response) {
  if (response?.status === 'incomplete') {
    throw new Error(`OpenAI response was incomplete: ${response.incomplete_details?.reason || 'unknown reason'}.`);
  }
  const parts = (response?.output || []).filter((item) => item.type === 'message').flatMap((item) => item.content || []);
  const refusal = parts.find((part) => part.type === 'refusal');
  if (refusal) throw new Error(`OpenAI declined to write this script: ${refusal.refusal}`);
  const text = parts.find((part) => part.type === 'output_text')?.text ?? response?.output_text;
  if (!text) throw new Error('OpenAI did not return a script.');
  return text;
}

export async function generateScript(cfg, { topic, language = 'pt-PT', durationSec = 30, sceneCount = 6, audience, tone }) {
  if (!topic || !topic.trim()) throw new Error('A topic is required to generate a script.');
  const words = Math.round(durationSec * 2.5);
  const system = [
    'You write short-form vertical video scripts for TikTok.',
    `- Write title, hook, description and every "narration" in ${language}.`,
    '- Write every "visual" in English: it is a prompt for an image generator.',
    '- Scene 1 narration is a truthful hook that earns the next few seconds. No misleading claims, invented statistics or guarantees.',
    `- Use exactly ${sceneCount} scenes. Total narration is about ${words} words (about ${durationSec} seconds spoken). Each scene is one or two short sentences.`,
    '- Each "visual" describes one vertical 9:16 still image: subject, setting, lighting, style. Keep the subject centred with empty margins. No text, letters, logos, watermarks, real people or copyrighted characters in the image.',
    '- The last scene closes with a memorable line or a call to action.',
    '- "hashtags": 5 to 8 relevant hashtags, each starting with #.'
  ].join('\n');
  const user = [`Topic: ${topic.trim()}`, audience && `Audience: ${audience}`, tone && `Tone: ${tone}`].filter(Boolean).join('\n');

  const response = await post(cfg, '/responses', {
    model: cfg.textModel,
    input: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    text: { format: { type: 'json_schema', name: 'tiktok_script', schema: SCRIPT_SCHEMA, strict: true } },
    max_output_tokens: 4000
  });

  const raw = extractText(response).replace(/^```json\s*|\s*```$/g, '');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('OpenAI returned a script that is not valid JSON.');
  }
  return validateScript(parsed);
}

// ---------------------------------------------------------------- images

const IMAGE_STYLE =
  'Vertical 9:16 composition, cinematic and high detail, subject centred with generous empty margins at top and bottom. ' +
  'Do not include any text, letters, numbers, logos or watermarks.';

export async function generateImage(cfg, visual) {
  const data = await post(cfg, '/images/generations', {
    model: cfg.imageModel,
    prompt: `${visual}\n\n${IMAGE_STYLE}`,
    size: cfg.imageSize,
    quality: cfg.imageQuality,
    n: 1
  });
  const item = data?.data?.[0];
  if (item?.b64_json) return Buffer.from(item.b64_json, 'base64');
  if (item?.url) {
    const download = await fetch(item.url);
    if (!download.ok) throw new Error(`Could not download the generated image (status ${download.status}).`);
    return Buffer.from(await download.arrayBuffer());
  }
  throw new Error('OpenAI did not return an image.');
}

// ---------------------------------------------------------------- narration

const LANGUAGE_LABELS = {
  'pt-PT': 'European Portuguese (Portugal)',
  'pt-BR': 'Brazilian Portuguese',
  'en-US': 'American English',
  'en-GB': 'British English'
};

/** Accent/tone/pace instructions, derived from the language and the user's voice request. */
export function voiceInstructions({ language = 'pt-PT', style } = {}) {
  const label = LANGUAGE_LABELS[language] || language;
  return [
    `Speak in ${label} with a native accent.`,
    'Warm, energetic and natural delivery at a brisk pace suited to short vertical videos, with brief pauses between sentences.',
    style
  ]
    .filter(Boolean)
    .join(' ');
}

export async function synthesizeSpeech(cfg, text, { instructions } = {}) {
  if (!text || !text.trim()) throw new Error('Narration text is empty.');
  if (text.length > 4000) throw new Error('Narration text is longer than the 4000 character limit.');
  const body = { model: cfg.ttsModel, input: text, voice: cfg.ttsVoice, response_format: 'mp3' };
  // Only the gpt-4o TTS family accepts accent/tone/pace instructions.
  if (instructions && cfg.ttsModel.startsWith('gpt-4o')) body.instructions = instructions;
  return post(cfg, '/audio/speech', body, { binary: true });
}
