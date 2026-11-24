import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runPipeline } from '../pipeline/src/pipeline.js';
import { FAKE_OPENAI_KEY, FAKE_SHOTSTACK_KEY, TONE_SECONDS, mockFetch, json, toneMp3, withEnv } from './helpers.js';

const SAMPLE = new URL('../pipeline/examples/sample-script.json', import.meta.url).pathname;
const ROOT = new URL('..', import.meta.url).pathname;
const MP4 = Buffer.from('fake-mp4-bytes');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9, 9]);

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tiktok-pipeline-'));
const quiet = () => {};

/** A fake OpenAI + Shotstack. `fail` lets a test break one endpoint. */
function fakeServices({ failImageCall } = {}) {
  let uploads = 0;
  let imageCalls = 0;
  let renderPolls = 0;
  const sources = new Map();
  return mockFetch((call) => {
    const { url, method } = call;
    if (url.endsWith('/images/generations')) {
      imageCalls += 1;
      if (imageCalls === failImageCall) return json({ error: { message: 'content policy' } }, 400);
      return json({ data: [{ b64_json: PNG.toString('base64') }] });
    }
    if (url.endsWith('/audio/speech')) return new Response(toneMp3);
    if (url.endsWith('/ingest/stage/upload')) {
      uploads += 1;
      const id = `up${uploads}`;
      sources.set(id, `https://cdn.test/${id}`);
      return json({ data: { id, attributes: { url: `https://signed.example/${id}` } } });
    }
    if (url.startsWith('https://signed.example/')) return new Response('', { status: 200 });
    if (url.includes('/ingest/stage/sources/')) {
      const id = url.split('/').pop();
      return json({ data: { attributes: { status: 'ready', source: sources.get(id) } } });
    }
    if (url.endsWith('/edit/stage/render') && method === 'POST') return json({ response: { id: 'render-1' } });
    if (url.endsWith('/edit/stage/render/render-1')) {
      renderPolls += 1;
      return json({ response: renderPolls < 2 ? { status: 'rendering' } : { status: 'done', url: 'https://cdn.test/final.mp4' } });
    }
    if (url === 'https://cdn.test/final.mp4') return new Response(MP4);
    return json({ error: `unexpected request ${method} ${url}` }, 404);
  });
}

const baseOptions = (outDir, extra = {}) => ({
  scriptPath: SAMPLE,
  outDir,
  confirm: true,
  renderPollMs: 1,
  log: quiet,
  ...extra
});

const keys = { OPENAI_API_KEY: FAKE_OPENAI_KEY, SHOTSTACK_API_KEY: FAKE_SHOTSTACK_KEY, SHOTSTACK_ENV: 'stage', RETRY_BASE_MS: '1' };

function allTextFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return allTextFiles(full);
    return /\.(json|txt)$/.test(entry.name) ? [full] : [];
  });
}

test('full run: script -> images + narration -> upload -> render -> MP4', async () => {
  const restore = withEnv(keys);
  const out = tempDir();
  const mock = fakeServices();
  try {
    const result = await runPipeline(baseOptions(out), process.env);
    assert.equal(result.status, 'done');
    assert.equal(result.url, 'https://cdn.test/final.mp4');

    // deliverables, including the file names the old workflow produced
    for (const file of ['roteiro.json', 'edit.json', 'metadata.json', 'video-link.txt', 'video.mp4']) {
      assert.ok(fs.existsSync(path.join(out, file)), `${file} missing`);
    }
    assert.deepEqual(fs.readFileSync(path.join(out, 'video.mp4')), MP4);
    assert.equal(fs.readdirSync(path.join(out, 'assets')).length, 12);

    // timeline: six scenes timed from the real narration length
    const edit = JSON.parse(fs.readFileSync(path.join(out, 'edit.json'), 'utf8'));
    const images = edit.timeline.tracks[1].clips;
    assert.equal(images.length, 6);
    assert.ok(images.every((clip) => clip.asset.src.startsWith('https://cdn.test/')));
    assert.ok(Math.abs(images[1].start - (TONE_SECONDS + 0.15)) < 0.02);
    assert.equal(edit.output.size.height, 1920);

    const meta = JSON.parse(fs.readFileSync(path.join(out, 'metadata.json'), 'utf8'));
    assert.equal(meta.render.id, 'render-1');
    assert.ok(meta.disclosure.length >= 2);
    assert.ok(meta.postText.includes('#poupaagua'));
  } finally {
    mock.restore();
    restore();
  }
});

test('keys go only to their own provider and never into output files', async () => {
  const restore = withEnv(keys);
  const out = tempDir();
  const mock = fakeServices();
  try {
    await runPipeline(baseOptions(out), process.env);
    for (const call of mock.calls) {
      const host = new URL(call.url).host;
      const sentKeys = JSON.stringify(call.headers) + (typeof call.body === 'string' ? call.body : '');
      if (host !== 'api.openai.com') assert.ok(!sentKeys.includes(FAKE_OPENAI_KEY), `OpenAI key sent to ${host}`);
      if (host !== 'api.shotstack.io') assert.ok(!sentKeys.includes(FAKE_SHOTSTACK_KEY), `Shotstack key sent to ${host}`);
      if (host === 'api.shotstack.io') assert.ok(!sentKeys.includes(FAKE_OPENAI_KEY));
    }
    for (const file of allTextFiles(out)) {
      const text = fs.readFileSync(file, 'utf8');
      assert.ok(!text.includes(FAKE_OPENAI_KEY) && !text.includes(FAKE_SHOTSTACK_KEY), `secret found in ${file}`);
    }
  } finally {
    mock.restore();
    restore();
  }
});

test('without --confirm nothing paid is generated', async () => {
  const restore = withEnv(keys);
  const out = tempDir();
  const mock = mockFetch(() => json({}, 500));
  try {
    const result = await runPipeline(baseOptions(out, { confirm: false }), process.env);
    assert.equal(result.status, 'script-only');
    assert.equal(mock.calls.length, 0, 'no network call may happen before confirmation');
    assert.ok(fs.existsSync(path.join(out, 'roteiro.json')));
    assert.ok(!fs.existsSync(path.join(out, 'video.mp4')));
  } finally {
    mock.restore();
    restore();
  }
});

test('a failed scene keeps the paid work and --resume does not pay twice', async () => {
  const restore = withEnv(keys);
  const out = tempDir();
  let mock = fakeServices({ failImageCall: 3 });
  try {
    await assert.rejects(runPipeline(baseOptions(out), process.env), (error) => {
      assert.match(error.message, /Cena \d: OpenAI API 400.*content policy/);
      assert.match(error.message, /--resume/);
      return true;
    });
    const pngs = fs.readdirSync(path.join(out, 'assets')).filter((f) => f.endsWith('.png'));
    assert.equal(pngs.length, 5, 'the five successful images must be kept');
    assert.ok(!fs.existsSync(path.join(out, 'video.mp4')));
  } finally {
    mock.restore();
  }

  mock = fakeServices();
  try {
    const result = await runPipeline(baseOptions(out, { resume: true }), process.env);
    assert.equal(result.status, 'done');
    const imageCalls = mock.calls.filter((call) => call.url.endsWith('/images/generations')).length;
    const speechCalls = mock.calls.filter((call) => call.url.endsWith('/audio/speech')).length;
    assert.equal(imageCalls, 1, 'only the missing image is generated again');
    // The scene whose image failed never reached its narration, so exactly that one is new;
    // the other five narrations on disk are reused.
    assert.equal(speechCalls, 1, 'only the failed scene needs narration');
  } finally {
    mock.restore();
    restore();
  }
});

test('a missing key is reported before any paid call', async () => {
  const restore = withEnv({ ...keys, OPENAI_API_KEY: undefined });
  const mock = mockFetch(() => json({}, 500));
  try {
    await assert.rejects(runPipeline(baseOptions(tempDir()), process.env), /Missing OPENAI_API_KEY/);
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
    restore();
  }
});

test('CLI dry-run works with no keys and no network, and --help prints usage', () => {
  const out = tempDir();
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.SHOTSTACK_API_KEY;

  const run = spawnSync(process.execPath, ['pipeline/src/run.js', '--dry-run', '--out', out], { cwd: ROOT, env, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const edit = JSON.parse(fs.readFileSync(path.join(out, 'edit.dry-run.json'), 'utf8'));
  assert.equal(edit.timeline.tracks[2].clips.length, 6);

  const help = spawnSync(process.execPath, ['pipeline/src/run.js', '--help'], { cwd: ROOT, env, encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--confirm/);

  const bad = spawnSync(process.execPath, ['pipeline/src/run.js', '--topic', 'x', '--duration', '500'], { cwd: ROOT, env, encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /--duration/);
});
