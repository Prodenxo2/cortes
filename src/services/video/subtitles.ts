import type { CaptionBlock } from "@/types/clip";
import { formatAssTime } from "@/lib/time";
import { CANVAS_H, CANVAS_W } from "./layouts";

export interface AssStyleOptions {
  anchor: { x: number; y: number };
  font: string;
  fontSize: number;
  /** "#RRGGBB" */
  color: string;
  /** "#RRGGBB" — cor da palavra de destaque */
  highlightColor: string;
  uppercase?: boolean;
  /** Negrito do estilo (default true). */
  bold?: boolean;
}

/** "#RRGGBB" -> "&H00BBGGRR" (o .ass usa BGR com alpha na frente). */
export function hexToAss(hex: string, alpha = 0): string {
  const clean = hex.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) throw new Error(`Cor inválida: ${hex}`);
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  const a = alpha.toString(16).padStart(2, "0");
  return `&H${a}${b}${g}${r}`.toUpperCase();
}

/** "#RRGGBB" -> "&HBBGGRR&" (formato usado dentro de override tags como \c). */
function hexToAssTag(hex: string): string {
  return `${hexToAss(hex).replace(/^&H00/, "&H")}&`;
}

/** Remove caracteres que o .ass interpreta como tags/comandos. */
function escapeAss(text: string): string {
  return text
    .replace(/\\/g, "/")
    .replace(/\{/g, "(")
    .replace(/\}/g, ")")
    .replace(/\s+/g, " ")
    .trim();
}

const stripAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const normalizeWord = (s: string) => stripAccents(s.toLowerCase()).replace(/[^\p{L}\p{N}]/gu, "");

/**
 * Colore a palavra de destaque. Compara sem acento/pontuação, para "INSANO!" casar com "insano".
 * Se a IA mandar uma expressão de várias palavras, destaca a sequência inteira.
 */
function applyHighlight(text: string, highlight: string, colorTag: string, resetTag: string): string {
  const words = text.split(" ");
  const target = highlight.split(/\s+/).map(normalizeWord).filter(Boolean);
  if (target.length === 0) return words.map(escapeAss).join(" ");

  const norm = words.map(normalizeWord);
  let at = -1;
  for (let i = 0; i + target.length <= norm.length; i++) {
    if (target.every((t, j) => norm[i + j] === t)) {
      at = i;
      break;
    }
  }
  return words
    .map((w, i) => {
      const safe = escapeAss(w);
      if (at === -1) return safe;
      if (i === at && i === at + target.length - 1) return `{${colorTag}}${safe}{${resetTag}}`;
      if (i === at) return `{${colorTag}}${safe}`;
      if (i === at + target.length - 1) return `${safe}{${resetTag}}`;
      return safe;
    })
    .join(" ");
}

/**
 * Limpa os blocos vindos da IA: ordena, prende dentro do clipe, remove sobreposição
 * e fecha buracos curtos (evita a legenda "piscar").
 */
export function sanitizeCaptions(captions: CaptionBlock[], clipDuration: number): CaptionBlock[] {
  const MIN_DUR = 0.25;
  const MAX_GAP_TO_FILL = 0.3;

  const sorted = captions
    .filter((c) => c && typeof c.text === "string" && c.text.trim())
    .map((c) => ({
      ...c,
      start_offset: clamp(Number(c.start_offset), 0, clipDuration),
      end_offset: clamp(Number(c.end_offset), 0, clipDuration),
      text: c.text.trim(),
      highlight_word: (c.highlight_word ?? "").trim(),
    }))
    .filter((c) => Number.isFinite(c.start_offset) && Number.isFinite(c.end_offset))
    .sort((a, b) => a.start_offset - b.start_offset);

  const out: CaptionBlock[] = [];
  for (const c of sorted) {
    if (c.end_offset - c.start_offset < MIN_DUR) c.end_offset = Math.min(clipDuration, c.start_offset + MIN_DUR);
    const prev = out[out.length - 1];
    if (prev) {
      if (c.start_offset < prev.end_offset) prev.end_offset = c.start_offset; // corta sobreposição
      else if (c.start_offset - prev.end_offset <= MAX_GAP_TO_FILL) prev.end_offset = c.start_offset; // fecha buraco
      if (prev.end_offset - prev.start_offset < 0.05) out.pop();
    }
    if (c.end_offset > c.start_offset) out.push(c);
  }
  return out;
}

export function buildAss(captions: CaptionBlock[], style: AssStyleOptions): string {
  const primary = hexToAss(style.color);
  const primaryTag = hexToAssTag(style.color);
  const hlTag = hexToAssTag(style.highlightColor);
  const outline = "&H00000000";
  const shadow = "&H96000000";
  const { x, y } = style.anchor;

  const header = [
    "[Script Info]",
    "; Gerado por cortes",
    "ScriptType: v4.00+",
    `PlayResX: ${CANVAS_W}`,
    `PlayResY: ${CANVAS_H}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: TV.709",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Viral,${style.font},${style.fontSize},${primary},${primary},${outline},${shadow},${style.bold === false ? 0 : -1},0,0,0,100,100,1,0,1,7,4,5,70,70,0,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  // "Pop" de entrada: começa em 80% e cresce até 100% em 90ms.
  const pop = `\\an5\\pos(${x},${y})\\fscx80\\fscy80\\t(0,90,\\fscx100\\fscy100)`;

  const events = captions.map((c) => {
    const text = style.uppercase === false ? c.text : c.text.toLocaleUpperCase("pt-BR");
    const hl = style.uppercase === false ? c.highlight_word : c.highlight_word.toLocaleUpperCase("pt-BR");
    const body = applyHighlight(text, hl, `\\c${hlTag}`, `\\c${primaryTag}`);
    return `Dialogue: 0,${formatAssTime(c.start_offset)},${formatAssTime(c.end_offset)},Viral,,0,0,0,,{${pop}}${body}`;
  });

  // BOM: o libass lê UTF-8 sem BOM, mas editores no Windows abrem melhor com ele.
  return "﻿" + [...header, ...events, ""].join("\n");
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
