import fs from "node:fs/promises";
import { createPartFromBase64, createUserContent, Type, type Schema } from "@google/genai";
import type { WebcamDetection } from "@/services/pipeline/types";
import { insetRect, type CropRect } from "@/services/video/layouts";
import { getGenAI, getModel, parseJsonResponse, withRetry } from "./client";

const webcamSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    layout: {
      type: Type.STRING,
      format: "enum",
      enum: ["overlay", "fullscreen_cam", "none"],
      description: "overlay = câmera numa caixa sobre o jogo; fullscreen_cam = câmera ocupa a tela; none = sem câmera",
    },
    box_2d: {
      type: Type.ARRAY,
      items: { type: Type.INTEGER },
      description: "[ymin, xmin, ymax, xmax] normalizado 0-1000 da imagem da câmera. Vazio se layout = none.",
    },
    confidence: { type: Type.NUMBER, description: "0 a 1" },
  },
  required: ["layout", "box_2d", "confidence"],
  propertyOrdering: ["layout", "box_2d", "confidence"],
};

function webcamPrompt(n: number): string {
  return [
    `Estas são ${n} imagens do MESMO trecho de uma live de games (frames 16:9).`,
    `Muitos streamers mostram a própria webcam (facecam) numa caixa sobre a gameplay; cada um coloca num lugar e tamanho diferente.`,
    ``,
    `Encontre a caixa da webcam que mostra o streamer (pessoa real, quarto/cenário real).`,
    `- box_2d = [ymin, xmin, ymax, xmax] normalizado de 0 a 1000, cobrindo a IMAGEM DA CÂMERA inteira (o retângulo do vídeo da câmera, não só o rosto).`,
    `- Não inclua molduras decorativas, nome do canal, chat, alertas, logos ou barras de doação.`,
    `- Se a posição muda entre as imagens, use a que aparece na maioria.`,
    `- Pessoas DENTRO do jogo (personagens, NPCs, cutscenes) NÃO são webcam.`,
    ``,
    `layout:`,
    `- "overlay": existe uma caixa de câmera sobre o conteúdo (caso mais comum).`,
    `- "fullscreen_cam": a câmera ocupa a tela toda ou quase toda (cena de conversa, sem jogo). Retorne a caixa da câmera.`,
    `- "none": não há câmera do streamer. Retorne box_2d vazio.`,
  ].join("\n");
}

/** Converte box_2d [ymin,xmin,ymax,xmax] (0-1000) em frações x,y,w,h, validando. */
function boxToRect(box: unknown): CropRect | null {
  if (!Array.isArray(box) || box.length !== 4) return null;
  const [ymin, xmin, ymax, xmax] = box.map((v) => Math.min(1000, Math.max(0, Number(v))) / 1000);
  if (![ymin, xmin, ymax, xmax].every(Number.isFinite)) return null;
  if (xmax - xmin < 0.03 || ymax - ymin < 0.03) return null;
  return { x: xmin, y: ymin, w: xmax - xmin, h: ymax - ymin };
}

export async function detectWebcamWithGemini(framePaths: string[]): Promise<WebcamDetection> {
  const ai = getGenAI();
  const images = await Promise.all(
    framePaths.map(async (p) => createPartFromBase64((await fs.readFile(p)).toString("base64"), "image/jpeg")),
  );

  const response = await withRetry(
    () =>
      ai.models.generateContent({
        model: getModel(),
        contents: createUserContent([...images, webcamPrompt(framePaths.length)]),
        config: { responseMimeType: "application/json", responseSchema: webcamSchema },
      }),
    "generateContent(webcam)",
  );

  const data = parseJsonResponse<{ layout?: string; box_2d?: number[]; confidence?: number }>(response.text, "webcam");
  const confidence = Math.min(1, Math.max(0, Number(data.confidence) || 0));
  const rect = boxToRect(data.box_2d);

  if (data.layout === "none" || !rect) return { kind: "none", confidence };

  const area = rect.w * rect.h;
  if (data.layout === "fullscreen_cam" || area > 0.6) return { kind: "fullscreen_cam", rect, confidence };
  if (area < 0.01 || confidence < 0.35) return { kind: "none", confidence };

  // Tira ~2% de cada lado: bordas/molduras do overlay quase sempre ficam na beirada da caixa.
  return { kind: "overlay", rect: insetRect(rect, 0.02), confidence };
}
