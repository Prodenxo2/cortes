import fs from "node:fs/promises";
import path from "node:path";
import { getConfig } from "@/lib/config";
import { runFfmpegWithProgress } from "./ffmpeg";
import { buildFilterGraph, type LayoutOptions } from "./layouts";
import { inputArgs, type MediaRef } from "./media";

export interface RenderClipOptions {
  /** Vídeo (arquivo local ou URL remota). Se tiver áudio junto e `audio` não vier, o áudio sai daqui. */
  video: MediaRef;
  /** Faixa de áudio separada (ex: formatos DASH do YouTube), opcional. */
  audio?: MediaRef;
  /** Início no arquivo de áudio, se diferente do vídeo (trechos baixados separadamente). */
  audioStart?: number;
  start: number;
  duration: number;
  layout: LayoutOptions;
  /** Conteúdo do .ass já gerado (ou undefined para render sem legenda). */
  assContent?: string;
  /** Pasta de trabalho onde o .ass é gravado (o ffmpeg roda com cwd aqui). */
  workDir: string;
  outFile: string;
  hasAudio: boolean;
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
}

/**
 * Corta [start, start+duration] do source, monta o canvas 9:16 e queima as legendas.
 * O seek é feito ANTES do -i: os timestamps do trecho começam em 0, então os offsets do .ass
 * (relativos ao início do clipe) batem direto.
 */
export async function renderClip(o: RenderClipOptions): Promise<string> {
  const { encoder } = getConfig();
  await fs.mkdir(o.workDir, { recursive: true });
  await fs.mkdir(path.dirname(o.outFile), { recursive: true });

  let assName: string | undefined;
  if (o.assContent) {
    assName = `${path.basename(o.outFile, path.extname(o.outFile))}.ass`;
    await fs.writeFile(path.join(o.workDir, assName), o.assContent, "utf8");
  }

  const seek = { start: o.start, duration: o.duration };
  const args = [...inputArgs(o.video, seek)];
  if (o.audio) args.push(...inputArgs(o.audio, { start: o.audioStart ?? o.start, duration: o.duration }));
  args.push("-filter_complex", buildFilterGraph(o.layout, assName), "-map", "[vout]");
  if (o.hasAudio) {
    args.push("-map", o.audio ? "1:a:0" : "0:a:0", "-c:a", "aac", "-b:a", "160k", "-ar", "48000");
  }
  args.push(
    "-c:v",
    "libx264",
    "-preset",
    encoder.preset,
    "-crf",
    String(encoder.crf),
    "-profile:v",
    "high",
    "-movflags",
    "+faststart",
    path.resolve(o.outFile),
  );

  await runFfmpegWithProgress(args, o.duration, { cwd: o.workDir, onProgress: o.onProgress, signal: o.signal });
  return o.outFile;
}
