import fs from "node:fs/promises";
import path from "node:path";
import type { CaptionBlock, Highlight, PipelineStage, ProgressFn, RenderedClip, WebcamMode } from "@/types/clip";
import { getConfig } from "@/lib/config";
import { formatTimestamp, parseRange } from "@/lib/time";
import { downloadVideo, fetchMetadata, resolveMedia, type ResolvedMedia } from "@/services/video/ytdlp";
import { extractAudio, extractFrame, probe } from "@/services/video/ffmpeg";
import type { MediaRef } from "@/services/video/media";
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
import { parseFocus, sanitizeInstructions } from "@/lib/focus";
import { fallbackPostPackage, normalizePostPackage, type PostPackage } from "@/lib/post";
import { normalizeHighlights } from "./normalize";
import type { ClipAnalyzer } from "./types";

export interface PipelineOptions {
  jobId: string;
  /** URL do YouTube/Twitch. Use `url` OU `localFile`. */
  url?: string;
  /** Arquivo de vídeo já baixado (pula o yt-dlp). */
  localFile?: string;
  /** Processa só um trecho, ex: "1:00:00-1:20:00". */
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
  /** O que a IA deve procurar (ids de FOCUS_OPTIONS). Vazio = automático. */
  focus?: string[];
  /** Pedido livre do usuário (ex: "a parte do assalto ao banco"). */
  instructions?: string;
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
  /** Canal/streamer de origem (para o crédito nos posts). */
  sourceCreator: string | null;
  sourceDuration: number;
  outputDir: string;
  manifestPath: string;
  clips: RenderedClip[];
}

// Faixas de progresso de cada etapa no total 0..100.
const RANGES: Record<Exclude<PipelineStage, "COMPLETED">, [number, number]> = {
  DOWNLOADING: [0, 20],
  ANALYZING: [20, 50],
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
    // ---------------------------------------------------------------- 1. Fonte
    const src = await prepareSource(o, workDir, emit);
    const sourceTitle = src.title;

    // ---------------------------------------------------------------- 2. Curadoria (IA)
    if (!src.hasAudio) throw new Error("O vídeo não tem faixa de áudio — não há o que analisar.");
    await emit("ANALYZING", 0, src.remote ? "Baixando só o áudio da live..." : "Extraindo áudio leve (mono 64kbps)...");
    let lastAudioEmit = 0;
    const audioPath = await extractAudio(src.analysisAudio, path.join(workDir, "audio.mp3"), {
      start: src.offset,
      duration: src.hasSection ? src.analysisDuration : undefined,
      expectedDuration: src.analysisDuration,
      onProgress: (r) => {
        const now = Date.now();
        if (now - lastAudioEmit < 1500) return;
        lastAudioEmit = now;
        void emit("ANALYZING", r * 0.3, `Baixando áudio... ${Math.round(r * 100)}%`);
      },
    });

    await emit("ANALYZING", 0.3, `Enviando para ${o.analyzer.name}...`);
    const raw = await o.analyzer.findHighlights({
      audioPath,
      sourceTitle,
      sourceDuration: src.analysisDuration,
      clipCount: o.clipCount,
      minDuration: o.minDuration,
      maxDuration: o.maxDuration,
      language: o.language,
      includeCaptions: !!o.singlePass,
      focus: parseFocus((o.focus ?? []).join(",")),
      instructions: sanitizeInstructions(o.instructions),
      onStatus: (msg) => void emit("ANALYZING", 0.5, msg),
    });

    // A IA responde em tempos relativos ao áudio analisado; convertemos para tempos do vídeo original.
    const highlights = normalizeHighlights(raw, {
      sourceDuration: src.analysisDuration,
      minDuration: o.minDuration,
      maxDuration: o.maxDuration,
      clipCount: o.clipCount,
    }).map((h) => ({ ...h, start: h.start + src.offset, end: h.end + src.offset }));
    if (highlights.length === 0) throw new Error("A IA não retornou nenhum corte válido para esse vídeo.");
    await emit("ANALYZING", 1, `${highlights.length} cortes encontrados.`);

    // Links diretos expiram em algumas horas: renova antes de renderizar.
    if (src.refresh) Object.assign(src, await src.refresh());

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
      const { layout, webcamMode } = await resolveClipLayout(o, h, src, workDir, base);

      const { captions, post } = await getClipText(o, h, src, workDir, base, duration, async (msg) =>
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
        video: src.video,
        audio: src.audio,
        start: h.start,
        duration,
        layout,
        assContent: ass,
        workDir,
        outFile,
        hasAudio: src.hasAudio,
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
        post,
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
      sourceCreator: src.creator ?? null,
      sourceDuration: src.totalDuration,
      section: o.section ?? null,
      analyzer: o.analyzer.name,
      focus: o.focus ?? [],
      instructions: o.instructions ?? "",
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
        post: c.post,
        video: c.publicUrl,
        thumbnail: c.thumbnailUrl,
        captions: c.captions,
      })),
    };
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    await o.onProgress?.({ stage: "COMPLETED", percent: 100, message: `${clips.length} cortes prontos.` });
    return {
      jobId: o.jobId,
      sourceTitle,
      sourceCreator: src.creator ?? null,
      sourceDuration: src.totalDuration,
      outputDir: outDir,
      manifestPath,
      clips,
    };
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
  src: PreparedSource,
  workDir: string,
  base: string,
): Promise<{ layout: LayoutOptions; webcamMode: WebcamMode }> {
  const req = o.layout;
  if (req.preset !== "split") return { layout: req, webcamMode: "fixed" };

  const withCam = (rect: CropRect): LayoutOptions => ({
    ...req,
    webcam: rect,
    camHeightRatio: req.camHeightRatio ?? autoCamHeightRatio(rect, src.width, src.height),
  });

  if (req.webcam) return { layout: withCam(req.webcam), webcamMode: "manual" };
  if (o.autoDetectWebcam === false || !o.analyzer.detectWebcam) {
    return { layout: withCam(DEFAULT_WEBCAM), webcamMode: "default" };
  }

  try {
    const dur = h.end - h.start;
    const frames = await Promise.all(
      [0.2, 0.5, 0.8].map((p, i) =>
        extractFrame(src.video, h.start + dur * p, path.join(workDir, `${base}_cam${i}.jpg`), 960),
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
 * Legendas + pacote de postagem do clipe. No modo single-pass as legendas já vieram na curadoria
 * e o pacote sai do título/hashtags dela. Falha aqui não derruba o job: o clipe sai sem legenda
 * e com o pacote mínimo, e o erro vai para o log.
 */
async function getClipText(
  o: PipelineOptions,
  h: Highlight,
  src: PreparedSource,
  workDir: string,
  base: string,
  duration: number,
  status: (msg: string) => Promise<void>,
): Promise<{ captions: CaptionBlock[]; post: PostPackage }> {
  const fallback = fallbackPostPackage(h.hook_title, h.hashtags);
  if (o.singlePass && h.captions) return { captions: sanitizeCaptions(h.captions, duration), post: fallback };
  try {
    await status("transcrevendo trecho e escrevendo os posts...");
    const clipAudio = await extractAudio(src.analysisAudio, path.join(workDir, `${base}.mp3`), {
      start: h.start,
      duration,
    });
    const result = await o.analyzer.transcribeClip({
      audioPath: clipAudio,
      duration,
      hookTitle: h.hook_title,
      language: o.language,
      sourceTitle: src.title,
      creator: src.creator,
      focus: parseFocus((o.focus ?? []).join(",")),
    });
    return {
      captions: sanitizeCaptions(result.captions, duration),
      post: normalizePostPackage(result.post) ?? fallback,
    };
  } catch (err) {
    console.warn(`[pipeline] ${base}: falha ao gerar legendas/posts, seguindo sem legenda. ${(err as Error).message}`);
    return { captions: [], post: fallback };
  }
}

// ============================================================================ Fonte do vídeo

interface PreparedSource {
  title: string;
  /** Canal/streamer, quando o site informa. */
  creator?: string;
  /** Vídeo para render/frames (arquivo local ou URL direta). */
  video: MediaRef;
  /** Áudio separado do vídeo (DASH), se houver. */
  audio?: MediaRef;
  /** Fonte leve de áudio para análise e legendas. */
  analysisAudio: MediaRef;
  width: number;
  height: number;
  hasAudio: boolean;
  totalDuration: number;
  /** Início do trecho analisado no vídeo original (segundos). */
  offset: number;
  /** Duração do áudio analisado (trecho ou vídeo inteiro). */
  analysisDuration: number;
  hasSection: boolean;
  remote: boolean;
  refresh?: () => Promise<Pick<PreparedSource, "video" | "audio" | "analysisAudio">>;
}

type Emit = (stage: "DOWNLOADING", ratio: number, message: string) => Promise<void>;

/**
 * Modo padrão ("stream"): NÃO baixa a live. Pega as URLs diretas com o yt-dlp e deixa o ffmpeg
 * buscar só o que precisa — o áudio leve para a IA e, depois, só os trechos dos cortes em 1080p.
 * DOWNLOAD_MODE=full volta ao comportamento antigo (baixa o vídeo inteiro antes).
 */
async function prepareSource(o: PipelineOptions, workDir: string, emit: Emit): Promise<PreparedSource> {
  const fromFile = async (file: string, title: string): Promise<PreparedSource> => {
    const info = await probe(file);
    if (!info.duration) throw new Error("Não consegui ler a duração do vídeo.");
    return {
      title,
      video: file,
      analysisAudio: file,
      width: info.width,
      height: info.height,
      hasAudio: info.hasAudio,
      totalDuration: info.duration,
      offset: 0,
      analysisDuration: info.duration,
      hasSection: false,
      remote: false,
    };
  };

  if (o.localFile) {
    const file = path.resolve(o.localFile);
    await fs.access(file);
    await emit("DOWNLOADING", 1, `Usando arquivo local ${path.basename(file)}`);
    return fromFile(file, path.basename(file, path.extname(file)));
  }

  await emit("DOWNLOADING", 0, "Lendo informações do vídeo...");
  const liveError = "Essa live ainda está no ar. Espere ela terminar e virar VOD para processar.";

  if (process.env.DOWNLOAD_MODE === "full") {
    const meta = await fetchMetadata(o.url!);
    if (meta.isLive) throw new Error(liveError);
    let lastEmit = 0;
    const file = await downloadVideo(o.url!, workDir, {
      section: o.section,
      signal: o.signal,
      onProgress: (pct) => {
        const now = Date.now();
        if (now - lastEmit < 1000) return;
        lastEmit = now;
        void emit("DOWNLOADING", 0.02 + (pct / 100) * 0.98, `Baixando vídeo... ${pct.toFixed(1)}%`);
      },
    });
    return { ...(await fromFile(path.resolve(file), meta.title)), creator: meta.uploader };
  }

  const media = await resolveMedia(o.url!);
  if (media.meta.isLive) throw new Error(liveError);
  const total = media.meta.duration ?? 0;
  if (!total) throw new Error("Não consegui ler a duração do vídeo.");

  let offset = 0;
  let analysisDuration = total;
  if (o.section) {
    const r = parseRange(o.section);
    if (r.start >= total) throw new Error(`O trecho começa depois do fim do vídeo (${formatTimestamp(total)}).`);
    offset = r.start;
    analysisDuration = Math.min(r.end, total) - r.start;
  }

  const pick = (m: ResolvedMedia) => ({ video: m.video, audio: m.audio, analysisAudio: m.analysisAudio });
  await emit("DOWNLOADING", 1, `"${media.meta.title}" — ${formatTimestamp(total)}, ${media.width}x${media.height}`);
  return {
    title: media.meta.title,
    creator: media.meta.uploader,
    ...pick(media),
    width: media.width,
    height: media.height,
    hasAudio: media.hasAudio,
    totalDuration: total,
    offset,
    analysisDuration,
    hasSection: Boolean(o.section),
    remote: true,
    refresh: async () => pick(await resolveMedia(o.url!)),
  };
}
