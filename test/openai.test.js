import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateScript, generateImage, synthesizeSpeech, voiceInstructions } from '../pipeline/src/openai.js';
import { FAKE_OPENAI_KEY, mockFetch, json, openaiConfig, toneMp3 } from './helpers.js';

const scriptJson = {
  title: 'Titulo',
  hook: 'Gancho',
  description: 'Descricao',
  scenes: [
    { narration: 'Frase um.', visual: 'A lighthouse at dawn' },
    { narration: 'Frase dois.', visual: 'A fishing boat' }
  ],
  hashtags: ['#mar']
};
const scriptResponse = (text) => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });

test('generateScript sends a strict JSON-schema request and validates the result', async () => {
  const mock = mockFetch(() => json(scriptResponse(JSON.stringify(scriptJson))));
  try {
    const script = await generateScript(openaiConfig(), { topic: 'Faróis', language: 'pt-PT', durationSec: 20, sceneCount: 2 });
    const [call] = mock.calls;
    assert.equal(call.url, 'https://api.openai.com/v1/responses');
    assert.equal(call.headers.Authorization, `Bearer ${FAKE_OPENAI_KEY}`);
    const body = JSON.parse(call.body);
    assert.equal(body.model, 'test-text');
    assert.equal(body.text.format.type, 'json_schema');
    assert.equal(body.text.format.strict, true);
    assert.equal(body.text.format.schema.additionalProperties, false);
    assert.match(body.input[0].content, /exactly 2 scenes/);
    assert.match(body.input[0].content, /pt-PT/);
    assert.equal(script.script, 'Frase um. Frase dois.');
    assert.equal(script.scenes.length, 2);
  } finally {
    mock.restore();
  }
});

test('generateScript tolerates a fenced JSON reply', async () => {
  const mock = mockFetch(() => json(scriptResponse('```json\n' + JSON.stringify(scriptJson) + '\n```')));
  try {
    assert.equal((await generateScript(openaiConfig(), { topic: 'x' })).title, 'Titulo');
  } finally {
    mock.restore();
  }
});

test('generateScript surfaces refusals, truncation and bad JSON', async () => {
  const cases = [
    [{ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }, /declined/],
    [{ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] }, /incomplete.*max_output_tokens/],
    [scriptResponse('not json'), /not valid JSON/]
  ];
  for (const [response, pattern] of cases) {
    const mock = mockFetch(() => json(response));
    try {
      await assert.rejects(generateScript(openaiConfig(), { topic: 'x' }), pattern);
    } finally {
      mock.restore();
    }
  }
});

test('requests retry on 5xx and 429 but not on 4xx', async () => {
  let attempts = 0;
  const flaky = mockFetch(() => (++attempts < 3 ? json({ error: { message: 'busy' } }, attempts === 1 ? 500 : 429) : json(scriptResponse(JSON.stringify(scriptJson)))));
  try {
    await generateScript(openaiConfig(), { topic: 'x' });
    assert.equal(flaky.calls.length, 3);
  } finally {
    flaky.restore();
  }

  const bad = mockFetch(() => json({ error: { message: 'bad request' } }, 400));
  try {
    await assert.rejects(generateScript(openaiConfig(), { topic: 'x' }), /400.*bad request/);
    assert.equal(bad.calls.length, 1);
  } finally {
    bad.restore();
  }
});

test('API error messages never leak the key', async () => {
  const mock = mockFetch(() => json({ error: { message: `Incorrect API key provided: ${FAKE_OPENAI_KEY}` } }, 401));
  const saved = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = FAKE_OPENAI_KEY;
  try {
    await assert.rejects(generateScript(openaiConfig(), { topic: 'x' }), (error) => {
      assert.ok(!error.message.includes(FAKE_OPENAI_KEY), 'key leaked into error message');
      return true;
    });
  } finally {
    if (saved === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = saved;
    mock.restore();
  }
});

test('a missing key fails before any request is made', async () => {
  const mock = mockFetch(() => json({}));
  try {
    await assert.rejects(generateScript(openaiConfig({ apiKey: undefined }), { topic: 'x' }), /Missing OPENAI_API_KEY/);
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

test('generateImage requests a portrait image and decodes base64', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const mock = mockFetch(() => json({ data: [{ b64_json: png.toString('base64') }] }));
  try {
    const image = await generateImage(openaiConfig(), 'A red kite');
    assert.deepEqual(image, png);
    const body = JSON.parse(mock.calls[0].body);
    assert.equal(mock.calls[0].url, 'https://api.openai.com/v1/images/generations');
    assert.equal(body.model, 'test-image');
    assert.equal(body.size, '1024x1536');
    assert.match(body.prompt, /A red kite/);
    assert.match(body.prompt, /Do not include any text/);
  } finally {
    mock.restore();
  }
});

test('synthesizeSpeech asks for mp3 and only sends instructions to gpt-4o models', async () => {
  const mock = mockFetch(() => new Response(toneMp3));
  try {
    const audio = await synthesizeSpeech(openaiConfig(), 'Olá!', { instructions: 'Fala devagar.' });
    assert.deepEqual(audio, toneMp3);
    const body = JSON.parse(mock.calls[0].body);
    assert.equal(mock.calls[0].url, 'https://api.openai.com/v1/audio/speech');
    assert.equal(body.response_format, 'mp3');
    assert.equal(body.voice, 'marin');
    assert.equal(body.instructions, 'Fala devagar.');

    await synthesizeSpeech(openaiConfig({ ttsModel: 'tts-1' }), 'Olá!', { instructions: 'Fala devagar.' });
    assert.equal(JSON.parse(mock.calls[1].body).instructions, undefined);
  } finally {
    mock.restore();
  }
});

test('synthesizeSpeech rejects empty or oversized text', async () => {
  await assert.rejects(synthesizeSpeech(openaiConfig(), '   '), /empty/);
  await assert.rejects(synthesizeSpeech(openaiConfig(), 'a'.repeat(4001)), /4000/);
});

test('voiceInstructions covers accent, pace and the user request', () => {
  const text = voiceInstructions({ language: 'pt-PT', style: 'Voz feminina e calma.' });
  assert.match(text, /European Portuguese/);
  assert.match(text, /pace/);
  assert.match(text, /Voz feminina e calma\./);
  assert.match(voiceInstructions({ language: 'fr-FR' }), /fr-FR/);
});
