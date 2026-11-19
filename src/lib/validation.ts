import { parseRange } from "@/lib/time";

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 255;
}

/**
 * Aceita só VODs do YouTube e da Twitch e devolve a URL limpa.
 * youtube.com/watch?v=, youtu.be/, youtube.com/live/, twitch.tv/videos/
 */
export function normalizeSourceUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol)) return null;
  const host = url.hostname.replace(/^(www\.|m\.)/, "");

  if (host === "youtube.com") {
    const v = url.searchParams.get("v");
    if (url.pathname === "/watch" && v && /^[\w-]{6,20}$/.test(v)) return `https://www.youtube.com/watch?v=${v}`;
    const live = /^\/live\/([\w-]{6,20})/.exec(url.pathname);
    if (live) return `https://www.youtube.com/watch?v=${live[1]}`;
    return null;
  }
  if (host === "youtu.be") {
    const id = url.pathname.slice(1);
    return /^[\w-]{6,20}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
  }
  if (host === "twitch.tv") {
    const m = /^\/videos\/(\d+)/.exec(url.pathname);
    return m ? `https://www.twitch.tv/videos/${m[1]}` : null;
  }
  return null;
}

/** Valida "INICIO-FIM" (ex: 1:00:00-1:20:00). Vazio = vídeo inteiro. */
export function normalizeSection(input: string): { value: string | null; error?: string } {
  const raw = input.trim();
  if (!raw) return { value: null };
  try {
    const { start, end } = parseRange(raw);
    if (end - start < 30) return { value: null, error: "O trecho precisa ter pelo menos 30 segundos." };
    if (end - start > 4 * 3600) return { value: null, error: "O trecho pode ter no máximo 4 horas." };
    return { value: raw.replace(/\s+/g, "") };
  } catch {
    return { value: null, error: "Trecho inválido. Use INÍCIO-FIM, ex: 1:00:00-1:20:00" };
  }
}
