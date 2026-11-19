import type { CaptionBlock } from "@/types/clip";
import type { CropRect } from "@/services/video/layouts";

/** Formato bruto que a IA devolve para cada corte (antes da normalização). */
export interface RawHighlight {
  start_time: string;
  end_time: string;
  viral_score: number;
  hook_title: string;
  hashtags: string[];
  reason: string;
  captions?: CaptionBlock[];
}

export interface FindHighlightsInput {
  audioPath: string;
  sourceTitle: string;
  sourceDuration: number;
  clipCount: number;
  minDuration: number;
  maxDuration: number;
  language: string;
  /** Pede legendas junto com os cortes (1 chamada só). */
  includeCaptions: boolean;
  /** Ids de FOCUS_OPTIONS (risadas, hype...). Vazio = automático. */
  focus: string[];
  /** Pedido livre do usuário sobre quais momentos escolher. */
  instructions: string;
  onStatus?: (msg: string) => void;
}

export interface TranscribeClipInput {
  /** Áudio JÁ recortado no intervalo do clipe. */
  audioPath: string;
  duration: number;
  hookTitle: string;
  language: string;
}

/**
 * Resultado da detecção de webcam em alguns frames do trecho:
 * - overlay: câmera em uma caixa sobre a gameplay (vira o layout split);
 * - fullscreen_cam: a câmera é a tela toda/maior parte (cena "just chatting");
 * - none: só gameplay, sem câmera.
 */
export type WebcamDetection =
  | { kind: "overlay"; rect: CropRect; confidence: number }
  | { kind: "fullscreen_cam"; rect?: CropRect; confidence: number }
  | { kind: "none"; confidence: number };

/**
 * Contrato do "cérebro" do pipeline. A implementação real é o Gemini;
 * o MockAnalyzer permite testar download/render sem gastar API.
 */
export interface ClipAnalyzer {
  readonly name: string;
  findHighlights(input: FindHighlightsInput): Promise<RawHighlight[]>;
  transcribeClip(input: TranscribeClipInput): Promise<CaptionBlock[]>;
  /** Opcional: localiza a webcam do streamer em frames JPG do mesmo trecho. */
  detectWebcam?(framePaths: string[]): Promise<WebcamDetection>;
}
