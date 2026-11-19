/**
 * "O que a IA deve procurar" — compartilhado entre o formulário (client), o banco e o prompt do Gemini.
 * Sem imports de servidor.
 */

export interface FocusOption {
  id: string;
  label: string;
  hint: string;
  /** Instrução que entra no prompt da curadoria. */
  prompt: string;
}

export const FOCUS_OPTIONS: FocusOption[] = [
  {
    id: "hype",
    label: "Picos de hype",
    hint: "Gritos, euforia, comemoração",
    prompt:
      "PICOS DE HYPE: os momentos mais intensos da live — gritos, euforia, comemoração, o streamer perdendo a cabeça de empolgação, vitórias e reviravoltas.",
  },
  {
    id: "risadas",
    label: "Risadas",
    hint: "Gargalhadas e momentos engraçados",
    prompt:
      "RISADAS: gargalhadas genuínas do streamer e de quem está na call, piadas, situações absurdas, bugs engraçados, zoeira. Quanto mais risada real no áudio, maior o score.",
  },
  {
    id: "sustos",
    label: "Sustos e tensão",
    hint: "Jumpscares, perseguições",
    prompt:
      "SUSTOS E TENSÃO: jumpscares, gritos de susto, perseguições, fugas por pouco, silêncio tenso seguido de explosão.",
  },
  {
    id: "treta",
    label: "Treta e raiva",
    hint: "Rage, discussões, indignação",
    prompt:
      "TRETA E RAIVA: rage, discussões na call ou com o chat, indignação, reclamações exageradas e engraçadas. Evite ataques pessoais graves ou discurso de ódio.",
  },
  {
    id: "jogadas",
    label: "Jogadas épicas",
    hint: "Clutch, fail, plot twist",
    prompt:
      "JOGADAS ÉPICAS: clutch, jogada impossível, fail épico, plot twist, missão concluída no limite — onde a reação do streamer deixa claro que foi especial.",
  },
  {
    id: "historias",
    label: "Histórias e opiniões",
    hint: "Falas interessantes, polêmicas",
    prompt:
      "HISTÓRIAS E OPINIÕES: o streamer contando uma história boa, dando uma opinião forte ou polêmica, conselho ou reflexão que se sustenta sozinha fora da live.",
  },
];

export const MAX_FOCUS = 3;
export const MAX_INSTRUCTIONS = 300;

const BY_ID = new Map(FOCUS_OPTIONS.map((f) => [f.id, f]));

/** "risadas,sustos" -> ["risadas","sustos"] (só ids válidos, sem repetição, no máximo MAX_FOCUS). */
export function parseFocus(value: string | null | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.split(",").map((v) => v.trim()).filter((v) => BY_ID.has(v)))].slice(0, MAX_FOCUS);
}

export function focusLabels(ids: string[]): string[] {
  return ids.map((id) => BY_ID.get(id)?.label ?? id);
}

export function focusPrompts(ids: string[]): string[] {
  return ids.map((id) => BY_ID.get(id)?.prompt).filter((p): p is string => Boolean(p));
}

/** Limpa o texto livre do usuário antes de ir para o prompt. */
export function sanitizeInstructions(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_INSTRUCTIONS);
}
