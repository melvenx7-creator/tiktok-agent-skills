import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mp3DurationSeconds, wavDurationSeconds } from '../pipeline/src/audio.js';
import { buildEdit, estimateDurationSeconds, SCENE_GAP, END_PAD } from '../pipeline/src/edit.js';
import { validateScript } from '../pipeline/src/script.js';
import { ttsShutdownWarning } from '../pipeline/src/config.js';
import { redact } from '../pipeline/src/util.js';

const fixture = (name) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

test('mp3 duration matches ffprobe (with and without an ID3 tag)', () => {
  assert.ok(Math.abs(mp3DurationSeconds(fixture('tone.mp3')) - 1.56) < 0.01);
  assert.ok(Math.abs(mp3DurationSeconds(fixture('tone-id3.mp3')) - 2.256) < 0.01);
});

test('mp3 duration rejects data that is not MP3', () => {
  assert.throws(() => mp3DurationSeconds(Buffer.from('not audio at all')), /no valid audio frames/);
});

test('wav duration is read from the header', () => {
  const sampleRate = 24000;
  const data = Buffer.alloc(sampleRate * 2 * 3); // 3 s, 16-bit mono
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  assert.equal(wavDurationSeconds(Buffer.concat([header, data])), 3);
});

const scenes = [
  { imageUrl: 'https://cdn.test/1.png', audioUrl: 'https://cdn.test/1.mp3', duration: 3 },
  { imageUrl: 'https://cdn.test/2.png', audioUrl: 'https://cdn.test/2.mp3', duration: 4.2 },
  { imageUrl: 'https://cdn.test/3.png', audioUrl: 'https://cdn.test/3.mp3', duration: 2.5 }
];

test('buildEdit produces a 1080x1920 MP4 with three layers', () => {
  const { edit } = buildEdit(scenes, { fontUrl: 'https://f.test/a.ttf', fontFamily: 'abc' });
  assert.deepEqual(edit.output, { format: 'mp4', size: { width: 1080, height: 1920 }, fps: 30 });
  assert.deepEqual(
    edit.timeline.tracks.map((track) => track.clips[0].asset.type),
    ['rich-caption', 'image', 'audio']
  );
  assert.deepEqual(edit.timeline.fonts, [{ src: 'https://f.test/a.ttf' }]);
});

test('buildEdit plays scenes back to back using measured durations', () => {
  const { edit, totalSeconds } = buildEdit(scenes, {});
  const images = edit.timeline.tracks[1].clips;
  assert.deepEqual(images.map((clip) => clip.start), [0, 3.15, 7.5]);
  // literals on purpose: the builder rounds to 2 decimals, plain float addition would not
  assert.equal(SCENE_GAP, 0.15);
  assert.equal(END_PAD, 0.5);
  assert.deepEqual(images.map((clip) => clip.length), [3.15, 4.35, 3]);
  assert.equal(totalSeconds, 10.5);
  // audio starts with its image
  const audio = edit.timeline.tracks[2].clips;
  assert.deepEqual(audio.map((clip) => clip.start), [0, 3.15, 7.5]);
});

test('each caption is tied to its own narration clip by alias', () => {
  const { edit } = buildEdit(scenes, {});
  edit.timeline.tracks[0].clips.forEach((caption, i) => {
    const alias = `voice${i + 1}`;
    assert.equal(caption.asset.src, `alias://${alias}`);
    assert.equal(caption.start, `alias://${alias}`);
    assert.equal(caption.length, `alias://${alias}`);
    assert.equal(edit.timeline.tracks[2].clips[i].alias, alias);
  });
});

test('buildEdit rejects incomplete scenes', () => {
  assert.throws(() => buildEdit([]), /at least one scene/);
  assert.throws(() => buildEdit([{ imageUrl: 'x', audioUrl: 'y', duration: 0 }]), /positive duration/);
  assert.throws(() => buildEdit([{ audioUrl: 'y', duration: 1 }]), /imageUrl and audioUrl/);
});

test('estimateDurationSeconds scales with word count and has a floor', () => {
  assert.equal(estimateDurationSeconds('um dois'), 1.5);
  assert.equal(estimateDurationSeconds('a b c d e f g h i j'), 4);
});

test('validateScript normalises, derives the full script and rejects bad input', () => {
  const ok = validateScript({
    title: ' Titulo ',
    scenes: [
      { narration: 'Primeira frase.', visual: 'A red apple' },
      { narration: 'Segunda frase.', visual: 'A green pear' }
    ],
    hashtags: ['dicas', '#casa', '  ']
  });
  assert.equal(ok.title, 'Titulo');
  assert.equal(ok.hook, 'Primeira frase.');
  assert.equal(ok.script, 'Primeira frase. Segunda frase.');
  assert.deepEqual(ok.hashtags, ['#dicas', '#casa']);

  assert.throws(() => validateScript({ title: 't', scenes: [] }), /non-empty/);
  assert.throws(() => validateScript({ title: 't', scenes: [{ narration: 'x' }] }), /missing "visual"/);
  assert.throws(() => validateScript({ title: 't', scenes: [{ visual: 'x' }] }), /missing "narration"/);
  assert.throws(() => validateScript({ scenes: [{ narration: 'a', visual: 'b' }] }), /"title"/);
  const many = Array.from({ length: 11 }, () => ({ narration: 'a', visual: 'b' }));
  assert.throws(() => validateScript({ title: 't', scenes: many }), /maximum is 10/);
});

test('ttsShutdownWarning flags the models OpenAI lists as shutting down', () => {
  assert.match(ttsShutdownWarning('gpt-4o-mini-tts', new Date('2026-11-24')), /shutting down on 2027-01-06/);
  assert.match(ttsShutdownWarning('tts-1', new Date('2027-02-01')), /may no longer work/);
  assert.equal(ttsShutdownWarning('some-future-model', new Date('2026-11-24')), null);
});

test('redact removes key values and key-shaped strings', () => {
  const env = { OPENAI_API_KEY: 'abc123-very-secret-value', HOME: '/root' };
  const text = redact('failed with abc123-very-secret-value and sk-proj-AAAAAAAAAAAAAAAAAAAA', env);
  assert.ok(!text.includes('abc123-very-secret-value'));
  assert.ok(!text.includes('sk-proj-'));
  assert.ok(text.includes('[redacted]'));
});
