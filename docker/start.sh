#!/usr/bin/env bash
# Sobe o site e o worker no mesmo container. Se um dos dois cair, o container sai
# e o Easypanel reinicia tudo.
set -euo pipefail

mkdir -p "${OUTPUTS_DIR:-/app/storage/outputs}" "${JOBS_DIR:-/app/tmp/jobs}"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[start] ERRO: DATABASE_URL não definida. Configure nas variáveis de ambiente do Easypanel." >&2
  exit 1
fi
if [ -z "${GEMINI_API_KEY:-}" ]; then
  echo "[start] AVISO: GEMINI_API_KEY não definida — o site sobe, mas os cortes vão falhar." >&2
fi

echo "[start] sincronizando tabelas do banco (prisma db push)..."
# Sem --accept-data-loss: se alguma mudança apagar dados, o boot para aqui em vez de apagar.
npx prisma db push --skip-generate

echo "[start] yt-dlp $(yt-dlp --version) | $(ffmpeg -hide_banner -version | head -n1)"

if [ -n "${YTDLP_POT_PROVIDER_URL:-}" ]; then
  if curl -fsS --max-time 5 "${YTDLP_POT_PROVIDER_URL%/}/ping" >/dev/null 2>&1; then
    echo "[start] PO Token provider OK em ${YTDLP_POT_PROVIDER_URL}"
  else
    echo "[start] AVISO: PO Token provider não respondeu em ${YTDLP_POT_PROVIDER_URL} (o serviço 'pot' está rodando?)" >&2
  fi
else
  echo "[start] AVISO: YTDLP_POT_PROVIDER_URL não definida — o YouTube pode bloquear downloads do servidor." >&2
fi
echo "[start] iniciando worker, vigia de lives e site na porta ${PORT:-3000}..."

npm run worker &
WORKER_PID=$!
npm run live &
LIVE_PID=$!
npx next start -H 0.0.0.0 -p "${PORT:-3000}" &
WEB_PID=$!

shutdown() {
  echo "[start] encerrando..."
  kill -TERM "$WORKER_PID" "$WEB_PID" "$LIVE_PID" 2>/dev/null || true
}
trap shutdown TERM INT

set +e
wait -n "$WORKER_PID" "$WEB_PID" "$LIVE_PID"
STATUS=$?
echo "[start] um dos processos terminou (código $STATUS)."
shutdown
wait
exit "$STATUS"
