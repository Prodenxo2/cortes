import { GoogleGenAI } from "@google/genai";
import { getConfig, requireGeminiKey } from "@/lib/config";

let client: GoogleGenAI | null = null;

export function getGenAI(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: requireGeminiKey() });
  return client;
}

export function getModel(): string {
  return getConfig().gemini.model;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function statusOf(err: unknown): number | undefined {
  const s = (err as { status?: unknown })?.status;
  return typeof s === "number" ? s : undefined;
}

function isNetworkError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err);
  return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|network/i.test(msg);
}

/** Retry com backoff exponencial para 429 (quota/rate limit), 5xx e falhas de rede. */
export async function withRetry<T>(fn: () => Promise<T>, label: string, attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = statusOf(err);
      const retryable = status === undefined ? isNetworkError(err) : status === 429 || status >= 500;
      if (!retryable || i === attempts - 1) break;
      const delay = Math.min(30_000, 2_000 * 2 ** i) + Math.random() * 1_000;
      console.warn(
        `[gemini] ${label} falhou (${status ?? (err as Error).message}). Nova tentativa em ${Math.round(delay / 1000)}s...`,
      );
      await sleep(delay);
    }
  }
  const status = statusOf(lastErr);
  if (status === 404) {
    throw new Error(
      `[gemini] ${label}: modelo "${getModel()}" não encontrado (404). Confira GEMINI_MODEL no .env. Detalhe: ${(lastErr as Error).message}`,
    );
  }
  throw lastErr;
}

/** Faz parse do JSON da resposta, tolerando cercas ```json que alguns modelos ainda mandam. */
export function parseJsonResponse<T>(text: string | undefined, label: string): T {
  if (!text) throw new Error(`[gemini] ${label}: resposta vazia (possível bloqueio de segurança ou limite de tokens).`);
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error(`[gemini] ${label}: JSON inválido na resposta:\n${cleaned.slice(0, 500)}`);
  }
}
