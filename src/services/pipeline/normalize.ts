import type { Highlight } from "@/types/clip";
import { parseTimestamp } from "@/lib/time";
import type { RawHighlight } from "./types";

export interface NormalizeOptions {
  sourceDuration: number;
  minDuration: number;
  maxDuration: number;
  clipCount: number;
}

/**
 * Transforma a resposta da IA em cortes válidos:
 * - descarta timestamps ilegíveis;
 * - prende os tempos dentro do vídeo e dentro de [min, max] de duração;
 * - remove sobreposições mantendo o de maior viral_score;
 * - limpa hashtags e textos.
 */
export function normalizeHighlights(raw: RawHighlight[], o: NormalizeOptions): Highlight[] {
  const total = o.sourceDuration;
  const minD = Math.min(o.minDuration, total);
  const maxD = Math.max(minD, Math.min(o.maxDuration, total));
  const TOLERANCE = 1.5; // a IA costuma errar 1s pra cima

  const parsed: Highlight[] = [];
  for (const r of raw) {
    let start: number;
    let end: number;
    try {
      start = parseTimestamp(r.start_time);
      end = parseTimestamp(r.end_time);
    } catch {
      console.warn(`[normalize] ignorando corte com tempo inválido: ${r.start_time} -> ${r.end_time}`);
      continue;
    }
    if (!(end > start) || start >= total) continue;

    start = Math.max(0, start);
    end = Math.min(total, end);

    if (end - start < minD) {
      end = Math.min(total, start + minD);
      start = Math.max(0, end - minD);
    }
    if (end - start > maxD + TOLERANCE) end = start + maxD;

    parsed.push({
      start,
      end,
      viral_score: Math.round(Math.min(100, Math.max(0, Number(r.viral_score) || 0))),
      hook_title: String(r.hook_title ?? "").trim().slice(0, 120) || "Sem título",
      hashtags: normalizeHashtags(r.hashtags),
      reason: String(r.reason ?? "").trim(),
      captions: Array.isArray(r.captions) ? r.captions : undefined,
    });
  }

  // Seleção gulosa por score, sem sobreposição.
  parsed.sort((a, b) => b.viral_score - a.viral_score);
  const picked: Highlight[] = [];
  for (const h of parsed) {
    if (picked.length >= o.clipCount) break;
    const overlaps = picked.some((p) => h.start < p.end && p.start < h.end);
    if (!overlaps) picked.push(h);
  }
  return picked;
}

function normalizeHashtags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const clean = String(t).trim().replace(/^#+/, "").replace(/\s+/g, "");
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(`#${clean}`);
  }
  return out.slice(0, 8);
}
