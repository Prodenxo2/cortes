import { getConfig } from "@/lib/config";
import { runCommand } from "@/lib/process";
import { inputArgs, type MediaRef } from "./media";

export interface ProbeResult {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
}

export async function probe(file: string): Promise<ProbeResult> {
  const { bins } = getConfig();
  const { stdout } = await runCommand(bins.ffprobe, [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_type,width,height,r_frame_rate:format=duration",
    "-of",
    "json",
    file,
  ]);
  const json = JSON.parse(stdout);
  const streams: Array<Record<string, unknown>> = json.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  if (!video) throw new Error(`Nenhuma faixa de vídeo em ${file}`);
  const [num, den] = String(video.r_frame_rate ?? "30/1").split("/").map(Number);
  return {
    duration: Number(json.format?.duration ?? 0),
    width: Number(video.width),
    height: Number(video.height),
    fps: den ? num / den : num,
    hasAudio: streams.some((s) => s.codec_type === "audio"),
  };
}

export interface AudioExtractOptions {
  /** Início do trecho em segundos (opcional). */
  start?: number;
  /** Duração do trecho em segundos (opcional). */
  duration?: number;
  bitrateKbps?: number;
  /** Duração esperada da saída, para calcular o progresso (0..1). */
  expectedDuration?: number;
  onProgress?: (ratio: number) => void;
}

/**
 * Extrai áudio mono MP3 leve para envio ao Gemini. Aceita arquivo local ou URL remota.
 * Com start/duration usa o MESMO seek de entrada do render, então os offsets batem com o clipe final.
 */
export async function extractAudio(src: MediaRef, out: string, opts: AudioExtractOptions = {}): Promise<string> {
  const args = [
    ...inputArgs(src, { start: opts.start, duration: opts.duration }),
    "-vn",
    "-ac",
    "1",
    "-ar",
    "22050",
    "-c:a",
    "libmp3lame",
    "-b:a",
    `${opts.bitrateKbps ?? 64}k`,
    out,
  ];
  await runFfmpegWithProgress(args, opts.expectedDuration ?? opts.duration ?? 0, { onProgress: opts.onProgress });
  return out;
}

/** Roda ffmpeg com -progress e reporta 0..1 baseado na duração esperada da saída. */
export async function runFfmpegWithProgress(
  args: string[],
  expectedDuration: number,
  opts: { cwd?: string; onProgress?: (ratio: number) => void; signal?: AbortSignal } = {},
): Promise<void> {
  const { bins } = getConfig();
  const fullArgs = ["-y", "-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1", ...args];
  await runCommand(bins.ffmpeg, fullArgs, {
    cwd: opts.cwd,
    signal: opts.signal,
    captureStdout: false,
    onStdoutLine: (line) => {
      // out_time_us (e out_time_ms, que apesar do nome também é em microssegundos)
      const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
      if (m && expectedDuration > 0) {
        opts.onProgress?.(Math.min(1, Number(m[1]) / 1e6 / expectedDuration));
      }
    },
  });
}

/** Captura um frame JPG (thumbnail). */
export async function extractFrame(src: MediaRef, atSeconds: number, out: string, width = 540): Promise<string> {
  const { bins } = getConfig();
  await runCommand(bins.ffmpeg, [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    ...inputArgs(src, { start: atSeconds }),
    "-frames:v",
    "1",
    "-vf",
    `scale=${width}:-2`,
    "-q:v",
    "3",
    out,
  ]);
  return out;
}
