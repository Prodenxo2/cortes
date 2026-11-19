import fs from "node:fs/promises";
import { createPartFromBase64, createUserContent, Type, type Schema } from "@google/genai";
import type { WebcamDetection } from "@/services/pipeline/types";
import { insetRect, type CropRect } from "@/services/video/layouts";
import { generateWithFallback, getGenAI, parseJsonResponse } from "./client";

const webcamSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    layout: {
      type: Type.STRING,
      format: "enum",
      enum: ["overlay", "fullscreen_cam", "none"],
      description: "overlay = câmera numa caixa sobre o jogo; fullscreen_cam = câmera ocupa a tela; none = sem câmera",
    },
    is_real_camera: {
      type: Type.BOOLEAN,
      description: "true SÓ se a caixa mostra uma pessoa REAL filmada por câmera (não gráfico de jogo).",
    },
    box_2d: {
      type: Type.ARRAY,
      items: { type: Type.INTEGER },
      description: "[ymin, xmin, ymax, xmax] normalizado 0-1000 da imagem da câmera. Vazio se layout = none.",
    },
    seen_in_frames: { type: Type.INTEGER, description: "Em quantas das imagens a mesma caixa de câmera aparece." },
    confidence: { type: Type.NUMBER, description: "0 a 1" },
    reason: { type: Type.STRING, description: "1 frase curta justificando." },
  },
  required: ["layout", "is_real_camera", "box_2d", "seen_in_frames", "confidence", "reason"],
  propertyOrdering: ["layout", "is_real_camera", "box_2d", "seen_in_frames", "confidence", "reason"],
};

function webcamPrompt(n: number): string {
  return [
    `Estas são ${n} imagens do MESMO trecho de uma live de games (frames 16:9).`,
    `Muitos streamers mostram a própria webcam (facecam) numa caixa SOBREPOSTA ao jogo; cada um coloca num lugar e tamanho diferente.`,
    ``,
    `Encontre a caixa da webcam do streamer, se existir.`,
    `Como reconhecer a webcam de verdade:`,
    `- é um retângulo SOBREPOSTO com borda nítida, na mesma posição em todas as imagens (o jogo muda em volta, a caixa não sai do lugar);`,
    `- mostra uma pessoa REAL filmada por câmera: quarto, parede, fone, microfone, cadeira, luz de LED, imagem com granulado de câmera;`,
    `- normalmente ocupa entre 5% e 35% da tela, quase sempre perto de um canto ou borda.`,
    ``,
    `NÃO é webcam (cuidado — jogos como GTA são fotorrealistas):`,
    `- personagens, NPCs, rostos em cutscene, retratos ou espelhos DENTRO do jogo;`,
    `- HUD, minimapa, chat, alertas, logos, molduras decorativas vazias.`,
    `Se a câmera não aparecer nessas imagens (cutscene em tela cheia, câmera desligada, só gameplay), responda layout "none".`,
    ``,
    `box_2d = [ymin, xmin, ymax, xmax] de 0 a 1000 cobrindo a IMAGEM da câmera inteira (o retângulo do vídeo, não só o rosto, sem a moldura).`,
    `layout "fullscreen_cam" = a câmera do streamer ocupa a tela toda ou quase toda (cena de conversa, sem jogo).`,
    `Na dúvida, prefira "none": um recorte errado estraga o vídeo; sem câmera ele só fica com o jogo inteiro.`,
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

  const response = await generateWithFallback("generateContent(webcam)", (m) =>
    ai.models.generateContent({
      model: m,
      contents: createUserContent([...images, webcamPrompt(framePaths.length)]),
      config: { responseMimeType: "application/json", responseSchema: webcamSchema },
    }),
  );

  const data = parseJsonResponse<{
    layout?: string;
    is_real_camera?: boolean;
    box_2d?: number[];
    seen_in_frames?: number;
    confidence?: number;
    reason?: string;
  }>(response.text, "webcam");
  const confidence = Math.min(1, Math.max(0, Number(data.confidence) || 0));
  const rect = boxToRect(data.box_2d);
  const why = data.reason ?? "";

  if (data.layout === "none" || !rect || data.is_real_camera === false) return { kind: "none", confidence, reason: why };

  const area = rect.w * rect.h;
  if (data.layout === "fullscreen_cam" || area > 0.6) {
    return confidence >= 0.6 ? { kind: "fullscreen_cam", rect, confidence, reason: why } : { kind: "none", confidence, reason: why };
  }

  // Validações de sanidade: um recorte errado é pior do que nenhum recorte.
  const aspect = (rect.w * 16) / (rect.h * 9); // proporção real em pixels num frame 16:9
  const seen = Number(data.seen_in_frames) || 0;
  if (
    confidence < 0.6 ||
    area < 0.015 ||
    area > 0.45 ||
    aspect < 0.5 ||
    aspect > 2.6 ||
    (framePaths.length >= 3 && seen < 2)
  ) {
    return { kind: "none", confidence, reason: `rejeitado na validação (${why})` };
  }

  // Tira ~2% de cada lado: bordas/molduras do overlay quase sempre ficam na beirada da caixa.
  return { kind: "overlay", rect: insetRect(rect, 0.02), confidence, reason: why };
}
