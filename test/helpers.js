import fs from 'node:fs';

export const FAKE_OPENAI_KEY = 'sk-test-secret-0123456789abcdef';
export const FAKE_SHOTSTACK_KEY = 'ss-test-secret-0123456789';

export const toneMp3 = fs.readFileSync(new URL('./fixtures/tone.mp3', import.meta.url));
export const TONE_SECONDS = 1.56; // verified with ffprobe

/**
 * Replace global fetch with `handler(url, init)`; every call is recorded.
 * `handler` returns a Response. Call `restore()` when finished.
 */
export function mockFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const call = { url: String(url), method: init.method || 'GET', headers: { ...(init.headers || {}) }, body: init.body };
    calls.push(call);
    return handler(call);
  };
  return { calls, restore: () => (globalThis.fetch = original) };
}

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/** Set env vars for a test and return a function that restores the previous values. */
export function withEnv(vars) {
  const previous = {};
  for (const [name, value] of Object.entries(vars)) {
    previous[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  return () => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}

export const openaiConfig = (overrides = {}) => ({
  apiKey: FAKE_OPENAI_KEY,
  textModel: 'test-text',
  imageModel: 'test-image',
  imageSize: '1024x1536',
  imageQuality: 'medium',
  ttsModel: 'gpt-4o-mini-tts',
  ttsVoice: 'marin',
  retryBaseMs: 1,
  ...overrides
});
