import { Type, type Schema } from "@google/genai";

/** Bloco de legenda: offsets em segundos relativos ao início do clipe/trecho. */
export const captionBlockSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    start_offset: {
      type: Type.NUMBER,
      description: "Segundos (2 casas) desde o início do clipe em que o bloco aparece.",
    },
    end_offset: {
      type: Type.NUMBER,
      description: "Segundos (2 casas) desde o início do clipe em que o bloco some.",
    },
    text: { type: Type.STRING, description: "2 a 5 palavras, transcrição literal." },
    highlight_word: {
      type: Type.STRING,
      description: "A palavra mais impactante do bloco, copiada exatamente como aparece em text.",
    },
  },
  required: ["start_offset", "end_offset", "text", "highlight_word"],
  propertyOrdering: ["start_offset", "end_offset", "text", "highlight_word"],
};

export const captionsResponseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    captions: { type: Type.ARRAY, items: captionBlockSchema },
  },
  required: ["captions"],
};

/** Schema dos cortes. Com includeCaptions=true, cada corte já vem com as legendas (modo single-pass). */
export function highlightsResponseSchema(includeCaptions: boolean, maxClips: number): Schema {
  const properties: Record<string, Schema> = {
    start_time: { type: Type.STRING, description: "Início no áudio, formato HH:MM:SS.mmm" },
    end_time: { type: Type.STRING, description: "Fim no áudio, formato HH:MM:SS.mmm" },
    viral_score: { type: Type.INTEGER, minimum: 0, maximum: 100, description: "Potencial viral 0-100" },
    hook_title: { type: Type.STRING, description: "Título curto e chamativo (máx. 60 caracteres)" },
    hashtags: { type: Type.ARRAY, items: { type: Type.STRING }, description: "4 a 8 hashtags com #" },
    reason: { type: Type.STRING, description: "Por que esse trecho viraliza (1-2 frases)" },
  };
  const required = ["start_time", "end_time", "viral_score", "hook_title", "hashtags", "reason"];
  if (includeCaptions) {
    properties.captions = { type: Type.ARRAY, items: captionBlockSchema };
    required.push("captions");
  }

  return {
    type: Type.OBJECT,
    properties: {
      clips: {
        type: Type.ARRAY,
        description: `No máximo ${maxClips} cortes, ordenados por viral_score decrescente.`,
        items: {
          type: Type.OBJECT,
          properties,
          required,
          propertyOrdering: required,
        },
      },
    },
    required: ["clips"],
  };
}
