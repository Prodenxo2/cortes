import type { LayoutOptions } from "@/services/video/layouts";

/** Bloco de legenda com tempos relativos ao início do clipe (segundos). */
export interface CaptionBlock {
  start_offset: number;
  end_offset: number;
  text: string;
  highlight_word: string;
}

/** Corte sugerido pela IA, já normalizado (tempos em segundos no vídeo original). */
export interface Highlight {
  start: number;
  end: number;
  viral_score: number;
  hook_title: string;
  hashtags: string[];
  reason: string;
  /** Presente quando a análise roda em modo single-pass. */
  captions?: CaptionBlock[];
}

/**
 * De onde veio o recorte da webcam usado no clipe:
 * auto = detectado pela IA; manual = --cam / layoutConfig; default = posição padrão (detecção indisponível/falhou);
 * no-webcam = IA não achou câmera (usa layout de fallback); fullscreen-cam = câmera ocupa a tela (crop central nela);
 * fixed = layout escolhido não usa webcam (center/blur).
 */
export type WebcamMode = "auto" | "manual" | "default" | "no-webcam" | "fullscreen-cam" | "fixed";

export interface RenderedClip extends Highlight {
  position: number;
  /** Layout efetivamente usado neste clipe (pode diferir do pedido, por causa da detecção). */
  layout: LayoutOptions;
  webcamMode: WebcamMode;
  captions: CaptionBlock[];
  /** Caminho absoluto no disco. */
  filePath: string;
  /** Caminho servido pelo Next a partir de /public. */
  publicUrl: string;
  thumbnailPath?: string;
  thumbnailUrl?: string;
}

export type PipelineStage = "DOWNLOADING" | "ANALYZING" | "RENDERING" | "COMPLETED";

export interface ProgressEvent {
  stage: PipelineStage;
  /** Progresso total do job, 0..100. */
  percent: number;
  message: string;
}

export type ProgressFn = (e: ProgressEvent) => void | Promise<void>;
