import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, requireKey, ttsShutdownWarning } from './config.js';
import { generateScript, generateImage, synthesizeSpeech, voiceInstructions } from './openai.js';
import { validateScript } from './script.js';
import { audioDurationSeconds } from './audio.js';
import { buildEdit, estimateDurationSeconds } from './edit.js';
import { mapLimit, redact } from './util.js';
import {
  submitRender,
  waitForRender,
  uploadAsset,
  currentEnvironment
} from '../../integrations/shotstack/src/client.js';

const SAMPLE_SCRIPT = fileURLToPath(new URL('../examples/sample-script.json', import.meta.url));
const CONCURRENCY = 3;

const DISCLOSURE = [
  'Esta narração é voz gerada por IA e as imagens são geradas por IA. Divulga-o ao público.',
  'Ativa a etiqueta de conteúdo gerado por IA do TikTok, se aplicável.',
  'Revê factos, ortografia, legendas e direitos antes de publicar. A publicação é sempre manual.'
];

async function readIf(condition, file) {
  return condition ? fs.readFile(file).catch(() => null) : null;
}

const writeJson = (file, data) => fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`);

export async function runPipeline(options, env = process.env) {
  const {
    topic,
    language = 'pt-PT',
    durationSec = 30,
    sceneCount = 6,
    voiceStyle,
    scriptPath,
    outDir = 'output',
    confirm = false,
    dryRun = false,
    scriptOnly = false,
    resume = false,
    download = true,
    renderPollMs = 10000,
    log = console.log
  } = options;

  const cfg = loadConfig(env);
  const assetsDir = path.join(outDir, 'assets');
  await fs.mkdir(assetsDir, { recursive: true });

  // 1. Script ---------------------------------------------------------------
  let script;
  if (scriptPath) {
    script = validateScript(JSON.parse(await fs.readFile(scriptPath, 'utf8')));
    log(`Guião carregado de ${scriptPath}.`);
  } else if (dryRun) {
    script = validateScript(JSON.parse(await fs.readFile(SAMPLE_SCRIPT, 'utf8')));
    log('Dry-run: a usar o guião de exemplo (sem chamadas à API).');
  } else {
    log('A gerar o guião com a OpenAI...');
    script = await generateScript(cfg.openai, { topic, language, durationSec, sceneCount });
  }
  await writeJson(path.join(outDir, 'roteiro.json'), script);

  const sceneTotal = script.scenes.length;
  const costSummary =
    `${sceneTotal} imagens (${cfg.openai.imageModel}), ${sceneTotal} narrações (${cfg.openai.ttsModel}) ` +
    `e 1 render Shotstack (${currentEnvironment()}).`;

  // 2. Dry run: build the Edit with placeholders and stop -----------------------
  if (dryRun) {
    const scenes = script.scenes.map((scene, i) => ({
      imageUrl: `https://example.invalid/scene-${i + 1}.png`,
      audioUrl: `https://example.invalid/scene-${i + 1}.mp3`,
      duration: estimateDurationSeconds(scene.narration)
    }));
    const { edit, totalSeconds } = buildEdit(scenes, cfg.captions);
    await writeJson(path.join(outDir, 'edit.dry-run.json'), edit);
    log(`Dry-run concluído: Edit JSON de ${totalSeconds}s (durações estimadas) em ${path.join(outDir, 'edit.dry-run.json')}.`);
    return { status: 'dry-run', script, totalSeconds };
  }

  // 3. Cost gate ---------------------------------------------------------------
  if (scriptOnly || !confirm) {
    log('Guião criado. Renderização não autorizada; nenhum recurso pago foi gerado e nenhum render Shotstack foi enviado.');
    log(`Uma execução completa geraria: ${costSummary}`);
    log('Para continuar, volta a correr com --confirm (e --script para reutilizar este guião).');
    return { status: 'script-only', script };
  }

  requireKey(cfg.openai.apiKey, 'OPENAI_API_KEY');
  requireKey(env.SHOTSTACK_API_KEY, 'SHOTSTACK_API_KEY');
  const ttsWarning = ttsShutdownWarning(cfg.openai.ttsModel);
  if (ttsWarning) log(`Aviso: ${ttsWarning}`);

  // 4. Images and narration -------------------------------------------------------
  log(`A gerar: ${costSummary}`);
  const instructions = voiceInstructions({ language, style: voiceStyle });
  const failures = [];
  const prepared = await mapLimit(script.scenes, CONCURRENCY, async (scene, index) => {
    const label = String(index + 1).padStart(2, '0');
    const imageFile = path.join(assetsDir, `scene-${label}.png`);
    const audioFile = path.join(assetsDir, `scene-${label}.mp3`);
    try {
      let image = await readIf(resume, imageFile);
      if (!image) {
        image = await generateImage(cfg.openai, scene.visual);
        await fs.writeFile(imageFile, image); // saved at once so a later failure never loses paid work
      }
      let audio = await readIf(resume, audioFile);
      if (!audio) {
        audio = await synthesizeSpeech(cfg.openai, scene.narration, { instructions });
        await fs.writeFile(audioFile, audio);
      }
      log(`Cena ${index + 1}/${sceneTotal} pronta.`);
      return { image, audio, duration: audioDurationSeconds(audio, 'mp3') };
    } catch (error) {
      failures.push(`Cena ${index + 1}: ${redact(error.message)}`);
      return null;
    }
  });
  if (failures.length) {
    throw new Error(
      `${failures.join('\n')}\nOs ficheiros já gerados ficaram em ${assetsDir}. Volta a correr com --resume para os reutilizar sem pagar de novo.`
    );
  }

  // 5. Upload to Shotstack -----------------------------------------------------------
  log('A enviar os ficheiros para o Shotstack...');
  const scenes = await mapLimit(prepared, CONCURRENCY, async (item) => {
    const [imageUrl, audioUrl] = await Promise.all([uploadAsset(item.image), uploadAsset(item.audio)]);
    return { imageUrl, audioUrl, duration: item.duration };
  });

  // 6. Edit, render, download -----------------------------------------------------------
  const { edit, totalSeconds } = buildEdit(scenes, cfg.captions);
  await writeJson(path.join(outDir, 'edit.json'), edit);

  const submitted = await submitRender(edit);
  const renderId = submitted?.response?.id;
  if (!renderId) throw new Error('Shotstack did not return a render ID.');
  log(`Render enviado (${currentEnvironment()}): ${renderId}`);

  const done = await waitForRender(renderId, {
    intervalMs: renderPollMs,
    onStatus: (status) => log(`Estado: ${status}`)
  });
  await fs.writeFile(path.join(outDir, 'video-link.txt'), done.url);

  let videoFile = null;
  if (download) {
    const response = await fetch(done.url);
    if (!response.ok) throw new Error(`Could not download the rendered video (status ${response.status}).`);
    videoFile = path.join(outDir, 'video.mp4');
    await fs.writeFile(videoFile, Buffer.from(await response.arrayBuffer()));
  }

  await writeJson(path.join(outDir, 'metadata.json'), {
    title: script.title,
    hook: script.hook,
    description: script.description,
    hashtags: script.hashtags,
    postText: [script.description, script.hashtags.join(' ')].filter(Boolean).join(' '),
    render: { id: renderId, environment: currentEnvironment(), seconds: totalSeconds, url: done.url },
    disclosure: DISCLOSURE
  });

  log(`VÍDEO MP4: ${done.url}`);
  if (videoFile) log(`Ficheiro guardado em ${videoFile}.`);
  if (currentEnvironment() === 'stage') log('Nota: o ambiente "stage" produz vídeo com marca de água.');
  DISCLOSURE.forEach((line) => log(`- ${line}`));
  return { status: 'done', script, renderId, url: done.url, videoFile, totalSeconds };
}
