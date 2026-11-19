import fs from "node:fs/promises";
import path from "node:path";
import { getConfig } from "@/lib/config";
import { runCommand } from "@/lib/process";

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

function baseArgs(): string[] {
  const { ytdlpCookiesFromBrowser, ytdlpCookiesFile } = getConfig();
  const args = ["--no-playlist", "--no-warnings", "--no-color"];
  // Desde 2025.11 o yt-dlp precisa de um runtime JS externo para o YouTube e só habilita o Deno por padrão.
  // Usamos o próprio Node que está rodando este processo. Sobrescreva com YTDLP_JS_RUNTIMES (ex: "deno").
  const jsRuntime = process.env.YTDLP_JS_RUNTIMES || `node:${process.execPath}`;
  args.push("--js-runtimes", jsRuntime);
  if (ytdlpCookiesFile) args.push("--cookies", ytdlpCookiesFile);
  else if (ytdlpCookiesFromBrowser) args.push("--cookies-from-browser", ytdlpCookiesFromBrowser);
  return args;
}

/** Lê os metadados sem baixar nada. Funciona para YouTube e VODs da Twitch. */
export async function fetchMetadata(url: string): Promise<SourceMetadata> {
  const { bins } = getConfig();
  const { stdout } = await runCommand(bins.ytdlp, [...baseArgs(), "--skip-download", "--dump-single-json", url]);
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
    ...baseArgs(),
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
  });

  const files = await fs.readdir(outDir);
  const source = files.find((f) => f.startsWith("source.") && !f.endsWith(".part") && !f.endsWith(".ytdl"));
  if (!source) throw new Error("yt-dlp terminou mas o arquivo source.* não foi encontrado.");
  return path.join(outDir, source);
}
