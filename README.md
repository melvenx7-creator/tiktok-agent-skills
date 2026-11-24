# tiktok-agent-skills
AI-powered TIKTOK video creation agent with 11 specialized skills and shotstack cloud video editing integration.

## Pipeline OpenAI + Shotstack

Do tema ao MP4 vertical 9:16, com guião, imagens, narração e legendas:

```text
Claude (skills) ──► guião ──► OpenAI: imagens + narração ──► Shotstack: upload, legendas, render ──► video.mp4
```

```bash
cp .env.example .env          # preenche as tuas chaves; o .env nunca é versionado
npm run dry-run               # sem chaves nem rede: valida a estrutura do Edit
npm test                      # testes offline com APIs simuladas
node pipeline/src/run.js --topic "o teu tema" --script-only   # só o guião
node pipeline/src/run.js --topic "o teu tema" --confirm       # gera tudo (usa créditos)
```

Guia completo, custos, avisos e resolução de problemas: [docs/pipeline.md](docs/pipeline.md).
A skill `video-pipeline` explica ao Claude como orquestrar todo o fluxo. A publicação no TikTok é sempre manual.
