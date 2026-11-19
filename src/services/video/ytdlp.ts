import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getConfig } from "@/lib/config";
import { CommandError, runCommand } from "@/lib/process";

export interface SourceMetadata {
  id: string;
  title: string;
  duration?: number;
  isLive: boolean;
  extractor: string;
  uploader?: string;
}

export interface DownloadOptions {
  /** Altura máxima do vídeo (default 1080). */
  maxHeight?: number;
  /** Baixa só um trecho, ex: "00:00-10:00" (útil para testes e lives longas). */
  section?: string;
  onProgress?: (percent: number, line: string) => void;
  signal?: AbortSignal;
}

/**
 * O yt-dlp REESCREVE o arquivo de cookies ao terminar. Montagens de arquivo no Easypanel/Docker
 * costumam ser somente leitura, então usamos uma cópia em /tmp.
 */
async function cookieArgs(): Promise<string[]> {
  const { ytdlpCookiesFromBrowser, ytdlpCookiesFile } = getConfig();
  if (ytdlpCookiesFile) {
    try {
      await fs.access(ytdlpCookiesFile);
    } catch {
      console.warn(`[yt-dlp] YTDLP_COOKIES_FILE aponta para ${ytdlpCookiesFile}, mas o arquivo não existe. Seguindo sem cookies.`);
      return [];
    }
    const copy = path.join(os.tmpdir(), `cortes-ytdlp-cookies-${process.pid}.txt`);
    await fs.copyFile(ytdlpCookiesFile, copy);
    return ["--cookies", copy];
  }
  if (ytdlpCookiesFromBrowser) return ["--cookies-from-browser", ytdlpCookiesFromBrowser];
  return [];
}

async function baseArgs(): Promise<string[]> {
  const args = ["--no-playlist", "--no-warnings", "--no-color"];
  // Desde 2025.11 o yt-dlp precisa de um runtime JS externo para o YouTube e só habilita o Deno por padrão.
  // Usamos o próprio Node que está rodando este processo. Sobrescreva com YTDLP_JS_RUNTIMES (ex: "deno").
  const jsRuntime = process.env.YTDLP_JS_RUNTIMES || `node:${process.execPath}`;
  args.push("--js-runtimes", jsRuntime, ...(await cookieArgs()));
  // Serviço bgutil (PO Token): contorna o bloqueio "não sou um robô" do YouTube em IPs de servidor.
  const potUrl = process.env.YTDLP_POT_PROVIDER_URL;
  if (potUrl) args.push("--extractor-args", `youtubepot-bgutilhttp:base_url=${potUrl}`);
  return args;
}

/** Troca os erros mais comuns do yt-dlp por mensagens que o usuário entende. */
function friendlyError(err: unknown): unknown {
  if (!(err instanceof CommandError)) return err;
  const msg = err.message;
  if (/confirm you.?re not a bot|Sign in to confirm/i.test(msg)) {
    return new Error(
      "BLOQUEIO_YOUTUBE: o YouTube bloqueou o download a partir do servidor (pede login \"não sou um robô\"). " +
        "O administrador precisa configurar/renovar o cookies.txt (YTDLP_COOKIES_FILE).",
    );
  }
  if (/Private video|members-only|Join this channel/i.test(msg)) {
    return new Error("Vídeo privado ou exclusivo para membros — não dá para baixar.");
  }
  if (/Video unavailable|This video is not available/i.test(msg)) {
    return new Error("Vídeo indisponível (removido, bloqueado na região ou link errado).");
  }
  return err;
}

/** Lê os metadados sem baixar nada. Funciona para YouTube e VODs da Twitch. */
export async function fetchMetadata(url: string): Promise<SourceMetadata> {
  const { bins } = getConfig();
  const { stdout } = await runCommand(bins.ytdlp, [
    ...(await baseArgs()),
    "--skip-download",
    "--dump-single-json",
    url,
  ]).catch((err) => {
    throw friendlyError(err);
  });
  const json = JSON.parse(stdout);
  return {
    id: String(json.id ?? ""),
    title: String(json.title ?? "Sem título"),
    duration: typeof json.duration === "number" ? json.duration : undefined,
    isLive: json.is_live === true || json.live_status === "is_live" || json.live_status === "is_upcoming",
    extractor: String(json.extractor_key ?? json.extractor ?? ""),
    uploader: json.uploader ?? json.channel ?? undefined,
  };
}

/**
 * Baixa o vídeo em até 1080p (MP4) para `{outDir}/source.mp4`.
 * Prioriza H.264 + AAC (merge direto em MP4); se não houver, aceita VP9/AV1 — o ffmpeg re-encoda depois mesmo.
 */
export async function downloadVideo(url: string, outDir: string, opts: DownloadOptions = {}): Promise<string> {
  const { bins } = getConfig();
  const h = opts.maxHeight ?? 1080;
  await fs.mkdir(outDir, { recursive: true });

  const format = [
    `bv*[height<=${h}][vcodec^=avc1]+ba[ext=m4a]`,
    `bv*[height<=${h}]+ba`,
    `b[height<=${h}]`,
    "b",
  ].join("/");

  const args = [
    ...(await baseArgs()),
    "--newline",
    "-f",
    format,
    "--merge-output-format",
    "mp4",
    "-o",
    path.join(outDir, "source.%(ext)s"),
  ];
  if (opts.section) args.push("--download-sections", `*${opts.section}`);
  args.push(url);

  const progressRe = /\[download\]\s+([\d.]+)%/;
  await runCommand(bins.ytdlp, args, {
    signal: opts.signal,
    captureStdout: false,
    onStdoutLine: (line) => {
      const m = progressRe.exec(line);
      if (m) opts.onProgress?.(Number(m[1]), line);
    },
  }).catch((err) => {
    throw friendlyError(err);
  });

  const files = await fs.readdir(outDir);
  const source = files.find((f) => f.startsWith("source.") && !f.endsWith(".part") && !f.endsWith(".ytdl"));
  if (!source) throw new Error("yt-dlp terminou mas o arquivo source.* não foi encontrado.");
  return path.join(outDir, source);
}
