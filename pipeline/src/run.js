#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { runPipeline } from './pipeline.js';
import { redact } from './util.js';

const HELP = `Uso: node pipeline/src/run.js --topic "tema" [opções]

  --topic <texto>        Tema do vídeo (obrigatório, exceto com --script ou --dry-run)
  --script <ficheiro>    Usar um guião JSON existente (ex.: escrito pelo Claude)
  --language <código>    Idioma falado (por omissão pt-PT)
  --duration <segundos>  Duração alvo, 10-90 (por omissão 30)
  --scenes <número>      Número de cenas, 3-10 (por omissão 6)
  --voice-style <texto>  Pedido extra de voz (ex.: "voz feminina, jovem, calma")
  --out <pasta>          Pasta de saída (por omissão output)
  --confirm              Autoriza gerar imagens/voz e renderizar (gera custos)
  --dry-run              Sem rede nem chaves: só constrói o Edit JSON de exemplo
  --script-only          Só gera o guião e pára
  --resume               Reutiliza ficheiros já gerados na pasta de saída
  --no-download          Não descarrega o MP4 final
  --help                 Mostra esta ajuda

Sem --confirm, só o guião é gerado. Chaves: ver .env.example (nunca as coloques no código).`;

function integerInRange(value, name, min, max, fallback) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`--${name} must be an integer from ${min} to ${max}.`);
  return n;
}

try {
  const { values } = parseArgs({
    options: {
      topic: { type: 'string' },
      script: { type: 'string' },
      language: { type: 'string' },
      duration: { type: 'string' },
      scenes: { type: 'string' },
      'voice-style': { type: 'string' },
      out: { type: 'string' },
      confirm: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      'script-only': { type: 'boolean' },
      resume: { type: 'boolean' },
      'no-download': { type: 'boolean' },
      help: { type: 'boolean' }
    }
  });

  if (values.help) {
    console.log(HELP);
  } else {
    if (!values.topic && !values.script && !values['dry-run']) {
      throw new Error('Provide --topic, --script or --dry-run. Use --help for usage.');
    }
    await runPipeline({
      topic: values.topic,
      scriptPath: values.script,
      language: values.language,
      durationSec: integerInRange(values.duration, 'duration', 10, 90, 30),
      sceneCount: integerInRange(values.scenes, 'scenes', 3, 10, 6),
      voiceStyle: values['voice-style'],
      outDir: values.out,
      confirm: values.confirm,
      dryRun: values['dry-run'],
      scriptOnly: values['script-only'],
      resume: values.resume,
      download: !values['no-download']
    });
  }
} catch (error) {
  console.error(redact(error.message));
  process.exitCode = 1;
}
