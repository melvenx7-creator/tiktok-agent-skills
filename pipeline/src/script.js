// Script shape shared by the OpenAI generator and by scripts written by Claude
// (via the script-writer / hook-lab / storyboard skills) and passed with --script.

const MAX_SCENES = 10;
const MAX_NARRATION_CHARS = 1000;

export function validateScript(data, { maxScenes = MAX_SCENES } = {}) {
  if (!data || typeof data !== 'object') throw new Error('Script must be a JSON object.');
  const text = (value) => (typeof value === 'string' ? value.trim() : '');

  if (!Array.isArray(data.scenes) || data.scenes.length === 0) {
    throw new Error('Script needs a non-empty "scenes" array.');
  }
  if (data.scenes.length > maxScenes) {
    throw new Error(`Script has ${data.scenes.length} scenes; the maximum is ${maxScenes}.`);
  }

  const scenes = data.scenes.map((scene, index) => {
    const narration = text(scene?.narration);
    const visual = text(scene?.visual);
    const n = index + 1;
    if (!narration) throw new Error(`Scene ${n} is missing "narration" (the text to be spoken).`);
    if (!visual) throw new Error(`Scene ${n} is missing "visual" (the image description).`);
    if (narration.length > MAX_NARRATION_CHARS) {
      throw new Error(`Scene ${n} narration is ${narration.length} characters; keep it under ${MAX_NARRATION_CHARS}.`);
    }
    return { narration, visual };
  });

  const title = text(data.title);
  if (!title) throw new Error('Script needs a "title".');

  const hashtags = (Array.isArray(data.hashtags) ? data.hashtags : [])
    .map(text)
    .filter(Boolean)
    .map((tag) => (tag.startsWith('#') ? tag : `#${tag.replace(/\s+/g, '')}`));

  return {
    title,
    hook: text(data.hook) || scenes[0].narration,
    description: text(data.description),
    script: scenes.map((scene) => scene.narration).join(' '),
    scenes,
    hashtags
  };
}
