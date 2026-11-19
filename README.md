# Cortes: clipagem automática de lives

Pega um VOD do YouTube ou da Twitch, deixa o Gemini escolher os melhores momentos e renderiza cortes verticais 1080x1920 com legenda dinâmica, prontos para TikTok e Shorts.

```
URL ─▶ yt-dlp (1080p) ─▶ ffmpeg (audio.mp3 mono 64k) ─▶ Gemini File API + Structured Output
                                                         │  (1) curadoria: cortes, score, título, hashtags
                                                         ▼
                         ffmpeg 9:16 + .ass ◀── (2) legendas por trecho (inline, timestamps precisos)
                                │
                                ▼
                     storage/outputs/{jobId}/clip_XX.mp4 + .jpg + clips.json
```

## 1. Setup no Windows

```powershell
winget install OpenJS.NodeJS.LTS
winget install yt-dlp.yt-dlp
winget install Gyan.FFmpeg
# feche e reabra o terminal

cd C:\Users\Leo\Desktop\DEV\cortes
copy .env.example .env        # preencha GEMINI_API_KEY (e DATABASE_URL se for usar o worker)
npm install
npm run check:deps
```

## 2. Testar o pipeline (sem banco)

```powershell
# Só o render, sem gastar API (gera cortes e legendas falsas):
npm run test:pipeline -- "https://www.youtube.com/watch?v=XXXX" --section 00:00-05:00 --mock

# De verdade, com Gemini:
npm run test:pipeline -- "https://www.youtube.com/watch?v=XXXX" --section 00:00-10:00 --clips 3

# VOD da Twitch, layout tela cheia:
npm run test:pipeline -- "https://www.twitch.tv/videos/123456789" --section 1:00:00-1:20:00 --layout center
```

Os cortes saem em `storage/outputs/<jobId>/`: `clip_01.mp4`, `clip_01.jpg` e o `clips.json` com títulos, hashtags, score e legendas.

> **PowerShell:** coloque a URL entre aspas (o `&` quebra o comando). Se as flags `--layout`, `--cam` etc. forem ignoradas, rode `npm.cmd run test:pipeline -- ...` ou `npx tsx scripts/test-pipeline.ts ...`.

### Webcam (layout split): detecção automática

Cada streamer põe a câmera num lugar diferente. Por isso, no layout `split` e sem `--cam`, o pipeline tira 3 frames de **cada corte** e pede ao Gemini a caixa da webcam. A altura da faixa da câmera se ajusta ao formato dela, para não esticar nem cortar demais. Por corte:

- **câmera num canto** → split com a câmera detectada (`webcam: auto`);
- **câmera em tela cheia** (cena de conversa) → crop 9:16 centrado na câmera (`fullscreen-cam`);
- **sem câmera** → layout `--no-cam-layout` (padrão `blur`).

Também funciona com `--mock`: os cortes e as legendas são falsos, mas a detecção é real se houver `GEMINI_API_KEY`. Para conferir só o enquadramento:

```powershell
npm run test:pipeline -- "<URL>" --section 00:00-03:00 --mock --keep
npm run preview:layout -- .\tmp\jobs\<jobId>\source.mp4 --at 60 --auto
```

Se a detecção errar num canal específico, force com `--cam x,y,w,h`. O `preview:layout --auto` imprime o `--cam` detectado, então dá para usar esse valor como ponto de partida.

| Opção | Default | |
|---|---|---|
| `--layout split\|center\|blur` | `split` | webcam + gameplay / crop central / 16:9 sobre fundo desfocado |
| `--cam x,y,w,h` | detecção automática | força a região da webcam |
| `--no-detect` | | não detecta; usa `0.72,0,0.28,0.3` |
| `--no-cam-layout blur\|center` | `blur` | layout dos cortes sem webcam |
| `--game x,y,w,h` | frame inteiro | região da gameplay (o crop 9:16 é feito no centro dela) |
| `--cam-height` | `0.35` | fração da altura 9:16 ocupada pela webcam |
| `--clips` / `--min` / `--max` | `5` / `30` / `60` | quantidade e duração dos cortes |
| `--section` | | baixa só um trecho (`INICIO-FIM`) |
| `--file` | | usa um vídeo local em vez de URL |
| `--mock` | | cortes e legendas falsos (a detecção de webcam continua real) |
| `--single-pass` | | legendas na mesma chamada da curadoria (1 chamada, menos precisa) |
| `--keep` | | mantém `tmp/jobs/<id>` |

## 3. Painel web (cadastro, login e cortes por usuário)

Precisa de um MySQL 8. Pode ser local, Docker ou um serviço MySQL no Easypanel. Coloque a URL no `.env`:

```
DATABASE_URL="mysql://usuario:senha@host:3306/cortes"
```

Depois, em **dois terminais**:

```powershell
npm run db:push     # cria as tabelas (rode de novo sempre que o schema mudar)
npm run dev         # terminal 1: site em http://localhost:3000
npm run worker      # terminal 2: processa a fila
```

Fluxo: `/cadastro` → `/dashboard` (cola o link, escolhe layout, duração e quantidade) → `/projetos/<id>` (progresso ao vivo, depois a grade com player, nota, título e hashtags copiáveis e botão de download).

- **Login:** senha com scrypt (`node:crypto`), sessão de 30 dias no banco e cookie httpOnly. Nenhuma lib externa.
- **Isolamento:** cada usuário só vê os próprios projetos. Os vídeos ficam em `storage/outputs` (fora de `/public`) e são servidos por `/api/media/...`, que confere o dono e suporta Range (avançar/voltar no player).
- **Limite:** no máximo 2 processamentos ativos por usuário (`MAX_ACTIVE_PER_USER` em `src/app/(app)/actions.ts`).

### Fila

A fila usa o próprio MySQL: o worker pega um job com update otimista (`WHERE status='QUEUED'`), renova o `lockedAt` a cada atualização de progresso, tenta de novo até `maxAttempts` e devolve para a fila os jobs travados há mais de `WORKER_STALE_MINUTES`. Dá para rodar mais de um worker.

## Estrutura

```
check-deps.ps1              valida node / yt-dlp / ffmpeg (+ libass, libx264) / .env
prisma/schema.prisma        User, Project (= job), Clip
scripts/test-pipeline.ts    CLI de ponta a ponta
scripts/preview-layout.ts   1 frame do layout para calibrar a webcam
src/app/(auth)/             /login, /cadastro + server actions de autenticação
src/app/(app)/              /dashboard, /projetos/[id] + actions (criar, repetir, excluir)
src/app/api/media/          entrega dos MP4/JPG só para o dono, com Range
src/components/             formulários, cards de clipe, status
src/lib/auth/               senha (scrypt) e sessões
src/lib/                    config, prisma, tempo, spawn de processos
src/services/video/         ytdlp, ffmpeg, layouts (filter_complex 9:16), subtitles (.ass), renderer
src/services/gemini/        client (retry), files (upload/ACTIVE/delete), schemas, prompts, analyzer
src/services/pipeline/      run-pipeline (usado pelo CLI e pelo worker), normalize, mock-analyzer
src/workers/                fila no MySQL + loop do worker
```

## Notas

- **Modelo:** o padrão é `gemini-3.5-flash`, porque o `gemini-2.5-flash` tinha desligamento marcado para 16/10/2026. Troque em `GEMINI_MODEL`.
- **Legendas em 2 passes:** o áudio inteiro vai pela File API só para escolher os cortes. Depois, cada trecho de 30 a 60s é transcrito separado (inline, < 1 MB), o que deixa a sincronia muito melhor do que pedir timestamps de palavra numa live de horas.
- **Produção:** site e worker precisam enxergar a mesma pasta `storage/` (mesmo servidor ou volume compartilhado). Para escalar, troque por S3/R2.
