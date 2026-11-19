# Imagem única: site Next.js + worker de processamento no mesmo container
# (os dois precisam enxergar a mesma pasta /app/storage).
FROM node:22-bookworm-slim

ARG TARGETARCH

# ffmpeg do Debian já vem com libass, libx264 e libmp3lame.
# openssl: Prisma | fontconfig/fonts-liberation: fontes para o libass | curl: baixar yt-dlp e fonte
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl openssl fontconfig fonts-liberation \
 && rm -rf /var/lib/apt/lists/*

# yt-dlp: binário standalone oficial (já inclui o componente EJS que o YouTube exige)
RUN set -eux; \
    case "${TARGETARCH:-amd64}" in arm64) asset=yt-dlp_linux_aarch64 ;; *) asset=yt-dlp_linux ;; esac; \
    curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}" -o /usr/local/bin/yt-dlp; \
    chmod +x /usr/local/bin/yt-dlp; \
    yt-dlp --version

# Fonte das legendas: Anton (Google Fonts, licença OFL). Se o download falhar, cai na Liberation Sans.
RUN mkdir -p /usr/local/share/fonts/anton \
 && (curl -fsSL "https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf" \
      -o /usr/local/share/fonts/anton/Anton-Regular.ttf || echo "AVISO: fonte Anton nao baixada") \
 && fc-cache -f

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Dependências (inclui devDependencies: tsx roda o worker, prisma faz o db push no boot)
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build \
 && sed -i 's/\r$//' docker/start.sh \
 && chmod +x docker/start.sh

ENV NODE_ENV=production \
    PORT=3000 \
    JOBS_DIR=/app/tmp/jobs \
    OUTPUTS_DIR=/app/storage/outputs \
    CAPTION_FONT=Anton \
    CAPTION_FONT_SIZE=104 \
    CAPTION_BOLD=0

# Monte um volume persistente em /app/storage no Easypanel (vídeos gerados + cookies.txt opcional)
VOLUME ["/app/storage"]
EXPOSE 3000

CMD ["bash", "docker/start.sh"]
