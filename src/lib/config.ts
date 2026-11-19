import path from "node:path";

/**
 * Lê a configuração do ambiente sob demanda (depois que o dotenv carregou),
 * em vez de congelar valores no momento do import.
 */
export function getConfig() {
  const env = process.env;
  return {
    gemini: {
      apiKey: env.GEMINI_API_KEY ?? "",
      model: env.GEMINI_MODEL || "gemini-3.5-flash",
    },
    bins: {
      ytdlp: env.YTDLP_PATH || "yt-dlp",
      ffmpeg: env.FFMPEG_PATH || "ffmpeg",
      ffprobe: env.FFPROBE_PATH || "ffprobe",
    },
    ytdlpCookiesFromBrowser: env.YTDLP_COOKIES_FROM_BROWSER || "",
    /** Arquivo cookies.txt (formato Netscape) — necessário em servidor quando o YouTube pede login "não sou robô". */
    ytdlpCookiesFile: env.YTDLP_COOKIES_FILE || "",
    dirs: {
      jobs: path.resolve(env.JOBS_DIR || "tmp/jobs"),
      outputs: path.resolve(env.OUTPUTS_DIR || "storage/outputs"),
      /** Os vídeos são servidos por /api/media/{jobId}/{arquivo}, que confere o dono do projeto. */
      outputsPublicPrefix: "/api/media",
    },
    captions: {
      font: env.CAPTION_FONT || "Arial Black",
      fontSize: Number(env.CAPTION_FONT_SIZE || 86),
      color: env.CAPTION_COLOR || "#FFFFFF",
      highlightColor: env.CAPTION_HIGHLIGHT_COLOR || "#FFD400",
      bold: env.CAPTION_BOLD !== "0",
    },
    encoder: {
      preset: env.X264_PRESET || "veryfast",
      crf: Number(env.X264_CRF || 20),
    },
    worker: {
      pollMs: Number(env.WORKER_POLL_MS || 3000),
      staleMinutes: Number(env.WORKER_STALE_MINUTES || 30),
    },
  };
}

export type AppConfig = ReturnType<typeof getConfig>;

export function requireGeminiKey(): string {
  const key = getConfig().gemini.apiKey;
  if (!key) {
    throw new Error("GEMINI_API_KEY não definida. Copie .env.example para .env e preencha a chave.");
  }
  return key;
}
