# Pipeline OpenAI + Shotstack

Transforma um tema (ou um guião escrito pelo Claude) num MP4 vertical 1080x1920, com narração e legendas animadas.

```text
tema ──► guião ──► por cena: imagem (OpenAI) + narração (OpenAI)
                          │
                          ▼
              upload para o Shotstack (Ingest API)
                          │
                          ▼
   Edit JSON: imagens + áudio + legendas rich-caption ──► render ──► output/video.mp4
```

O Claude entra de duas formas:

- **Como orquestrador**: as skills (`video-ideas`, `hook-lab`, `script-writer`, `storyboard`, ...) produzem o guião e a skill `video-pipeline` executa o pipeline. Guarda o guião em JSON e usa `--script`.
- **Sem o Claude** (GitHub Actions ou terminal): a OpenAI escreve o guião a partir do tema.

## 1. Configuração

```bash
cp .env.example .env
```

Preenche `OPENAI_API_KEY` e `SHOTSTACK_API_KEY`. O `.env` está no `.gitignore`. Nunca coloques chaves no código, em prompts, em issues ou no chat.

No GitHub Actions, cria os secrets em *Settings → Secrets and variables → Actions*: `OPENAI_API_KEY` e `SHOTSTACK_API_KEY`.

A chave Shotstack tem de corresponder ao ambiente escolhido (`SHOTSTACK_ENV=stage` ou `production`).

Node 20 ou superior. O pipeline não tem dependências npm.

## 2. Utilização

| Objetivo | Comando | Custo |
| --- | --- | --- |
| Validar a estrutura, sem chaves nem rede | `npm run dry-run` | nenhum |
| Só o guião | `node pipeline/src/run.js --topic "tema" --script-only` | uma chamada de texto |
| Usar um guião existente | `node pipeline/src/run.js --script ficheiro.json --confirm` | imagens + voz + render |
| Gerar tudo a partir do tema | `node pipeline/src/run.js --topic "tema" --confirm` | imagens + voz + render |
| Retomar após falha | acrescentar `--resume` | só o que faltou |

Opções: `--language pt-PT`, `--duration 30` (10-90), `--scenes 6` (3-10), `--voice-style "voz feminina, jovem, calma"`, `--out pasta`, `--no-download`.

Sem `--confirm`, só o guião é criado e nada mais é gerado ou pago.

### Formato do guião

```json
{
  "title": "...",
  "hook": "...",
  "description": "...",
  "scenes": [{ "narration": "texto falado", "visual": "English image prompt" }],
  "hashtags": ["#tag"]
}
```

Há um exemplo completo em `pipeline/examples/sample-script.json`.

### Ficheiros de saída (`output/`, ignorado pelo Git)

| Ficheiro | Conteúdo |
| --- | --- |
| `roteiro.json` | guião final |
| `assets/scene-NN.png` / `.mp3` | imagem e narração de cada cena |
| `edit.json` | Edit JSON enviado ao Shotstack (sem chaves) |
| `video.mp4` | vídeo final |
| `video-link.txt` | URL temporário devolvido pelo Shotstack |
| `metadata.json` | título, descrição, hashtags, texto da publicação, id do render e aviso de divulgação de IA |

O URL do Shotstack expira. Guarda o `video.mp4`.

## 3. Como funciona

- **Sincronização**: o Shotstack não permite encadear cenas por alias, por isso a duração real de cada narração é medida (leitor MP3 incluído em `pipeline/src/audio.js`, validado com `ffprobe`) e as imagens são posicionadas com essas durações.
- **Legendas**: cada cena tem um clip `rich-caption` ligado à sua narração por alias (`alias://voiceN`), que o Shotstack transcreve automaticamente, com destaque palavra a palavra.
- **Imagens**: 1024x1536 por omissão, recortadas para 9:16 com `fit: cover` e um zoom lento alternado.
- **Chaves**: cada chave só é enviada ao seu fornecedor. O URL assinado de upload do Shotstack nunca recebe a chave. Mensagens de erro e ficheiros de saída passam por uma limpeza de segredos.

## 4. Avisos importantes

### Desativação dos modelos de voz da OpenAI

A documentação da OpenAI indica que `gpt-4o-mini-tts`, `tts-1` e `tts-1-hd` **deixam de funcionar a 6 de janeiro de 2027**, e que o substituto recomendado (Realtime API) não é compatível com `/v1/audio/speech`. O pipeline avisa quando usa estes modelos. Antes dessa data, escolhe um fornecedor de voz alternativo: basta substituir `synthesizeSpeech` em `pipeline/src/openai.js` por uma função que devolva um MP3. O resto do pipeline não muda. Nota: a voz gerada no próprio Shotstack não serve diretamente, porque a sua duração só é conhecida durante o render.

### Nomes de modelos

Os modelos mudam depressa (por exemplo, `gpt-image-1` foi desativado a 23 de outubro de 2026). Os valores por omissão seguem a documentação da OpenAI na data em que isto foi escrito (`gpt-6.2-astra`, `gpt-image-2.5-flare`) e **podem não estar disponíveis na tua conta**. Se der erro, define `OPENAI_TEXT_MODEL`, `OPENAI_IMAGE_MODEL` ou `OPENAI_TTS_MODEL` no `.env`.

### O que não foi validado com as APIs reais

Os testes usam APIs simuladas e cobrem toda a lógica, mas não houve acesso a chaves reais. Confirma estes pontos na primeira execução em `stage`:

1. Upload no Shotstack: o `id` devolvido por `POST /ingest/{env}/upload` é usado para consultar `GET /ingest/{env}/sources/{id}`. A documentação consultada não indicava o caminho exato desta consulta.
2. O Shotstack aceita o MP3 da OpenAI e identifica o tipo do ficheiro sem extensão.
3. A transcrição automática das legendas reconhece corretamente português.
4. O tipo de letra por omissão (Space Grotesk, do exemplo da documentação do Shotstack) fica bem. Podes trocá-lo com `CAPTION_FONT_URL` e `CAPTION_FONT_FAMILY`.

## 5. Custos e divulgação

- Uma execução completa gera N imagens, N narrações e 1 render. O resumo é mostrado antes de qualquer custo.
- `stage` produz vídeo com marca de água. `production` consome créditos Shotstack.
- A OpenAI exige divulgar que a voz é gerada por IA. Ativa também a etiqueta de conteúdo gerado por IA do TikTok, se aplicável. O `metadata.json` inclui o lembrete.
- Revê o vídeo e publica manualmente. O pipeline nunca publica.

## 6. Resolução de problemas

| Sintoma | Causa provável |
| --- | --- |
| `Missing OPENAI_API_KEY` / `SHOTSTACK_API_KEY` | `.env` em falta ou secret não criado |
| `OpenAI API 400` com nome de modelo | modelo indisponível: ver "Nomes de modelos" |
| `Cena N: ... content policy` | o prompt visual foi recusado: edita o `visual` dessa cena e usa `--resume` |
| `Shotstack render failed` | ver o campo `error` no `output/edit.json` e `npm run status` em `integrations/shotstack` |
| Vídeo com marca de água | estás em `stage` |
