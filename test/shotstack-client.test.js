import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAKE_SHOTSTACK_KEY, mockFetch, json, withEnv } from './helpers.js';

const client = await import('../integrations/shotstack/src/client.js');

test('existing exports are still available', () => {
  for (const name of ['submitRender', 'getRenderStatus', 'currentEnvironment']) {
    assert.equal(typeof client[name], 'function', `${name} must still be exported`);
  }
});

test('importing the client without a key does not throw; using it does', async () => {
  const restore = withEnv({ SHOTSTACK_API_KEY: undefined });
  try {
    await assert.rejects(client.getRenderStatus('abc'), /Missing SHOTSTACK_API_KEY/);
  } finally {
    restore();
  }
});

test('rejects an unknown environment', async () => {
  const restore = withEnv({ SHOTSTACK_API_KEY: FAKE_SHOTSTACK_KEY, SHOTSTACK_ENV: 'live' });
  try {
    await assert.rejects(client.getRenderStatus('abc'), /must be "stage" or "production"/);
  } finally {
    restore();
  }
});

test('stage and production use different base URLs', async () => {
  for (const [env, expected] of [
    ['stage', 'https://api.shotstack.io/edit/stage/render/r1'],
    ['production', 'https://api.shotstack.io/edit/v1/render/r1']
  ]) {
    const restore = withEnv({ SHOTSTACK_API_KEY: FAKE_SHOTSTACK_KEY, SHOTSTACK_ENV: env });
    const mock = mockFetch(() => json({ response: { status: 'queued' } }));
    try {
      await client.getRenderStatus('r1');
      assert.equal(mock.calls[0].url, expected);
      assert.equal(mock.calls[0].headers['x-api-key'], FAKE_SHOTSTACK_KEY);
    } finally {
      mock.restore();
      restore();
    }
  }
});

test('API errors include the status and detail', async () => {
  const restore = withEnv({ SHOTSTACK_API_KEY: FAKE_SHOTSTACK_KEY, SHOTSTACK_ENV: 'stage' });
  const mock = mockFetch(() => json({ response: { error: 'bad edit' } }, 400));
  try {
    await assert.rejects(client.submitRender({ timeline: {}, output: {} }), /Shotstack API 400: bad edit/);
    await assert.rejects(client.submitRender({}), /must include timeline and output/);
  } finally {
    mock.restore();
    restore();
  }
});

test('uploadAsset: signed URL, raw PUT without the API key, then polls until ready', async () => {
  const restore = withEnv({ SHOTSTACK_API_KEY: FAKE_SHOTSTACK_KEY, SHOTSTACK_ENV: 'stage' });
  let polls = 0;
  const mock = mockFetch((call) => {
    if (call.url === 'https://api.shotstack.io/ingest/stage/upload') {
      return json({ data: { type: 'upload', id: 'up1', attributes: { url: 'https://signed.example/put?sig=1' } } });
    }
    if (call.url.startsWith('https://signed.example/')) return new Response('', { status: 200 });
    if (call.url === 'https://api.shotstack.io/ingest/stage/sources/up1') {
      polls += 1;
      return json({ data: { attributes: polls < 2 ? { status: 'queued' } : { status: 'ready', source: 'https://cdn.test/up1.png' } } });
    }
    return json({}, 404);
  });
  try {
    const bytes = Buffer.from([1, 2, 3]);
    const url = await client.uploadAsset(bytes, { pollMs: 1 });
    assert.equal(url, 'https://cdn.test/up1.png');
    assert.equal(polls, 2);

    const put = mock.calls.find((call) => call.url.startsWith('https://signed.example/'));
    assert.equal(put.method, 'PUT');
    assert.deepEqual(put.body, bytes);
    assert.ok(!('x-api-key' in put.headers), 'API key must never be sent to the signed upload host');

    const create = mock.calls.find((call) => call.url.endsWith('/ingest/stage/upload'));
    assert.equal(create.method, 'POST');
    assert.equal(create.headers['x-api-key'], FAKE_SHOTSTACK_KEY);
  } finally {
    mock.restore();
    restore();
  }
});

test('uploadAsset reports failed uploads and failed ingestion', async () => {
  const restore = withEnv({ SHOTSTACK_API_KEY: FAKE_SHOTSTACK_KEY, SHOTSTACK_ENV: 'stage' });
  let mock = mockFetch((call) =>
    call.url.endsWith('/upload') ? json({ data: { id: 'u', attributes: { url: 'https://signed.example/x' } } }) : new Response('', { status: 403 })
  );
  try {
    await assert.rejects(client.uploadAsset(Buffer.from('x')), /upload failed with status 403/);
  } finally {
    mock.restore();
  }

  mock = mockFetch((call) => {
    if (call.url.endsWith('/upload')) return json({ data: { id: 'u', attributes: { url: 'https://signed.example/x' } } });
    if (call.url.startsWith('https://signed.example/')) return new Response('');
    return json({ data: { attributes: { status: 'failed', error: 'unsupported file' } } });
  });
  try {
    await assert.rejects(client.uploadAsset(Buffer.from('x'), { pollMs: 1 }), /could not ingest the file: unsupported file/);
  } finally {
    mock.restore();
    restore();
  }
});

test('waitForRender resolves with the URL once done, and throws on failure or timeout', async () => {
  const restore = withEnv({ SHOTSTACK_API_KEY: FAKE_SHOTSTACK_KEY, SHOTSTACK_ENV: 'stage' });
  const statuses = ['queued', 'rendering', 'done'];
  let mock = mockFetch(() => {
    const status = statuses.shift();
    return json({ response: { status, url: status === 'done' ? 'https://cdn.test/out.mp4' : undefined } });
  });
  try {
    const seen = [];
    const result = await client.waitForRender('r1', { intervalMs: 1, onStatus: (s) => seen.push(s) });
    assert.equal(result.url, 'https://cdn.test/out.mp4');
    assert.deepEqual(seen, ['queued', 'rendering', 'done']);
  } finally {
    mock.restore();
  }

  mock = mockFetch(() => json({ response: { status: 'failed', error: 'clip not found' } }));
  try {
    await assert.rejects(client.waitForRender('r1', { intervalMs: 1 }), /render failed: clip not found/);
  } finally {
    mock.restore();
  }

  mock = mockFetch(() => json({ response: { status: 'rendering' } }));
  try {
    await assert.rejects(client.waitForRender('r1', { intervalMs: 1, timeoutMs: 5 }), /Timed out/);
  } finally {
    mock.restore();
    restore();
  }
});

test('listModels calls the models catalogue with options expanded', async () => {
  const restore = withEnv({ SHOTSTACK_API_KEY: FAKE_SHOTSTACK_KEY, SHOTSTACK_ENV: 'stage' });
  const mock = mockFetch(() => json({ response: { models: [] } }));
  try {
    await client.listModels();
    assert.equal(mock.calls[0].url, 'https://api.shotstack.io/edit/stage/models?expand=options');
  } finally {
    mock.restore();
    restore();
  }
});
