import fs from "node:fs/promises";
import { createPartFromBase64, createPartFromUri, createUserContent, type Part } from "@google/genai";
import type { CaptionBlock } from "@/types/clip";
import type {
  ClipAnalyzer,
  FindHighlightsInput,
  RawHighlight,
  TranscribeClipInput,
  WebcamDetection,
} from "@/services/pipeline/types";
import { getGenAI, getModel, parseJsonResponse, withRetry } from "./client";
import { deleteFileQuietly, uploadAndWaitActive } from "./files";
import { captionsPrompt, highlightsPrompt } from "./prompts";
import { detectWebcamWithGemini } from "./webcam";
import { captionsResponseSchema, highlightsResponseSchema } from "./schemas";

/** Abaixo disso o áudio vai inline (base64) em vez de passar pela File API. */
const INLINE_LIMIT_BYTES = 15 * 1024 * 1024;

export class GeminiAnalyzer implements ClipAnalyzer {
  readonly name = "gemini";

  /**
   * Passo 1: sobe o áudio completo pela File API, pede os cortes com Structured Output
   * e apaga o arquivo remoto no final (mesmo se der erro).
   */
  async findHighlights(input: FindHighlightsInput): Promise<RawHighlight[]> {
    const ai = getGenAI();
    const model = getModel();
    const file = await uploadAndWaitActive(input.audioPath, "audio/mpeg", { onStatus: input.onStatus });

    try {
      input.onStatus?.(`Analisando a live com ${model}...`);
      const prompt = highlightsPrompt({
        title: input.sourceTitle,
        durationSec: input.sourceDuration,
        clipCount: input.clipCount,
        minDuration: input.minDuration,
        maxDuration: input.maxDuration,
        language: input.language,
        includeCaptions: input.includeCaptions,
      });

      const response = await withRetry(
        () =>
          ai.models.generateContent({
            model,
            contents: createUserContent([createPartFromUri(file.uri, file.mimeType), prompt]),
            config: {
              responseMimeType: "application/json",
              responseSchema: highlightsResponseSchema(input.includeCaptions, input.clipCount),
            },
          }),
        "generateContent(highlights)",
      );

      const data = parseJsonResponse<{ clips?: RawHighlight[] }>(response.text, "highlights");
      return Array.isArray(data.clips) ? data.clips : [];
    } finally {
      await deleteFileQuietly(file.name);
    }
  }

  /**
   * Passo 2 (por clipe): transcreve só o trecho do corte. Áudio de 30-60s em 64kbps tem < 1 MB,
   * então vai inline — sem upload/poll/delete e com timestamps bem mais precisos que no áudio inteiro.
   */
  async transcribeClip(input: TranscribeClipInput): Promise<CaptionBlock[]> {
    const ai = getGenAI();
    const model = getModel();
    const stat = await fs.stat(input.audioPath);
    const prompt = captionsPrompt({ durationSec: input.duration, hookTitle: input.hookTitle });

    let remoteName: string | undefined;
    let audioPart: Part;
    if (stat.size <= INLINE_LIMIT_BYTES) {
      const b64 = (await fs.readFile(input.audioPath)).toString("base64");
      audioPart = createPartFromBase64(b64, "audio/mpeg");
    } else {
      const file = await uploadAndWaitActive(input.audioPath, "audio/mpeg");
      remoteName = file.name;
      audioPart = createPartFromUri(file.uri, file.mimeType);
    }

    try {
      const response = await withRetry(
        () =>
          ai.models.generateContent({
            model,
            contents: createUserContent([audioPart, prompt]),
            config: {
              responseMimeType: "application/json",
              responseSchema: captionsResponseSchema,
            },
          }),
        "generateContent(captions)",
      );
      const data = parseJsonResponse<{ captions?: CaptionBlock[] }>(response.text, "captions");
      return Array.isArray(data.captions) ? data.captions : [];
    } finally {
      if (remoteName) await deleteFileQuietly(remoteName);
    }
  }

  /** Passo extra (por clipe): acha a caixa da webcam em alguns frames do trecho. */
  detectWebcam(framePaths: string[]): Promise<WebcamDetection> {
    return detectWebcamWithGemini(framePaths);
  }
}
