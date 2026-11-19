import fs from "node:fs/promises";
import path from "node:path";
import type { Highlight, PipelineStage, ProgressFn, RenderedClip, WebcamMode } from "@/types/clip";
import { getConfig } from "@/lib/config";
import { formatTimestamp } from "@/lib/time";
import { downloadVideo, fetchMetadata } from "@/services/video/ytdlp";
import { extractAudio, extractFrame, probe, type ProbeResult } from "@/services/video/ffmpeg";
import {
  autoCamHeightRatio,
  captionAnchor,
  DEFAULT_WEBCAM,
  type CropRect,
  type LayoutOptions,
  type LayoutPreset,
} from "@/services/video/layouts";
import { buildAss, sanitizeCaptions } from "@/services/video/subtitles";
import { renderClip } from "@/services/video/renderer";
import { normalizeHighlights } from "./normalize";
import type { ClipAnalyzer } from "./types";

export interface PipelineOptions {
  jobId: string;
  /** URL do YouTube/Twitch. Use `url` OU `localFile`. */
  url?: string;
  /** Arquivo de vídeo já baixado (pula o yt-dlp). */
  localFile?: string;
  /** Baixa só um trecho, ex: "00:00-10:00". */
  section?: string;
  layout: LayoutOptions;
  /**
   * No layout split, sem webcam manual: detecta a câmera em cada corte com a IA (default: true).
   * Se layout.webcam vier preenchido, ele é usado como está (modo manual).
   */
  autoDetectWebcam?: boolean;
  /** Layout usado quando a IA não acha webcam no trecho (default: "blur"). */
  noWebcamPreset?: Exclude<LayoutPreset, "split">;
  minDuration: number;
  maxDuration: number;
  clipCount: number;
  language: string;
  /** Legendas na mesma chamada da curadoria (menos preciso, 1 chamada). */
  singlePass?: boolean;
  /** Mantém tmp/jobs/{jobId} (source.mp4, áudios, .ass) para depuração. */
  keepWorkDir?: boolean;
  analyzer: ClipAnalyzer;
  onProgress?: ProgressFn;
  signal?: AbortSignal;
}

export interface PipelineResult {
  jobId: string;
  sourceTitle: string;
  sourceDuration: number;
  outputDir: string;
  manifestPath: string;
  clips: RenderedClip[];
}

// Faixas de progresso de cada etapa no total 0..100.
const RANGES: Record<Exclude<PipelineStage, "COMPLETED">, [number, number]> = {
  DOWNLOADING: [0, 25],
  ANALYZING: [25, 50],
  RENDERING: [50, 100],
};

export async function runPipeline(o: PipelineOptions): Promise<PipelineResult> {
  if (!o.url && !o.localFile) throw new Error("Informe url ou localFile.");
  const cfg = getConfig();
  const workDir = path.join(cfg.dirs.jobs, o.jobId);
  const outDir = path.join(cfg.dirs.outputs, o.jobId);
  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(outDir, { recursive: true });

  const emit = async (stage: Exclude<PipelineStage, "COMPLETED">, ratio: number, message: string) => {
    const [a, b] = RANGES[stage];
    const percent = Math.round(a + (b - a) * Math.min(1, Math.max(0, ratio)));
    await o.onProgress?.({ stage, percent, message });
  };

  try {
    // ---------------------------------------------------------------- 1. Download
    let source: string;
    let sourceTitle: string;
    if (o.localFile) {
      source = path.resolve(o.localFile);
      sourceTitle = path.basename(source, path.extname(source));
      await fs.access(source);
      await emit("DOWNLOADING", 1, `Usando arquivo local ${path.basename(source)}`);
    } else {
      await emit("DOWNLOADING", 0, "Lendo metadados...");
      const meta = await fetchMetadata(o.url!);
      if (meta.isLive) {
        throw new Error("Essa live ainda está no ar. Espere ela terminar e virar VOD para processar.");
      }
      sourceTitle = meta.title;
      await emit("DOWNLOADING", 0.02, `Baixando "${meta.title}"...`);
      let lastEmit = 0;
      source = await downloadVideo(o.url!, workDir, {
        section: o.section,
        signal: o.signal,
        onProgress: (pct) => {
          const now = Date.now();
          if (now - lastEmit < 1000) return;
          lastEmit = now;
          void emit("DOWNLOADING", 0.02 + (pct / 100) * 0.98, `Baixando vídeo... ${pct.toFixed(1)}%`);
        },
      });
    }

    const info = await probe(source);
    if (!info.duration) throw new Error("Não consegui ler a duração do vídeo.");
    await emit("DOWNLOADING", 1, `Vídeo pronto: ${info.width}x${info.height}, ${formatTimestamp(info.duration)}`);

    // ---------------------------------------------------------------- 2. Curadoria (IA)
    if (!info.hasAudio) throw new Error("O vídeo não tem faixa de áudio — não há o que analisar.");
    await emit("ANALYZING", 0, "Extraindo áudio leve (mono 64kbps)...");
    const audioPath = await extractAudio(source, path.join(workDir, "audio.mp3"));

    await emit("ANALYZING", 0.1, `Enviando para ${o.analyzer.name}...`);
    const raw = await o.analyzer.findHighlights({
      audioPath,
      sourceTitle,
      sourceDuration: info.duration,
      clipCount: o.clipCount,
      minDuration: o.minDuration,
      maxDuration: o.maxDuration,
      language: o.language,
      includeCaptions: !!o.singlePass,
      onStatus: (msg) => void emit("ANALYZING", 0.4, msg),
    });

    const highlights = normalizeHighlights(raw, {
      sourceDuration: info.duration,
      minDuration: o.minDuration,
      maxDuration: o.maxDuration,
      clipCount: o.clipCount,
    });
    if (highlights.length === 0) throw new Error("A IA não retornou nenhum corte válido para esse vídeo.");
    await emit("ANALYZING", 1, `${highlights.length} cortes encontrados.`);

    // ---------------------------------------------------------------- 3. Render
    const clips: RenderedClip[] = [];
    const perClip = 1 / highlights.length;

    for (const [i, h] of highlights.entries()) {
      const position = i + 1;
      const base = `clip_${String(position).padStart(2, "0")}`;
      const duration = h.end - h.start;
      const at = (r: number) => i * perClip + r * perClip;
      const label = `Corte ${position}/${highlights.length}`;

      await emit("RENDERING", at(0.02), `${label}: localizando webcam...`);
      const { layout, webcamMode } = await resolveClipLayout(o, h, source, info, workDir, base);

      const captions = await getCaptions(o, h, workDir, source, base, duration, async (msg) =>
        emit("RENDERING", at(0.05), `${label}: ${msg}`),
      );

      const ass = buildAss(captions, {
        anchor: captionAnchor(layout),
        font: cfg.captions.font,
        fontSize: cfg.captions.fontSize,
        color: cfg.captions.color,
        highlightColor: cfg.captions.highlightColor,
        bold: cfg.captions.bold,
      });

      await emit("RENDERING", at(0.2), `${label}: renderizando 1080x1920...`);
      const outFile = path.join(outDir, `${base}.mp4`);
      let lastEmit = 0;
      await renderClip({
        source,
        start: h.start,
        duration,
        layout,
        assContent: ass,
        workDir,
        outFile,
        hasAudio: info.hasAudio,
        signal: o.signal,
        onProgress: (r) => {
          const now = Date.now();
          if (now - lastEmit < 1000) return;
          lastEmit = now;
          void emit("RENDERING", at(0.2 + r * 0.75), `${label}: renderizando ${Math.round(r * 100)}%`);
        },
      });

      const thumb = path.join(outDir, `${base}.jpg`);
      await extractFrame(outFile, Math.min(duration / 3, 3), thumb).catch(() => undefined);

      const publicBase = `${cfg.dirs.outputsPublicPrefix}/${o.jobId}`;
      clips.push({
        ...h,
        position,
        layout,
        webcamMode,
        captions,
        filePath: outFile,
        publicUrl: `${publicBase}/${base}.mp4`,
        thumbnailPath: thumb,
        thumbnailUrl: `${publicBase}/${base}.jpg`,
      });
      await emit("RENDERING", at(1), `${label} pronto.`);
    }

    // ---------------------------------------------------------------- 4. Manifesto
    const manifestPath = path.join(outDir, "clips.json");
    const manifest = {
      jobId: o.jobId,
      source: o.url ?? o.localFile,
      sourceTitle,
      sourceDuration: info.duration,
      analyzer: o.analyzer.name,
      layout: o.layout,
      createdAt: new Date().toISOString(),
      clips: clips.map((c) => ({
        position: c.position,
        start_time: formatTimestamp(c.start),
        end_time: formatTimestamp(c.end),
        viral_score: c.viral_score,
        hook_title: c.hook_title,
        hashtags: c.hashtags,
        reason: c.reason,
        layout: c.layout,
        webcam_mode: c.webcamMode,
        video: c.publicUrl,
        thumbnail: c.thumbnailUrl,
        captions: c.captions,
      })),
    };
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    await o.onProgress?.({ stage: "COMPLETED", percent: 100, message: `${clips.length} cortes prontos.` });
    return { jobId: o.jobId, sourceTitle, sourceDuration: info.duration, outputDir: outDir, manifestPath, clips };
  } finally {
    if (!o.keepWorkDir) await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Decide o layout de cada clipe. Lives mudam de cena (gameplay com câmera no canto, "just chatting" com câmera
 * em tela cheia, cena sem câmera), então a detecção roda por corte, em 3 frames do próprio trecho.
 */
async function resolveClipLayout(
  o: PipelineOptions,
  h: Highlight,
  source: string,
  info: ProbeResult,
  workDir: string,
  base: string,
): Promise<{ layout: LayoutOptions; webcamMode: WebcamMode }> {
  const req = o.layout;
  if (req.preset !== "split") return { layout: req, webcamMode: "fixed" };

  const withCam = (rect: CropRect): LayoutOptions => ({
    ...req,
    webcam: rect,
    camHeightRatio: req.camHeightRatio ?? autoCamHeightRatio(rect, info.width, info.height),
  });

  if (req.webcam) return { layout: withCam(req.webcam), webcamMode: "manual" };
  if (o.autoDetectWebcam === false || !o.analyzer.detectWebcam) {
    return { layout: withCam(DEFAULT_WEBCAM), webcamMode: "default" };
  }

  try {
    const dur = h.end - h.start;
    const frames = await Promise.all(
      [0.2, 0.5, 0.8].map((p, i) =>
        extractFrame(source, h.start + dur * p, path.join(workDir, `${base}_cam${i}.jpg`), 960),
      ),
    );
    const det = await o.analyzer.detectWebcam(frames);

    if (det.kind === "overlay") return { layout: withCam(det.rect), webcamMode: "auto" };
    if (det.kind === "fullscreen_cam") {
      // A câmera é o conteúdo: crop 9:16 centrado nela.
      return { layout: { preset: "center", gameplay: det.rect }, webcamMode: "fullscreen-cam" };
    }
    return { layout: { preset: o.noWebcamPreset ?? "blur", gameplay: req.gameplay }, webcamMode: "no-webcam" };
  } catch (err) {
    console.warn(`[pipeline] ${base}: detecção de webcam falhou, usando posição padrão. ${(err as Error).message}`);
    return { layout: withCam(DEFAULT_WEBCAM), webcamMode: "default" };
  }
}

/**
 * Legendas do clipe: no modo single-pass usa o que veio na curadoria; senão transcreve o trecho isolado.
 * Falha de transcrição não derruba o job: o clipe sai sem legenda e o erro vai para o log.
 */
async function getCaptions(
  o: PipelineOptions,
  h: Highlight,
  workDir: string,
  source: string,
  base: string,
  duration: number,
  status: (msg: string) => Promise<void>,
) {
  if (o.singlePass && h.captions) return sanitizeCaptions(h.captions, duration);
  try {
    await status("transcrevendo trecho...");
    const clipAudio = await extractAudio(source, path.join(workDir, `${base}.mp3`), { start: h.start, duration });
    const captions = await o.analyzer.transcribeClip({
      audioPath: clipAudio,
      duration,
      hookTitle: h.hook_title,
      language: o.language,
    });
    return sanitizeCaptions(captions, duration);
  } catch (err) {
    console.warn(`[pipeline] ${base}: falha ao gerar legendas, seguindo sem legenda. ${(err as Error).message}`);
    return [];
  }
}
