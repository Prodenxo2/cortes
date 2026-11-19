import fs from "node:fs/promises";
import path from "node:path";
import { getConfig } from "@/lib/config";
import { runFfmpegWithProgress } from "./ffmpeg";
import { buildFilterGraph, type LayoutOptions } from "./layouts";

export interface RenderClipOptions {
  source: string;
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

  const args = [
    "-ss",
    o.start.toFixed(3),
    "-t",
    o.duration.toFixed(3),
    "-i",
    path.resolve(o.source),
    "-filter_complex",
    buildFilterGraph(o.layout, assName),
    "-map",
    "[vout]",
  ];
  if (o.hasAudio) args.push("-map", "0:a:0", "-c:a", "aac", "-b:a", "160k", "-ar", "48000");
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
