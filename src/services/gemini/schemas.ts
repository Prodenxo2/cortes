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

const str = (description: string): Schema => ({ type: Type.STRING, description });
const strList = (description: string): Schema => ({ type: Type.ARRAY, items: { type: Type.STRING }, description });

/** Pacote de postagem por rede (ver src/lib/post.ts). */
export const postPackageSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    titles: strList("Exatamente 3 opções de título, ângulos diferentes, máx. 60 caracteres cada"),
    tiktok: {
      type: Type.OBJECT,
      properties: {
        caption: str("Legenda curta do TikTok (máx. 150 caracteres), com gancho ou pergunta"),
        hashtags: strList("3 a 5 hashtags com #"),
      },
      required: ["caption", "hashtags"],
      propertyOrdering: ["caption", "hashtags"],
    },
    instagram: {
      type: Type.OBJECT,
      properties: {
        caption: str("Legenda do Reels (2 a 4 frases curtas) terminando com chamada para ação"),
        hashtags: strList("5 a 10 hashtags com #, misturando nicho e gerais"),
      },
      required: ["caption", "hashtags"],
      propertyOrdering: ["caption", "hashtags"],
    },
    youtube: {
      type: Type.OBJECT,
      properties: {
        title: str("Título do Short, máx. 80 caracteres, sem #Shorts"),
        description: str("Descrição de 1 a 3 frases sobre o que acontece no corte"),
        tags: strList("5 a 10 tags SEM #"),
      },
      required: ["title", "description", "tags"],
      propertyOrdering: ["title", "description", "tags"],
    },
    pinned_comment: str("Pergunta curta para comentário fixado que puxe respostas"),
  },
  required: ["titles", "tiktok", "instagram", "youtube", "pinned_comment"],
  propertyOrdering: ["titles", "tiktok", "instagram", "youtube", "pinned_comment"],
};

/** Resposta do passo 2 (por clipe): legendas sincronizadas + pacote de postagem. */
export const clipTextResponseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    captions: { type: Type.ARRAY, items: captionBlockSchema },
    post: postPackageSchema,
  },
  required: ["captions", "post"],
  propertyOrdering: ["captions", "post"],
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
      verdict: {
        type: Type.STRING,
        description: "1 frase: por que escolheu esses cortes, ou por que não escolheu nenhum.",
      },
    },
    required: ["clips", "verdict"],
    propertyOrdering: ["clips", "verdict"],
  };
}
