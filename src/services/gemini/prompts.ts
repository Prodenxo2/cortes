import { formatTimestamp } from "@/lib/time";

export interface HighlightsPromptInput {
  title: string;
  durationSec: number;
  clipCount: number;
  minDuration: number;
  maxDuration: number;
  language: string;
  includeCaptions: boolean;
}

export function highlightsPrompt(p: HighlightsPromptInput): string {
  const end = formatTimestamp(p.durationSec);
  const lines = [
    `Você é um editor sênior de vídeos curtos (TikTok, YouTube Shorts, Reels) especializado em lives de games (GTA RP, GTA 6, FPS, terror, IRL).`,
    `Você recebeu o ÁUDIO completo da live/VOD "${p.title}", com duração de ${end}.`,
    ``,
    `TAREFA: encontre os ${p.clipCount} melhores momentos para virar cortes verticais virais.`,
    ``,
    `CRITÉRIOS (em ordem de peso):`,
    `1. Pico emocional claro: grito, risada genuína, raiva, susto, choque, comemoração, silêncio tenso seguido de explosão.`,
    `2. Gancho nos 2 primeiros segundos: o corte já começa com algo acontecendo ou com uma frase que gera curiosidade. Nada de "então galera..." ou silêncio.`,
    `3. História fechada: setup -> tensão -> payoff. Termina logo depois do payoff/reação, sem enrolação.`,
    `4. Contexto do jogo que se entende sem ter visto a live (perseguição, morte, plot twist, bug engraçado, interação com chat/donate, treta na call).`,
    `5. Fala clara; evite trechos dominados por música alta ou ruído.`,
    ``,
    `REGRAS DE TEMPO:`,
    `- Cada corte deve durar entre ${p.minDuration}s e ${p.maxDuration}s.`,
    `- start_time e end_time no formato HH:MM:SS.mmm, relativos ao início deste áudio (00:00:00.000) e dentro de 00:00:00.000 a ${end}.`,
    `- Comece ~0.5s antes da primeira palavra do gancho e termine no fim natural de uma frase. Nunca corte no meio de uma palavra.`,
    `- Os cortes NÃO podem se sobrepor.`,
    `- Ordene por viral_score decrescente. Seja crítico: 90+ só para momentos realmente excepcionais.`,
    ``,
    `TEXTOS (idioma: ${p.language}):`,
    `- hook_title: título curto e chamativo, máx. 60 caracteres, estilo TikTok, sem mentir sobre o conteúdo.`,
    `- hashtags: 4 a 8 hashtags relevantes, cada uma começando com #, sem espaços.`,
    `- reason: 1 a 2 frases explicando por que o trecho tem potencial viral.`,
  ];

  if (p.includeCaptions) {
    lines.push(
      ``,
      `LEGENDAS (campo captions de cada corte):`,
      `- Transcrição LITERAL da fala do trecho, no idioma original (não traduza). Mantenha gírias, palavrões e onomatopeias ("KKKKK", "AAAAH").`,
      `- Blocos de 2 a 5 palavras (máx. ~24 caracteres), quebrando nas pausas naturais.`,
      `- start_offset/end_offset em SEGUNDOS (2 casas) relativos ao start_time do corte (o primeiro bloco começa perto de 0).`,
      `- highlight_word: a palavra mais forte do bloco, copiada exatamente como aparece em text.`,
    );
  }

  lines.push(
    ``,
    `Se houver menos momentos bons do que ${p.clipCount}, retorne menos cortes: qualidade acima de quantidade.`,
  );
  return lines.join("\n");
}

export function captionsPrompt(p: { durationSec: number; hookTitle: string }): string {
  const dur = p.durationSec.toFixed(2);
  return [
    `Transcreva LITERALMENTE a fala deste trecho de áudio (duração ${dur}s) para legendas dinâmicas de vídeo vertical.`,
    `Contexto: o trecho foi escolhido como um corte viral com o título "${p.hookTitle}".`,
    ``,
    `REGRAS:`,
    `- Idioma original da fala (não traduza). Mantenha gírias, palavrões e onomatopeias relevantes ("KKKKK", "AAAAH").`,
    `- Inclua falas de outras pessoas na call se forem audíveis.`,
    `- Blocos de 2 a 5 palavras (máx. ~24 caracteres), quebrando nas pausas naturais.`,
    `- start_offset e end_offset em segundos com 2 casas decimais, relativos ao início deste áudio (0.00).`,
    `  O bloco aparece quando a primeira palavra começa a ser dita e some quando a última termina.`,
    `- Blocos em ordem, sem sobreposição, todos entre 0.00 e ${dur}.`,
    `- highlight_word: a palavra mais impactante do bloco, copiada exatamente como aparece em text.`,
    `- Se não houver fala, retorne captions como lista vazia.`,
  ].join("\n");
}
