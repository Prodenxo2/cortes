import type { CaptionBlock } from "@/types/clip";
import { formatTimestamp } from "@/lib/time";
import type {
  ClipAnalyzer,
  ClipTextResult,
  FindHighlightsInput,
  RawHighlight,
  TranscribeClipInput,
  WebcamDetection,
} from "./types";

/**
 * Analisador falso: espalha cortes pelo vídeo e gera legendas de exemplo.
 * Serve para validar download + layout + legendas + encode sem chamar a API (flag --mock).
 */
export class MockAnalyzer implements ClipAnalyzer {
  readonly name = "mock";
  detectWebcam?: (framePaths: string[]) => Promise<WebcamDetection>;

  /** @param webcamDetector opcional: permite usar a detecção real de webcam mesmo no modo mock. */
  constructor(webcamDetector?: (framePaths: string[]) => Promise<WebcamDetection>) {
    if (webcamDetector) this.detectWebcam = webcamDetector;
  }

  async findHighlights(input: FindHighlightsInput): Promise<RawHighlight[]> {
    const dur = Math.min(input.maxDuration, Math.max(input.minDuration, (input.minDuration + input.maxDuration) / 2));
    const slots = Math.max(1, Math.min(input.clipCount, Math.floor(input.sourceDuration / dur)));
    const step = input.sourceDuration / slots;

    return Array.from({ length: slots }, (_, i) => {
      const start = i * step;
      const end = Math.min(input.sourceDuration, start + dur);
      const clip: RawHighlight = {
        start_time: formatTimestamp(start),
        end_time: formatTimestamp(end),
        viral_score: 90 - i * 7,
        hook_title: `Corte de teste #${i + 1}`,
        hashtags: ["#gta6", "#gtarp", "#cortes", "#live"],
        reason: "Gerado pelo modo --mock (sem IA).",
      };
      if (input.includeCaptions) clip.captions = fakeCaptions(end - start);
      return clip;
    });
  }

  async transcribeClip(input: TranscribeClipInput): Promise<ClipTextResult> {
    return {
      captions: fakeCaptions(input.duration),
      post: {
        titles: ["Ninguém esperava esse final 😳", "O amigo dele NÃO perdoou kkkk", "Fuga de helicóptero no GTA RP"],
        tiktok: { caption: "ele achou que ia dar certo 💀", hashtags: ["#gtarp", "#gta6", "#cortes"] },
        instagram: {
          caption: "A fuga mais caótica da live.\nMarca aquele amigo que faria isso 👇",
          hashtags: ["#gtarp", "#gta6", "#gtav", "#cortesdelive", "#gamer"],
        },
        youtube: {
          title: "A fuga mais caótica do GTA RP",
          description: "Corte de teste gerado no modo mock.",
          tags: ["gta rp", "gta 6", "cortes"],
        },
        pinned_comment: "Qual foi a pior fuga que você já viu?",
      },
    };
  }
}

const PHRASES: Array<[string, string]> = [
  ["NÃO ACREDITO NISSO", "ACREDITO"],
  ["OLHA O QUE ELE FEZ", "FEZ"],
  ["CORRE CORRE CORRE", "CORRE"],
  ["A POLÍCIA TÁ AQUI", "POLÍCIA"],
  ["MANO QUE ISSO", "ISSO"],
  ["KKKKKKK", "KKKKKKK"],
];

function fakeCaptions(duration: number): CaptionBlock[] {
  const out: CaptionBlock[] = [];
  const blockLen = 1.6;
  for (let t = 0.3, i = 0; t + 0.5 < duration; t += blockLen, i++) {
    const [text, highlight_word] = PHRASES[i % PHRASES.length];
    out.push({ start_offset: t, end_offset: Math.min(duration, t + blockLen - 0.1), text, highlight_word });
  }
  return out;
}
