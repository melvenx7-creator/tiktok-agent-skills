---
name: video-pipeline
description: Video Pipeline for the TikTok Agent Skill workflow. Runs the OpenAI + Shotstack pipeline that turns a topic or an approved script into a vertical 9:16 MP4 with narration and captions.
---

# Video Pipeline

Orchestrate the other skills and use the pipeline in `pipeline/` as the execution engine:
OpenAI writes (optionally) the script, generates one image per scene and the narration; Shotstack hosts the
assets, adds captions and renders the MP4.

## Order of work

1. `video-ideas`, `hook-lab`, `script-writer`, `storyboard`: produce the script and scenes.
2. Save the result as JSON (see format) and run a **dry run** first.
3. Tell the user exactly what a full run will generate and cost, then wait for an explicit yes.
4. Run with `--confirm`, report the result, and hand over `output/video.mp4` plus `output/metadata.json`.
5. `prepublish-review`: review the video. The user publishes manually. Never publish automatically.

## Commands

```bash
node pipeline/src/run.js --dry-run                                  # no keys, no network, builds a sample Edit JSON
node pipeline/src/run.js --topic "tema" --script-only               # only the OpenAI script (small cost)
node pipeline/src/run.js --script output/roteiro.json --confirm     # images + narration + render (costs credits)
node pipeline/src/run.js --script output/roteiro.json --confirm --resume   # reuse files already paid for
```

Useful flags: `--language pt-PT`, `--duration 30`, `--scenes 6`, `--voice-style "voz feminina, calma"`.

## Script format

Write the script yourself when the user wants control over wording; pass it with `--script`.

```json
{
  "title": "...",
  "hook": "...",
  "description": "...",
  "scenes": [{ "narration": "text spoken in the video's language", "visual": "English image prompt, vertical 9:16, no text or logos" }],
  "hashtags": ["#tag"]
}
```

3 to 10 scenes. Each narration is one or two short sentences (about 2.5 words per second). Visuals must not
contain text, logos, real people or copyrighted characters.

## Rules

- Never read, print, log, request or commit API keys. They live in `.env` (ignored by Git) or in CI secrets. If a key is missing, tell the user to add it to `.env`; do not ask them to paste it into the chat.
- Default to `SHOTSTACK_ENV=stage` (watermarked). Use `production` only when the user asks for the final render.
- Never start a paid run without explicit confirmation. A failed run keeps its paid assets; fix the cause and use `--resume`.
- Only call a render finished when the pipeline reports `done`.
- Remind the user that the narration and images are AI-generated and should be disclosed, and that TikTok's AI-generated content label may apply.
- OpenAI documents `gpt-4o-mini-tts`, `tts-1` and `tts-1-hd` as shutting down on 2027-01-06. Warn the user and see `docs/pipeline.md` before relying on them after that date.
