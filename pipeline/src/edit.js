import { round2 } from './util.js';

// Builds the Shotstack Edit JSON. Pure function: no network, no secrets.
//
// Layout (first track is the top layer in Shotstack):
//   1. rich captions, auto-transcribed from each scene's narration clip
//   2. scene images with a slow zoom
//   3. narration audio
// Scenes play back to back. Shotstack aliases cannot chain "start after", so the
// start times come from the real narration durations measured in audio.js.

export const SCENE_GAP = 0.15; // seconds of breathing room after each scene
export const END_PAD = 0.5; // seconds after the final line

export function estimateDurationSeconds(text, wordsPerSecond = 2.5) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1.5, round2(words / wordsPerSecond));
}

export function buildEdit(scenes, { width = 1080, height = 1920, fps = 30, fontUrl, fontFamily } = {}) {
  if (!Array.isArray(scenes) || scenes.length === 0) throw new Error('buildEdit needs at least one scene.');

  const imageClips = [];
  const audioClips = [];
  const captionClips = [];
  let cursor = 0;

  scenes.forEach((scene, index) => {
    const n = index + 1;
    if (!scene.imageUrl || !scene.audioUrl) throw new Error(`Scene ${n} needs imageUrl and audioUrl.`);
    if (!(scene.duration > 0)) throw new Error(`Scene ${n} needs a positive duration.`);

    const alias = `voice${n}`;
    const isLast = index === scenes.length - 1;
    const length = round2(scene.duration + (isLast ? END_PAD : SCENE_GAP));
    const start = round2(cursor);

    imageClips.push({
      asset: { type: 'image', src: scene.imageUrl },
      start,
      length,
      fit: 'cover',
      effect: index % 2 === 0 ? 'zoomInSlow' : 'zoomOutSlow'
    });

    audioClips.push({ alias, asset: { type: 'audio', src: scene.audioUrl }, start, length: 'auto' });

    captionClips.push({
      asset: {
        type: 'rich-caption',
        src: `alias://${alias}`,
        font: { family: fontFamily, size: 72, color: '#ffffff', opacity: 1, weight: 700 },
        align: { vertical: 'middle' },
        stroke: { width: 3, color: '#000000', opacity: 1 },
        animation: { style: 'karaoke' },
        active: { font: { color: '#ffd400', opacity: 1 } }
      },
      start: `alias://${alias}`,
      length: `alias://${alias}`,
      width: Math.round(width * 0.88),
      height: Math.round(height * 0.22),
      offset: { x: 0, y: -0.25 } // lower third, above TikTok's bottom UI
    });

    cursor += length;
  });

  const timeline = {
    background: '#000000',
    tracks: [{ clips: captionClips }, { clips: imageClips }, { clips: audioClips }]
  };
  if (fontUrl) timeline.fonts = [{ src: fontUrl }];

  return {
    edit: { timeline, output: { format: 'mp4', size: { width, height }, fps } },
    totalSeconds: round2(cursor)
  };
}
